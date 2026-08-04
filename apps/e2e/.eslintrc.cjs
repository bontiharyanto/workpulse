module.exports = {
  root: true,
  extends: [require.resolve('@workpulse/config/eslint')],
  parserOptions: {
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Playwright test files use `test('...', async ({ page }) => {})`
    // — parameters that aren't consumed in every step are common.
    '@typescript-eslint/no-unused-vars': 'off',
    'unused-imports/no-unused-vars': 'off',
    // Test-code pragmatism: Playwright helpers return `string | null`
    // (`page.getAttribute`, `page.textContent`, …) and asserting
    // non-null after `expect(...).toBeVisible()` is the idiomatic path.
    // The invariants we care about (types, business logic) live in
    // application code where this rule stays strict.
    '@typescript-eslint/no-non-null-assertion': 'off',
    // Legacy loop counters in some specs — not worth churning; block
    // scope violations that could hide bugs are still caught by tsc.
    'no-var': 'off',
    // E2E specs freely use inline `import('./foo').Bar` type refs when
    // they only need a type once and don't want a top-level import that
    // could accidentally trigger side-effect loading. Application code
    // keeps this rule strict so refactors stay consistent.
    '@typescript-eslint/consistent-type-imports': 'off',
  },
};
