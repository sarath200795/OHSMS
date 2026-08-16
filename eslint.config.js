import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Vitest injects these as globals (see vitest.config.js `globals: true`).
const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
}

export default [
  // `.claude` holds tooling state, and `.claude/worktrees/*` is a full second
  // checkout of this repository. Without it here, every file in the project is
  // linted twice and the duplicate copy reports ~270 no-undef errors, because
  // the Node globals configured below are matched by path and those paths do
  // not match. CI never saw it — a fresh checkout has no worktrees — so the
  // only casualty was the local run, which is the one a person actually reads.
  { ignores: ['dist', '.vendor', 'node_modules', 'emulator-data', '.claude'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // es2021 carries the standard built-ins — Intl, Promise, BigInt and the
      // rest. browser and node between them do NOT declare all of these, so
      // without it no-undef fires on language features that are simply always
      // there. Adding known globals can only ever remove errors.
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Test files run under Vitest, whose API is injected as globals.
  {
    files: ['**/*.test.{js,jsx}', 'tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...vitestGlobals } },
  },
  // Seed / maintenance scripts are Node ESM — the main block only matches .js|.jsx.
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
]
