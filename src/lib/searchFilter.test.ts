import { describe, expect, it } from 'vitest'
import { escapeLikeText, ilikeAnyOf } from './searchFilter.ts'

// Mirrors how PostgREST reads one double quoted or() value: a backslash
// keeps the next character as is, and the closing quote ends the value.
function readQuoted(expr: string, from: number): { value: string; end: number } {
  expect(expr[from]).toBe('"')
  let value = ''
  let i = from + 1
  while (expr[i] !== '"') {
    if (expr[i] === '\\') i += 1
    value += expr[i]
    i += 1
  }
  return { value, end: i + 1 }
}

// Split an or() expression into [column, pattern] pairs.
function parseOr(expr: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let i = 0
  while (i < expr.length) {
    const head = expr.indexOf('.ilike.', i)
    const column = expr.slice(i, head)
    const { value, end } = readQuoted(expr, head + '.ilike.'.length)
    out.push([column, value])
    if (end < expr.length) expect(expr[end]).toBe(',')
    i = end + 1
  }
  return out
}

describe('escapeLikeText', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLikeText('50% off')).toBe('50\\% off')
    expect(escapeLikeText('j_smith')).toBe('j\\_smith')
    expect(escapeLikeText('a\\b')).toBe('a\\\\b')
    expect(escapeLikeText('Oak St')).toBe('Oak St')
  })
})

describe('ilikeAnyOf', () => {
  it('quotes every value so commas and parentheses stay in the text', () => {
    for (const typed of ['Smith, John', '123 Main St, Apt 4', '(615) 555-0101', 'jane@example.com']) {
      const pairs = parseOr(ilikeAnyOf(['name', 'phone'], typed))
      expect(pairs).toEqual([
        ['name', `%${typed}%`],
        ['phone', `%${typed}%`]
      ])
    }
  })

  it('escapes quotes and backslashes inside the quoted value', () => {
    const pairs = parseOr(ilikeAnyOf(['name'], 'say "hi" \\ 100%'))
    expect(pairs).toEqual([['name', '%say "hi" \\\\ 100\\%%']])
  })

  it('keeps the exact expression shape PostgREST expects', () => {
    expect(ilikeAnyOf(['name', 'email'], 'Smith, J')).toBe('name.ilike."%Smith, J%",email.ilike."%Smith, J%"')
  })
})
