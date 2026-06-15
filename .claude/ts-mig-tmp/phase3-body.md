## Phase 3 — Strict TypeScript linting

Goal: typescript-eslint enforces strict typing rules. No interim escape hatches remain. Lint is the long-term guarantee that Phase 2's hard-won types don't decay.

Depends on Phase 2 being complete (zero explicit `any` in `src/`).

### Scope

- Adopt `typescript-eslint` v8+ with the **strict-type-checked** and **stylistic-type-checked** configs.
- Convert the e2e specs in `tests/e2e/` to `.ts` (deferred from Phase 1) so the lint config can cover the whole repo uniformly.
- Convert `eslint.config.js`, `vite.config.js`, `playwright.config.js`, and `scripts/check-moviemaker-presets.mjs` to TS (or `.mts`) if their type coverage adds value — optional, low priority.
- Wire `npm run lint` to lint `.ts` files, fail the build on warnings (treat warnings as errors in CI).
- Remove `allowJs` (already removed at end of Phase 1) and any remaining `// @ts-expect-error` / `// eslint-disable` comments by fixing the underlying issue.

### Proposed `eslint.config.js`

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Project-specific tightening
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      // Keep some of the existing rules
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests tolerate more
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['*.config.{js,ts,mjs}', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  { ignores: ['dist/', 'public/', 'node_modules/', '.tmp/'] },
);
```

### Rule deviations from "off-the-shelf strict"

Rules deliberately considered and the decision per rule will be enumerated in the first PR of this phase. Highlights:

- `@typescript-eslint/no-non-null-assertion`: **error** in src/, **off** in tests. Production code should not assert non-null; tests can when the fixture guarantees it.
- `@typescript-eslint/consistent-type-imports`: **error**, auto-fixable. Pairs well with `verbatimModuleSyntax`.
- `@typescript-eslint/switch-exhaustiveness-check`: **error**. Catches missing cases when a discriminated union grows — exactly the kind of bug strict typing should prevent.
- `@typescript-eslint/no-floating-promises`: **error**. The router uses `async` and we've seen at least one fire-and-forget pattern in `router.js` (`loadRoute(path)` in `popstate`) that should be explicit `void loadRoute(path)`.
- `@typescript-eslint/restrict-template-expressions`: leave at default (warns on `${obj}` interpolation of non-strings).
- `@typescript-eslint/no-explicit-any`: **error**. Belt-and-suspenders with the Phase 2 CI grep.

### CI changes

```yaml
# .github/workflows/test.yml
      - run: npm run lint        # now type-aware
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npx playwright install chromium --with-deps
      - run: npm test
```

`lint` becomes the slowest CI step because type-aware rules parse with the TS compiler. Acceptable trade-off; add `--cache` to the lint invocation.

### Playwright spec conversion

The 25-ish `tests/e2e/*.spec.js` files import only `@playwright/test` and local helpers in `tests/helpers/`. Rename to `.ts`, add a `tsconfig.tests.json` with `tests/e2e/**/*.ts` in `include`, and let `@playwright/test` discover them by extension. No runtime change.

### Acceptance criteria

- [ ] `typescript-eslint` v8+ installed.
- [ ] `eslint.config.js` uses `strictTypeChecked` + `stylisticTypeChecked`.
- [ ] `npm run lint` covers `src/**/*.ts` and `tests/**/*.ts` and exits 0.
- [ ] `tests/e2e/*.spec.js` are renamed to `.ts`.
- [ ] CI runs lint as a gate; warnings are errors.
- [ ] No `// eslint-disable*` directives in `src/` (allow targeted disables in `tests/` with a justification comment).
- [ ] No `// @ts-expect-error` or `// @ts-ignore` in `src/`.
- [ ] No `as any` or `as unknown as ...` casts in `src/` (grep gate in CI).
- [ ] `scripts/check-moviemaker-presets.mjs` either stays as JS with an `eslint-disable-next-line` justification or is converted (decision documented in the PR).

### Estimated PR count: 3

1. Install typescript-eslint, set up the config, fix the first wave of trivially auto-fixable rules.
2. Fix the residual rule violations (most labor-intensive PR — likely the bulk of unsafe-* warnings in untrusted JSON parsing).
3. Convert e2e specs, lock in CI gating, remove `allowJs` traces, final cleanup.
