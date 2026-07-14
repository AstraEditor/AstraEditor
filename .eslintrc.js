module.exports = {
  root: true,
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
    ecmaVersion: 2018
  },
  extends: ['scratch', 'scratch/es6', 'plugin:prettier/recommended'],
  env: {
    es6: true
  },
  rules: {
    'import/namespace': 'off',
    'valid-jsdoc': 'off',
    'react/prop-types': 'off',
    'react/forbid-prop-types': 'off',
    'react/no-unused-prop-types': 'off',
    'react/no-multi-comp': 'off',
    'react/sort-comp': 'off',
    'react/jsx-no-bind': 'off',
    'no-shadow': 'off',
    'no-unused-vars': ['warn', { args: 'after-used', varsIgnorePattern: '^_' }],
    'global-require': 'off',
    'no-useless-concat': 'off',
    'no-use-before-define': 'off'
  }
};
