module.exports = {
  extends: ['scratch/react', 'scratch/es6', 'plugin:jest/recommended', 'plugin:prettier/recommended'],
  env: {
    browser: true,
    jest: true
  },
  plugins: ['jest'],
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
    'react/jsx-no-literals': 'off',
    'react/no-danger': 'off',
    eqeqeq: 'off',
    camelcase: 'off',
    'func-style': 'off',
    'no-console': 'off',
    'no-eq-null': 'off',
    'react/no-unescaped-entities': 'off',
    'no-constant-condition': 'off',
    'no-unused-expressions': 'off'
  }
};
