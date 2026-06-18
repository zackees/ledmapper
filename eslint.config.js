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
        projectService: {
          allowDefaultProject: [
            'tests/integration/*.ts',
            'tests/smoke/*.ts',
            'tests/helpers/*.ts',
            'tests/canvas-fit/*.ts',
            'tests/perf/*.ts',
          ],
          defaultProject: './tsconfig.tests.json',
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strict type-safety rules — all errors
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
      // Retained base rules
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Unused vars: off for base rule, TS rule handles it
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Inline-style guard. Style information belongs in CSS (variables
      // + classes), not in TS literals. See issue #170 for the migration
      // plan and the per-token mapping. Files with pre-existing violations
      // are temporarily exempted below until they migrate.
      'no-restricted-syntax': [
        'error',
        {
          // Forbid hex color literals: '#000', '#abc123', '#abcdef80'.
          // Matches 3, 4, 6, or 8 hex digits after #. Numeric hex (0x...)
          // is unaffected — it's not a string literal.
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: 'Hex color literals belong in CSS variables (src/styles/global.css), read at runtime via the helper described in #170.',
        },
        {
          // Forbid rgba/rgb/rgba()/hsl()/hsla() string literals.
          selector: "Literal[value=/^(rgba?|hsla?)\\s*\\(/]",
          message: 'rgb()/hsl() color literals belong in CSS variables, not TS. See #170.',
        },
        {
          // Forbid `el.style.cssText = ...` — bundles style with logic.
          // Add a CSS class instead.
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='cssText']",
          message: 'element.style.cssText is forbidden — define a CSS class and set element.className. See #170.',
        },
        {
          // Forbid `<el style="...">` in template-literal strings.
          // Triggers on any TemplateElement whose raw text contains
          // `style="`. Liberally caught; suppression on a per-line basis
          // is allowed during migration via `// eslint-disable-next-line`.
          selector: "TemplateElement[value.raw=/style\\s*=\\s*[\"']/]",
          message: 'HTML inline style="..." attributes belong in CSS. Replace with a class and a rule in the tool CSS. See #170.',
        },
      ],
    },
  },
  {
    // Tests may use non-null assertions (fixtures guarantee the value exists),
    // may log for diagnostic purposes, and use `any` from page.evaluate() returns.
    // Unit tests use Node's test runner (describe/it) which returns un-awaited promises by design.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Config files and scripts stay as JS — no type-aware rules, no project service
    files: ['*.config.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    // Files produced by the one-time mechanical split of the original
    // 6.6K-LOC shapeeditor.ts. They use `const self = this` for `this`-binding
    // inside inner `function()` declarations, `any` typing in a few places
    // where the original closure code could not be inferred cleanly, and a
    // handful of always-truthy conditional checks because some DOM-element
    // fields are typed as non-nullable post-refactor (the original code
    // guarded them with `if (X)` — unnecessary now but harmless).
    files: [
      'src/shapeeditor/shapeeditor.ts',
      'src/shapeeditor/shapeeditor-class.ts',
      'src/shapeeditor/shapeeditor-init.ts',
      'src/shapeeditor/shapeeditor-methods-*.ts',
      'src/shapeeditor/shapeeditor-types.ts',
    ],
    rules: {
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Tests legitimately use hex colors as fixtures (screenmap parse,
    // V2 group palette assertions, webcam mock pattern generation).
    // Tests don't ship to users, so the inline-color guard doesn't
    // apply.
    files: ['tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Pre-existing inline-color / cssText violations (inventory in #170).
    // Each file listed here will migrate in its own focused PR; the
    // override comes off when the file lands clean. New code must not
    // be added to this list without an explicit issue link.
    files: [
      // The single legitimate declaration site for hex color literals:
      // the FALLBACK palette that workers + bare-DOM environments use
      // when getComputedStyle is unavailable. Everything else reads
      // through gfxColors.* — see #170.
      'src/ui/theme.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Worker-bound files: these modules must load and run inside a
    // dedicated Web Worker, where `document`, `window`, `localStorage`,
    // `HTMLElement` constructor, and `getComputedStyle` are all
    // undefined. Issue #172.
    //
    // To add a file here, verify it loads without throwing under Node
    // (the fixture test in tests/unit/worker-bound-modules-load.test.ts
    // does exactly that). Adding a file here without the test fixture
    // catching it = the rule isn't doing its job; fix the rule first.
    //
    // `three-utils.ts` is intentionally NOT here: it carries both
    // worker-safe helpers (createRendererCore, createCircleTexture) and
    // DOM-coupled helpers (createRendererAndScene, wireResponsiveCanvas).
    // Split TBD per #172 Open Question #1.
    files: [
      'src/gfx/gfx-core-headless.ts',
      'src/gfx/screenmap.ts',
      'src/gfx/worker/worker-host.ts',
      'src/gfx/worker/protocol.ts',
      'src/auto-bloom.ts',
      'src/bloom-utils.ts',
      'src/render/bloom-geometry.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        // Keep the inline-color/style rules from the base override so
        // worker-bound files still can't ship hex literals etc.
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: 'Hex color literals belong in CSS variables (#170).',
        },
        {
          selector: "Literal[value=/^(rgba?|hsla?)\\s*\\(/]",
          message: 'rgb()/hsl() literals belong in CSS variables (#170).',
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='cssText']",
          message: 'el.style.cssText is forbidden — use a CSS class (#170).',
        },
        // Worker-bound-specific: forbid DOM globals.
        {
          selector: "MemberExpression[object.name='document']",
          message: 'document.* is forbidden in worker-bound code (#172) — this module loads inside a Web Worker. Pass any needed DOM state via init message.',
        },
        {
          selector: "MemberExpression[object.name='window']",
          message: 'window.* is forbidden in worker-bound code (#172). Pass devicePixelRatio etc. via init message.',
        },
        {
          selector: "MemberExpression[object.name='localStorage']",
          message: 'localStorage is undefined in workers (#172). Pass persisted state via init; or guard with `typeof localStorage !== "undefined"`.',
        },
        {
          selector: "BinaryExpression[operator='instanceof'][right.name='HTMLElement']",
          message: 'HTMLElement is a DOM type, not available in workers (#172). Accept HTMLCanvasElement | OffscreenCanvas only.',
        },
        {
          selector: "CallExpression[callee.name='getComputedStyle']",
          message: 'getComputedStyle is a DOM function (#172). Pass CSS-var snapshots via init (see snapshotGfxColors in src/ui/theme.ts).',
        },
      ],
    },
  },
  { ignores: ['dist/', 'public/', 'node_modules/', '.tmp/', 'tests/**/*.js'] },
);
