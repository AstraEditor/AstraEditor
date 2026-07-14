/* eslint-disable import/no-commonjs */
module.exports = {
  /* eslint-enable import/no-commonjs */
  extends: ['scratch', 'scratch/es6', 'scratch/react', 'plugin:import/recommended', 'plugin:prettier/recommended'],
  env: {
    browser: true
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
    'react/no-unknown-property': 'off',
    'import/no-mutable-exports': 'error',
    'import/no-commonjs': 'error',
    'import/no-amd': 'error',
    'import/no-nodejs-modules': 'error',
    'import/no-unresolved': [
      'error',
      {
        ignore: ['^!']
      }
    ]
  },
  settings: {
    react: {
      version: '16.2'
    }
  }
};
