module.exports = {
  root: true,
  extends: ['next/core-web-vitals', require.resolve('@workpulse/config/eslint')],
  parserOptions: {
    tsconfigRootDir: __dirname,
  },
};
