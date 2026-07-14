module.exports = {
  extends: ['scratch', 'scratch/node', 'plugin:prettier/recommended'],
  env: {
    es6: true
  },
  rules: {
    'valid-jsdoc': 'off',
    'global-require': 'off',
    'no-unused-vars': ['warn', { args: 'after-used', varsIgnorePattern: '^_' }],
    'no-undefined': 'off',
    'no-useless-concat': 'off',
    'prefer-promise-reject-errors': 'off',
    'no-use-before-define': 'off',
    'no-shadow': 'off',
    'import/namespace': 'off',
    'react/prop-types': 'off',
    'react/forbid-prop-types': 'off',
    'react/no-unused-prop-types': 'off',
    'react/no-multi-comp': 'off',
    'react/sort-comp': 'off',
    'react/jsx-no-bind': 'off',
    'react/jsx-filename-extension': 'off',
    'no-confusing-arrow': 'off',
    'prefer-template': 'off',
    'require-await': 'off',
    'no-return-await': 'off',
    'require-atomic-updates': 'off',
    'prefer-const': 'off'
  }
};
