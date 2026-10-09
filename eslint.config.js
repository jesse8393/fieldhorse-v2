// ESLint 9 flat config. `npm run lint` runs `eslint .` over the web app,
// the Netlify functions, the e2e specs and the repo scripts.
//
// What it checks:
// * Every .js, .mjs, .ts and .tsx file outside the ignored folders gets
//   @eslint/js recommended at its default levels, so real bug patterns
//   such as unreachable code, duplicate keys, constant conditions, switch
//   fall through and self assignment fail the run.
// * .ts and .tsx files are parsed by the typescript-eslint parser with JSX
//   on. Parsing only: there is no type aware `project`, so lint stays fast
//   and needs no tsconfig. Type errors are what `npm run typecheck` is for.
// * React hooks: rules-of-hooks is an error and exhaustive-deps a warning.
//   Only these two rules are named, so a newer plugin version cannot turn
//   on more rules through its recommended preset.
// * eslint-plugin-react is registered so disable comments that name its
//   rules resolve, and only its rules for real JSX bugs are on (missing
//   list keys, duplicate props, comments rendered as text, state mutated
//   directly). Its style rules stay off.
//
// * Plain .js and .mjs files are not typechecked, so no-undef runs on them
//   with the globals each one really has: Node for the Netlify functions,
//   scripts and build config, the browser for src/lib/pdf.js, and both for
//   the QA scripts, whose page callbacks run in the browser.
//
// What it leaves off:
// * no-undef and no-redeclare for .ts and .tsx. The TypeScript compiler
//   reports undefined names and clashing declarations there.
// * no-unused-vars for every file. Unused names are untidy rather than
//   broken, and tsconfig leaves noUnusedLocals off too.
// * Reports of unused disable comments. Several comments name rules that
//   are off here (no-console, for one), so they would always read as unused.
//
// Warnings do not fail the run. Review each exhaustive-deps warning on its
// own merits: adding a missing dependency changes when the effect runs.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'public/**',
      'mobile/**',
      'supabase/migrations/**',
      'test_out/**',
      '_reference/**',
      'qa-shots/**',
      'playwright-report/**',
      'test-results/**',
      '.netlify/**',
      // Local Claude settings and agent worktrees, each a full copy of the repo.
      '.claude/**',
      // Root level .mjs files are local session tooling that git ignores.
      '*.mjs',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['netlify/**/*.js', '*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-undef': 'error' },
  },
  {
    // Playwright QA scripts: page.evaluate callbacks run in the browser.
    files: ['scripts/qa-*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      react,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'no-redeclare': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-key': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-comment-textnodes': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-direct-mutation-state': 'error',
    },
  },
]
