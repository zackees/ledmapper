import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
      'eqeqeq': ['warn', 'always'],
      'prefer-const': 'warn',
      'no-var': 'warn',
    },
  },
  { ignores: ['dist/', 'public/', 'node_modules/'] },
];
