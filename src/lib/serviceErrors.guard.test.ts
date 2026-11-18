// Guard for raw-errors-1: no screen hands a caught error's own words to the
// person. A toast, a toast description or an error setter must never read
// .message, .detail or .error_description of a caught value, directly or
// through a variable, because that is where the database, the browser, a
// gateway or a provider puts its text. Use plainError(e, 'Could not ...')
// from serviceErrors.ts instead.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(process.cwd(), 'src')

// Places where the value read is already a plain sentence we wrote. Each
// entry is a file and a piece of the call's argument.
const ALLOWED: { file: string; arg: string; why: string }[] = [
  // NoLinesError carries our own "Add at least one line" sentence.
  { file: 'screens/quotes/QuoteDetail.tsx', arg: 'title, message', why: 'message is NoLinesError or plainQuoteError' },
  { file: 'screens/quotes/QuotePreview.tsx', arg: 'e instanceof NoLinesError ? e.message', why: 'our own sentence' },
  // `ours` is true only for the approval sentences this screen throws.
  { file: 'screens/quotes/QuoteApprove.tsx', arg: 'ours ? e.message', why: 'our own sentence' },
  // sendStatementEmail words its failure with plainError (statement.ts).
  { file: 'screens/clients/ClientStatement.tsx', arg: 'res.message ||', why: 'already plain' }
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Comments blanked out, line numbers kept. */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (line, lead: string) => lead + ' '.repeat(line.length - lead.length))
}

// toastError, toastInfo, toast, toast.error, sonnerToast and every setter
// that holds an error or a failure line for a screen.
const SINK = /\b(toastError|toastInfo|toastSuccess|toast\.error|toast|sonnerToast(?:\.error)?|set\w*(?:Error|Err|Failure|Problem|Msg|Message|Result)\w*)\s*\(|\bdescription\s*:/g
const RAW_READ = /\.(message|detail|error_description|msg)\b|String\(\s*(e|ex|err|error)\s*\)/

/** The text of a call's arguments, or of a description: value. */
function argumentOf(source: string, start: number, isDescription: boolean) {
  if (isDescription) {
    const rest = source.slice(start)
    return rest.slice(0, rest.search(/[,}\n]/))
  }
  let depth = 1
  let i = start
  while (i < source.length && depth > 0) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') depth -= 1
    i += 1
  }
  return source.slice(start, i - 1)
}

function rawErrorSinks(file: string, source: string) {
  const code = withoutComments(source)
  // Variables that hold a raw read, such as const msg = e?.message || ''.
  const tainted = new Set<string>()
  // The value runs on over lines that continue it (? : || && . +).
  for (const m of code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*([^;\n]*(?:\n\s*(?:\?|:|\|\||&&|\.|\+)[^;\n]*)*)/g)) {
    if (RAW_READ.test(m[2])) tainted.add(m[1])
  }
  const hits = new Map<number, string>()
  for (const m of code.matchAll(SINK)) {
    const arg = argumentOf(code, m.index + m[0].length, m[0].startsWith('description'))
    const names = arg.match(/\b\w+\b/g) ?? []
    if (!RAW_READ.test(arg) && !names.some((name) => tainted.has(name))) continue
    const flat = arg.replace(/\s+/g, ' ').trim()
    if (ALLOWED.some((allow) => file === allow.file && flat.includes(allow.arg))) continue
    const line = code.slice(0, m.index).split('\n').length
    if (!hits.has(line)) hits.set(line, `${file}:${line} ${flat.slice(0, 100)}`)
  }
  return [...hits.values()]
}

describe('raw error guard', () => {
  it('finds the pattern it guards against', () => {
    expect(rawErrorSinks('x.tsx', "try { a() } catch (e) { toastError('Could not save', e.message) }")).toHaveLength(1)
    expect(rawErrorSinks('x.tsx', "const msg = String(err?.message || '')\nsetError(msg)")).toHaveLength(1)
    expect(rawErrorSinks('x.tsx', "toast('Saved', { description: error?.detail })")).toHaveLength(1)
    expect(rawErrorSinks('x.tsx', "const msg = n > 0\n  ? `Some did not import: ${error.message}`\n  : error.message\nsetErrMsg(msg)")).toHaveLength(1)
    expect(rawErrorSinks('x.tsx', "toastError('Could not save', plainError(e, 'Could not save the job.'))")).toEqual([])
  })

  it('no toast, toast description or error setter shows a caught error\'s own words', () => {
    const files = sourceFiles(srcDir)
    expect(files.length).toBeGreaterThan(100)
    const hits = files.flatMap((path) => rawErrorSinks(path.slice(srcDir.length + 1), readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })
})
