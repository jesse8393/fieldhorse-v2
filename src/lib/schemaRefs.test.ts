import { describe, expect, it } from 'vitest'

// The schema check behind `npm run check:schema`. Two weeks before this test
// the live app called a database function production did not have, and every
// check passed. These fixtures pin that the check reads what the code calls
// and refuses anything the schema it is given does not have.
import {
  collectRefs,
  compareRefs,
  parseDatabaseTypes,
  productionPlan,
  schemaFromCatalog,
  schemaFromOpenApi
} from '../../scripts/lib/schemaRefs.mjs'

const TYPES = `export type Json = string

export type Database = {
  public: {
    Tables: {
      fh_contacts: {
        Row: {
          client_id: string | null
          id: string
          stage: string
        }
        Insert: {
          client_id?: string | null
          id?: string
          stage: string
        }
        Update: {
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_contacts_client_id_fkey"
            columns: ["client_id"]
          },
        ]
      }
      fh_clients: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      fh_v_inbox: {
        Row: {
          conversation_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      fh_make_job_from_quote: {
        Args: { p_quote_id: string }
        Returns: string
      }
      auth_user_org_ids: { Args: never; Returns: string[] }
      fh_advance_run: {
        Args: { p_max_steps?: number; p_run_id: string }
        Returns: string
      }
    }
    Enums: {
      org_role: "owner" | "crew"
    }
  }
}

export const Constants = {
  public: {
    Enums: {
      org_role: ["owner", "crew"],
    },
  },
} as const
`

const schema = parseDatabaseTypes(TYPES)

function problems(text: string, against = schema) {
  return compareRefs(collectRefs([{ path: 'src/x.ts', text }]), against).map((p) => `${p.kind} ${p.name}`)
}

describe('parseDatabaseTypes', () => {
  it('reads tables, views and their Row columns', () => {
    expect(Object.keys(schema.tables).sort()).toEqual(['fh_clients', 'fh_contacts', 'fh_v_inbox'])
    expect(schema.tables.fh_contacts.columns).toEqual(['client_id', 'id', 'stage'])
    expect(schema.tables.fh_v_inbox).toEqual({ columns: ['conversation_id'], view: true })
  })

  it('reads every function with its named parameters, optional or not', () => {
    expect(schema.functions.fh_make_job_from_quote.overloads).toEqual([[{ name: 'p_quote_id', optional: false }]])
    expect(schema.functions.auth_user_org_ids.overloads).toEqual([[]])
    expect(schema.functions.fh_advance_run.overloads).toEqual([
      [{ name: 'p_max_steps', optional: true }, { name: 'p_run_id', optional: false }]
    ])
  })
})

describe('collectRefs and compareRefs', () => {
  it('passes code that uses only what the schema has', () => {
    const code = `
      const { data } = await supabase
        .from('fh_contacts')
        .select('id, stage, client:fh_clients!fh_contacts_client_id_fkey(id, name)')
        .eq('stage', 'job')
        .eq('client.name', 'Jeff')
        .order('name', { referencedTable: 'client' })
        .or('stage.eq.job,and(id.eq.1,client_id.is.null)')
      await supabase.from('fh_contacts').insert({ stage: 'job', client_id }).select('id').single()
      await supabase.from('fh_clients').update({ name }).eq('id', id)
      await supabase.from('fh_v_inbox').select('conversation_id')
      await supabase.rpc('fh_make_job_from_quote', { p_quote_id: quoteId })
      await supabase.rpc('fh_advance_run', { p_run_id: runId })
      await supabase.rpc('auth_user_org_ids')
    `
    expect(problems(code)).toEqual([])
  })

  it('reports a function the schema does not have, the way fh_make_job_from_quote shipped', () => {
    expect(problems(`await supabase.rpc('fh_no_such_function', { p_id: 1 })`)).toEqual(['rpc fh_no_such_function'])
    expect(problems(`fetch(base + '/rest/v1/rpc/fh_gone', { method: 'POST' })`)).toEqual(['rpc fh_gone'])
  })

  // fh_company_branding and fh_merge_client_into were missing from the
  // types and the check said ok, because both name the function in a
  // constant and call a bound rpc (vibe audit console-4).
  it('reads a function named in a constant, also through a bound rpc', () => {
    const bound = `
      const FUNCTION = 'fh_company_branding'
      const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<unknown>
      const { data } = await rpc(FUNCTION, { p_org_id: orgId })
    `
    expect(problems(bound)).toEqual(['rpc fh_company_branding'])
    expect(problems(`const MERGE_FUNCTION = 'fh_gone'\nawait supabase.rpc(MERGE_FUNCTION, { p_id: 1 })`)).toEqual(['rpc fh_gone'])
    expect(problems(`const F = 'fh_make_job_from_quote'\nawait rpc(F, { p_quote_id: id })`)).toEqual([])
    expect(problems(`const F = 'fh_make_job_from_quote'\nawait rpc(F, { quote_id: id })`)).toEqual(['rpc-args fh_make_job_from_quote'])
    expect(problems(`await rpc('fh_gone_too', { p_id: 1 })`)).toEqual(['rpc fh_gone_too'])
    // A name the file does not pin to one string is not guessed.
    expect(problems(`await supabase.rpc(name, args)`)).toEqual([])
  })

  it('reports a call whose arguments no version of the function takes', () => {
    expect(problems(`await supabase.rpc('fh_make_job_from_quote', { quote_id: id })`)).toEqual(['rpc-args fh_make_job_from_quote'])
    expect(problems(`await supabase.rpc('fh_advance_run', { p_max_steps: 2 })`)).toEqual(['rpc-args fh_advance_run'])
  })

  it('reports an unknown table, also as an embedded resource', () => {
    expect(problems(`supabase.from('fh_nope').select('*')`)).toEqual(['table fh_nope'])
    expect(problems(`supabase.from('fh_contacts').select('id, fh_nope(id)')`)).toEqual(['table fh_nope'])
  })

  it('reports an unknown column in a select, a filter, an order, an insert and an update', () => {
    expect(problems(`supabase.from('fh_contacts').select('id, assigned_user_ids')`)).toEqual(['column fh_contacts.assigned_user_ids'])
    expect(problems(`supabase.from('fh_contacts').select('id').eq('stagee', 'job')`)).toEqual(['column fh_contacts.stagee'])
    expect(problems(`supabase.from('fh_contacts').select('id, c:fh_clients(id)').order('nam', { referencedTable: 'c' })`)).toEqual(['column fh_clients.nam'])
    expect(problems(`supabase.from('fh_contacts').select('id, fh_clients(id, phone)')`)).toEqual(['column fh_clients.phone'])
    expect(problems(`supabase.from('fh_contacts').select('id, fh_clients(id)').eq('fh_clients.email', 'x')`)).toEqual(['column fh_clients.email'])
    expect(problems(`supabase.from('fh_contacts').select('id').or('stage.eq.job,title.eq.x')`)).toEqual(['column fh_contacts.title'])
    expect(problems(`supabase.from('fh_clients').insert([{ name: 'a', phone }])`)).toEqual(['column fh_clients.phone'])
    expect(problems(`supabase.from('fh_clients').update({ name, email: 'x' }).eq('id', id)`)).toEqual(['column fh_clients.email'])
    expect(problems(`supabase.from('fh_clients').upsert({ name }, { onConflict: 'org_id,name' })`)).toEqual(['column fh_clients.org_id'])
  })

  it('ignores comments, storage buckets, variables and json paths', () => {
    const code = `
      // await supabase.from('foo').delete()
      /* supabase.rpc('fh_commented_out') */
      await supabase.storage.from('logos').upload(path, file)
      await supabase.storage
        .from('photos')
        .remove([path])
      await supabase.from('fh_contacts').select(columns).eq(key, value)
      await supabase.from('fh_contacts').select('id, stage->>x, total:id::text').insert({ ...row })
    `
    expect(problems(code)).toEqual([])
  })

  it('names the file and line of each problem', () => {
    const refs = collectRefs([{ path: 'src/lib/quotes.ts', text: "\n\nawait supabase.rpc('fh_gone')\n" }])
    expect(compareRefs(refs, schema)).toEqual([{ kind: 'rpc', name: 'fh_gone', file: 'src/lib/quotes.ts', line: 3 }])
  })
})

describe('production schemas', () => {
  it('reads tables and functions from the PostgREST OpenAPI document', () => {
    const doc = {
      definitions: { fh_contacts: { properties: { id: {}, stage: {}, client_id: {} } }, fh_clients: { properties: { id: {}, name: {} } } },
      paths: {
        '/fh_contacts': {},
        '/rpc/fh_advance_run': { post: { parameters: [{ in: 'body', name: 'args', schema: { required: ['p_run_id'], properties: { p_run_id: {}, p_max_steps: {} } } }] } },
        '/rpc/auth_user_org_ids': { post: { parameters: [{ in: 'body', name: 'args', schema: { properties: {} } }] } }
      }
    }
    const live = schemaFromOpenApi(doc)
    expect(live.tables.fh_contacts.columns).toEqual(['id', 'stage', 'client_id'])
    expect(live.functions.fh_advance_run.overloads).toEqual([[{ name: 'p_run_id', optional: false }, { name: 'p_max_steps', optional: true }]])
    // The code calls a function the repo types have and production lacks.
    expect(problems(`await supabase.rpc('fh_make_job_from_quote', { p_quote_id: id })`, live)).toEqual(['rpc fh_make_job_from_quote'])
    expect(problems(`await supabase.rpc('auth_user_org_ids')`, live)).toEqual([])
  })

  it('reads tables and functions from catalog rows', () => {
    const live = schemaFromCatalog({
      columns: [{ table: 'fh_contacts', column: 'id' }, { table: 'fh_contacts', column: 'stage' }],
      functions: [{ name: 'fh_make_job_from_quote', args: [{ name: 'p_quote_id', optional: false }] }]
    })
    expect(problems(`supabase.from('fh_contacts').select('id, assigned_user_ids')`, live)).toEqual(['column fh_contacts.assigned_user_ids'])
    expect(problems(`supabase.rpc('fh_make_job_from_quote', { p_quote_id: id })`, live)).toEqual([])
  })

  it('checks production only with a database URL or a service key, and says so otherwise', () => {
    expect(productionPlan({ SUPABASE_DB_URL: 'postgres://ro@db/x' })).toMatchObject({ kind: 'catalog' })
    expect(productionPlan({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toMatchObject({
      kind: 'openapi', url: 'https://p.supabase.co/rest/v1/'
    })
    // The anon key alone is not enough: PostgREST leaves out of its OpenAPI
    // document every function and table the anon role cannot use, so a
    // function revoked from anon would read as missing.
    const anon = productionPlan({ VITE_SUPABASE_URL: 'https://p.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' })
    expect(anon.kind).toBe('none')
    expect(anon.reason).toMatch(/not checked/)
    expect(productionPlan({ SUPABASE_SERVICE_ROLE_KEY: 'k' }).kind).toBe('none')
    expect(productionPlan({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '' }).kind).toBe('none')
  })
})
