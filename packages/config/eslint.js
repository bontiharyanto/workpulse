/**
 * Physical file at the resolved path for `@workpulse/config/eslint`.
 *
 * Node.js's legacy CJS resolver (used by ESLint 8 config extends) only
 * probes `.js`, `.json`, and `.node` extensions when the caller does
 * not spell out a suffix — so a `.cjs` file at this location would
 * NOT satisfy `extends: '@workpulse/config/eslint'`. Keep this file
 * as plain `.js` (CommonJS by convention: no `"type": "module"` in
 * the package.json).
 *
 * When we upgrade to ESLint 9 flat config, this file and
 * `eslint-preset.cjs` collapse into a single `eslint.config.js`.
 */
module.exports = require('./eslint-preset.cjs');
