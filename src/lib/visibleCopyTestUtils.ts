import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// Collects the strings a person can read from TypeScript and TSX source:
// JSX text, string literals given to props that render as words (labels,
// hints, placeholders, titles, aria labels and the like), string literals
// shown straight from a JSX expression ({x ?? 'None'}), and the words in
// toast calls. Used by the copy rule tests for the web app and the native
// app. Test helper only: nothing in the app imports it.

export type VisibleString = { file: string; line: number; text: string }

// Props whose string value is read or spoken as words.
const WORD_PROPS = new Set([
  'title', 'subtitle', 'sub', 'label', 'hint', 'placeholder', 'aria-label', 'alt',
  'description', 'message', 'helper', 'helperText', 'caption', 'eyebrow', 'heading',
  'emptyText', 'emptyTitle', 'emptyMessage', 'confirmLabel', 'ctaLabel', 'tooltip',
  'accessibilityLabel', 'accessibilityHint', 'body', 'detail', 'note', 'text', 'value'
])
// Calls whose string arguments show up as a toast, or in the native app's
// Alert.alert.
const TOAST_CALL = /^(toast|toastError|toastSuccess|toastInfo|toastUndo|success|error|info|warning|alert)$/

export function sourceFiles(dir: string, skip: RegExp = /\.test\.tsx?$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path, skip)
    return /\.(tsx|ts)$/.test(entry.name) && !skip.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

// The literal words inside an expression that renders as text: the string
// itself, both arms of a condition, both sides of || and ??, a template's
// fixed parts. Anything passed into a call is skipped (class names, keys).
function literalWords(node: ts.Node, out: ts.Node[]) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node)
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head)
    for (const span of node.templateSpans) {
      literalWords(span.expression, out)
      out.push(span.literal)
    }
  } else if (ts.isParenthesizedExpression(node)) literalWords(node.expression, out)
  else if (ts.isConditionalExpression(node)) { literalWords(node.whenTrue, out); literalWords(node.whenFalse, out) }
  else if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) {
      literalWords(node.left, out); literalWords(node.right, out)
    } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) literalWords(node.right, out)
  }
}

function textOf(node: ts.Node): string {
  if (ts.isJsxText(node)) return node.text
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text
  return ''
}

export function visibleStrings(file: string, source = readFileSync(file, 'utf8')): VisibleString[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const found: ts.Node[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) found.push(node)
    else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      if (WORD_PROPS.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) found.push(node.initializer)
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) literalWords(node.initializer.expression, found)
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      literalWords(node.expression, found)
    } else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && WORD_PROPS.has(node.name.text)) {
      // Object fields that a screen renders as words: { title: '...', detail: '...' }.
      literalWords(node.initializer, found)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) && /^(toast|Alert)$/i.test(callee.expression.getText(sf)) ? callee.name.text : ''
      if (TOAST_CALL.test(name) && (ts.isIdentifier(callee) ? /^toast/.test(name) : true)) {
        for (const arg of node.arguments) literalWords(arg, found)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
    .map((node) => ({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: textOf(node) }))
    .filter((s) => s.text.trim().length > 0)
}

// A dash used as punctuation: an em dash, an en dash, or a hyphen with a
// space on both sides (or standing alone, as a placeholder for a value).
export const PUNCTUATION_DASH = /[\u2013\u2014]|\s-\s|^\s*-\s*$/
