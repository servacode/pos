import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Tab 14 › مصدر واحد: web screens name colours by token (bg-surface, text-ink-muted,
// border-line-control…), never by palette shade (bg-brand-900, text-white), arbitrary value
// (bg-[#0b8a62]) or raw colour string ('#fff', 'oklch(…)'). Tokens live in apps/web/src/styles.css.
const RAW_COLOUR = [
  String.raw`\b(?:bg|text|border|ring|outline|fill|stroke|divide|decoration|accent|caret|shadow|from|via|to|placeholder)(?:-[a-z]{1,6})?-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand)-\d{2,3})\b`,
  String.raw`-\[(?:#|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\()`,
  String.raw`^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`,
  String.raw`\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(`,
].join('|');
const RAW_COLOUR_MESSAGE =
  'Use a colour token (bg-surface, text-ink-muted, border-line-control, bg-success-soft…), not a palette shade or raw colour. See docs/specs/14-design-system.md.';

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
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Moving focus into a field the user just opened (e.g. «عندك كود وكيل؟») is intended.
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/web/src/test/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=/${RAW_COLOUR}/]`, message: RAW_COLOUR_MESSAGE },
        { selector: `TemplateElement[value.raw=/${RAW_COLOUR}/]`, message: RAW_COLOUR_MESSAGE },
      ],
    },
  },
);
