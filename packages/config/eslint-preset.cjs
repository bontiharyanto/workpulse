/**
 * Shared ESLint preset for Workpulse packages.
 * Consumed via .eslintrc.cjs in each app/package.
 */
module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import', 'unused-imports'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    // TypeScript source files may use the `.js` extension on relative
    // imports (ESM idiom that survives compilation to real `.js`). The
    // default node resolver can't follow those; the TS resolver knows to
    // fall back to `.ts`/`.tsx`. `alwaysTryTypes` also lets the resolver
    // pick up type-only packages (e.g. `@types/foo`).
    'import/resolver': {
      typescript: { alwaysTryTypes: true },
      node: true,
    },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    // Downgraded to `warn` for the beta baseline — the codebase has ~24
    // pre-existing usages, most legitimate (post-`enabled` React Query
    // narrowing, `const [x] = await hydrateOne([single])`, etc.). Real
    // enforcement returns via a dedicated cleanup PR that either adds
    // justifying comments or introduces helper functions.
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
    ],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
  },
  ignorePatterns: ['dist', '.next', 'coverage', 'node_modules'],
};
