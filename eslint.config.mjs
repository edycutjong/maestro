import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'docs/**'] },
  ...tseslint.configs.recommended,
);
