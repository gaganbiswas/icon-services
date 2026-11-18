// Shared ESLint flat config for React (Vite) apps.
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/**
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function reactConfig({ tsconfigRootDir }) {
  return tseslint.config(...baseConfig({ tsconfigRootDir }), reactHooks.configs.flat.recommended, {
    languageOptions: {
      globals: { ...globals.browser },
    },
  });
}
