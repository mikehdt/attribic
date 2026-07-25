import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.cache/**',
    'public/models/**',
    'out/**',
    'build/**',
    '**/.venv/**',
    'next-env.d.ts',
    'node_modules/**',
    // Plain Node.js worker scripts (not bundled, use require())
    'workers/**',
  ]),
  {
    ignores: ['node_modules/**', 'dist/**'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
]);

export default eslintConfig;
