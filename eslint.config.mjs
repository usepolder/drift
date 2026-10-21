import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'lib/**', 'node_modules/**', 'tests/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      // Shared /g regexes keep lastIndex state between scans. Use matchAll
      // (which clones the regex) instead of exec/test loops on a reused regex.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='exec'][callee.object.type='Identifier'][callee.object.name=/_RE$/]",
          message: 'Do not call exec on a shared module-level regex. Use String.prototype.matchAll.',
        },
      ],
    },
  },
  {
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
