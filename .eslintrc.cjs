/**
 * ESLint 8 (eslintrc) rather than a flat config, because that's the ESLint the repo
 * pins and what `npm run lint`'s `--ext ts,tsx` expects. Type-aware rules are
 * deliberately off: `npm run typecheck` already runs the compiler, and doing it twice
 * only makes lint slow.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  ignorePatterns: ['dist', 'src-tauri/gen', 'src-tauri/target'],
  rules: {
    // Unused args are fine when they document a signature; leading _ opts out.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
  },
};
