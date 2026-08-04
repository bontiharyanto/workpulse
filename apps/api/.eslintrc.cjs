module.exports = {
  root: true,
  extends: ['@workpulse/config/eslint'],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
