module.exports = {
  extends: ['scratch', 'scratch/es6', 'plugin:prettier/recommended'],
  env: { browser: true },
  globals: { Target: true },
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
    'require-atomic-updates': 'off',
    'no-unused-expressions': 'off',
    'react/prop-types': 'off',
    'react/forbid-prop-types': 'off',
    'react/no-unused-prop-types': 'off',
    'react/no-multi-comp': 'off',
    'react/sort-comp': 'off',
    'react/jsx-no-bind': 'off'
  }
};
