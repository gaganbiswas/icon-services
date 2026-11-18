import { baseConfig } from '@icon/config/eslint/base';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // NestJS uses classes as DI tokens; keep value imports for decorated
    // constructor parameters so `emitDecoratorMetadata` can reference them.
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
