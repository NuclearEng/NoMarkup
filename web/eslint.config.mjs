import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Globals the Node scripts under scripts/ actually use. Listed explicitly
// rather than importing the `globals` package, which is only a transitive
// dependency here.
const NODE_SCRIPT_GLOBALS = {
  process: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  Buffer: 'readonly',
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Plain Node scripts (CLI tooling + lighthouserc.cjs) are not part of the
    // TypeScript project (tsconfig `include` is ts/tsx only), so the
    // projectService-backed parser cannot load them and every one of them
    // failed with "Parsing error: ... was not found by the project service".
    // Lint them with the same rule set minus the rules that need type
    // information, and with Node's globals instead of the browser's.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: NODE_SCRIPT_GLOBALS,
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // These are command-line tools: stdout/stderr IS their interface. The
      // no-console rule exists to keep console.* out of the shipped app.
      'no-console': 'off',
    },
  },
  {
    // CommonJS config consumed by @lhci/cli via require().
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    ignores: [
      '.next/',
      'node_modules/',
      'coverage/',
      '*.config.*',
      'next-env.d.ts',
      // The service worker is a plain JS file consumed by the browser, not
      // part of the TypeScript project — exclude it from type-checked lint.
      'public/sw.js',
      'public/**/*.js',
    ],
  },
);
