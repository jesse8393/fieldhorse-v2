// Test databases only. Refuse remote URLs and existing application databases.
import { pathToFileURL } from 'node:url'

export async function auditDatabase(label) {
  const url = process.env.AUDIT_DATABASE_URL
  if (!url) {
    const runtime = process.env.PGLITE_RUNTIME
    const { PGlite } = await import(runtime ? pathToFileURL(`${runtime}/dist/index.js`).href : '@electric-sql/pglite')
    const { btree_gist } = await import(runtime ? pathToFileURL(`${runtime}/dist/contrib/btree_gist.js`).href : '@electric-sql/pglite/contrib/btree_gist')
    return PGlite.create({ extensions: { btree_gist } })
  }
  const base = new URL(url)
  if (!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || base.pathname !== '/fieldhorse_audit') {
    throw new Error('AUDIT_DATABASE_URL must point to a disposable loopback /fieldhorse_audit database.')
  }
  if (!/^[a-z]+$/.test(label)) throw new Error('Invalid audit database label.')
  const { Client } = await import('pg')
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const name = `fieldhorse_audit_${label}_${process.pid}`
  // No IF NOT EXISTS: never reuse or drop a database this run did not create.
  await admin.query(`create database ${name}`)
  base.pathname = `/${name}`
  const openSession = async () => {
    const client = new Client({ connectionString: base.href, statement_timeout: 10000 })
    await client.connect()
    return client
  }
  const client = await openSession()
  const db = {
    query: (sql, params) => client.query(sql, params),
    exec: sql => client.query(sql),
    openSession,
    async transaction(fn) {
      await client.query('begin')
      try { const result = await fn(db); await client.query('commit'); return result }
      catch (error) { await client.query('rollback'); throw error }
    },
    async close() {
      await client.end()
      try { await admin.query(`drop database ${name}`) } finally { await admin.end() }
    }
  }
  return db
}

// Roles are cluster-wide in PostgreSQL; separate test databases share them.
export const auditRoles = `do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;`
