import { baseConfig } from '@icon/config/eslint/base';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/docs/write-lifecycle-doc.ts'],
    rules: { 'no-console': 'off' },
  },
];
