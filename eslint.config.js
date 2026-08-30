import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'

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
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ── Accessibility ───────────────────────────────────────────────────────
      // Nothing enforced this, and the result was measurable: 36 aria-labels
      // across the whole frontend against 557 <button> elements, and about
      // fifty icon-only buttons — Trash2, Pencil, X — that a screen reader
      // announces as "button". The delete control on a LOTO isolation
      // procedure and the close control on a dialog were indistinguishable.
      //
      // The gate was built as a RATCHET: each rule sat at `warn` while its
      // backlog was worked through, and moved to `error` in the same change
      // that cleared its last violation — never separately, or the promotion is
      // what breaks CI. The sweep is finished, so every rule below is `error`
      // and the count cannot go back up. Add a rule the same way: `warn` first,
      // clear it, promote it in that change.
      ...jsxA11y.flatConfigs.recommended.rules,

      // Cleared and held.
      //
      // control-has-associated-label is SCOPED to the elements it can actually
      // judge. The dominant form control in this app is
      // `<Field label="Start time"><input type="time" /></Field>`, where the
      // label lives one component boundary away — Field generates the id and
      // clones it onto the child. That is correct at runtime and invisible to a
      // static rule, so leaving inputs in scope meant 277 warnings on code that
      // is right, which is how a warning count stops being read.
      //
      // Buttons, anchors and the table cells that wrap them it CAN judge,
      // because an icon-only control has its emptiness right there in the JSX.
      // Those were the ~50 real findings and they are now closed, which is why
      // this is `error`.
      //
      // What the scoping gives up is caught instead by the axe pass in
      // e2e/accessibility.spec.js, which reads the rendered DOM and therefore
      // sees exactly what a static rule cannot: whether the label ended up
      // attached. Static lint for what is statically visible, axe for the rest.
      'jsx-a11y/control-has-associated-label': [
        'error',
        { ignoreElements: ['input', 'select', 'textarea'] },
      ],
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/no-redundant-roles': 'error',

      // no-autofocus stays at the recommended `error`, and the six places that
      // break it carry a disable naming the reason instead. Every one is a
      // step transition on a single-purpose screen — the 2FA code that replaces
      // the password form, the re-authentication prompt, the forced password
      // change nobody can navigate away from. Moving focus there is what the
      // WAI-ARIA authoring practices ask for; it is only harmful when it steals
      // focus on a page that has other things on it. Lowering the rule to
      // `warn` to accommodate those six would also stop it catching the seventh,
      // which will not be one of these.

      // depth 3, not the default 2. The checkbox-card pattern used across this
      // app wraps the control in the label — which is correct, and is the
      // stronger of the two associations because it cannot be broken by a
      // duplicate id — but puts the text one level further down:
      //   <label><input type="checkbox" /><span>Replace existing plans</span></label>
      // At depth 2 the rule cannot see that span and reports correct markup,
      // and a rule that fires on correct code is one people learn to silence.
      //
      // controlComponents names the kit's wrappers around native controls.
      // `<label>From <Input type="date" …/></label>` in the audit log is a
      // correctly nested control, but the rule sees a capitalised tag and
      // cannot know it renders an <input>. Listing them is how the rule is told.
      'jsx-a11y/label-has-associated-control': [
        'error',
        { depth: 3, controlComponents: ['Input', 'Select', 'Textarea', 'MultiSelect'] },
      ],
      // The keyboard story, and the last group to clear. What these found was
      // not cosmetic: the bulk-upload drop zones were the ONLY way to choose a
      // file on their pages and were `<div onClick>`, so a keyboard user could
      // not import a spreadsheet at all; and a fishbone node could be selected,
      // deleted and gate-flipped from the keyboard but never renamed, because
      // renaming was double-click and nothing else. Both are now real controls.
      //
      // The disables that remain are all one shape — a decorative modal scrim
      // whose keyboard equivalent is Escape, handled by useFocusTrap. A backdrop
      // must not be a tab stop; making it one puts a nameless control in front
      // of the dialog it is dimming.
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
    },
  },
  // Test files run under Vitest, whose API is injected as globals.
  {
    files: ['**/*.test.{js,jsx}', 'tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...vitestGlobals } },
  },
  // Seed / maintenance scripts are Node ESM — the main block only matches .js|.jsx.
  //
  // `tools/` is here for the same reason and was added the hard way: those
  // files lint clean under `eslint src/ functions/` and fail under `eslint .`,
  // which is what `npm run lint` and therefore CI actually runs. Forty-nine
  // no-undef errors for `process`, `console` and `fetch` — a browser config
  // judging Node scripts. Lint the whole repo, not the directory you were
  // thinking about.
  //
  // es2021 alongside node for the reason given in the main block: the standard
  // built-ins are not all declared by the node set, and `fetch`/`AbortSignal`
  // in particular are language-level here rather than Node API.
  {
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
]
