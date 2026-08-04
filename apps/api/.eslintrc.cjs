module.exports = {
  root: true,
  extends: [require.resolve('@workpulse/config/eslint')],
  parserOptions: {
    // `tsconfig.json` excludes `**/*.spec.ts` so they never end up in the
    // production build. ESLint's typed rules still need to see them, so
    // we point at a lint-only tsconfig that widens `include` back out.
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
  overrides: [
    {
      // Spec / test files have a different quality profile from
      // production code: they mock heavily, freely use `!` after
      // `expect()` narrowing, and pull in types via inline `import()`
      // for one-off assertions. Keep application code strict; relax
      // test code where the invariants we care about (behaviour
      // being tested) still stand.
      files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
