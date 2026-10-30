import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'packages/db/drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The store context of row-level security is set only by withTenant() in packages/db. Raw SQL
    // or a set_config call elsewhere could switch stores, so both are refused outside packages/db.
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'sql', property: 'raw', message: 'sql.raw is only allowed inside packages/db.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TemplateElement[value.raw=/set_config|app\\.tenant_id/i]',
          message: 'The store context is set only by withTenant() in packages/db.',
        },
        {
          selector: 'Literal[value=/set_config|app\\.tenant_id/i]',
          message: 'The store context is set only by withTenant() in packages/db.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
