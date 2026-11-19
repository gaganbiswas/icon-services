import { baseConfig } from '@icon/config/eslint/base';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // Command-line seed script: console output is its user interface.
    files: ['src/seed/dev.ts', 'src/seed/uat.ts'],
    rules: { 'no-console': 'off' },
  },
];
