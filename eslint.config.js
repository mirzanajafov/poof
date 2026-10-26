import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import vitest from '@vitest/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist', '**/.next', 'apps/web/next-env.d.ts', 'packages/db/src/generated']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/no-inferrable-types': ['error', { ignoreProperties: true }],
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: 'only-allowed-literals' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  { files: ['**/*.{js,cjs,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, nextPlugin.configs['core-web-vitals']],
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    files: ['**/test/**/*.ts', '**/*.{spec,test}.{ts,tsx}'],
    extends: [vitest.configs.recommended],
    rules: {
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expectTypeOf'] }],
    },
  },
)
