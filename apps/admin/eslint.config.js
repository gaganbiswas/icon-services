import { reactConfig } from '@icon/config/eslint/react';

export default [
  { ignores: ['src/routeTree.gen.ts'] },
  ...reactConfig({ tsconfigRootDir: import.meta.dirname }),
];
