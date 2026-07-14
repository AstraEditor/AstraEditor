const path = require('path');

module.exports = {
  extends: ['scratch', 'scratch/es6', 'scratch/react', 'plugin:import/errors', 'plugin:prettier/recommended'],
  env: {
    browser: true,
    es2020: true
  },
  globals: {
    process: true,
    EditorPreload: true,
    TurboWarp_Exts: true,
    HotReloadDebug: true,
    openAstraEditorSettings: true
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
    'no-warning-comments': 'off',
    'react/jsx-no-literals': 'off',
    eqeqeq: 'off',
    'no-alert': 'off',
    'no-negated-condition': 'off',
    'react/jsx-handler-names': 'off',
    camelcase: 'off',
    'func-style': 'off',
    'react/no-danger': 'off',
    'no-eq-null': 'off',
    'no-template-curly-in-string': 'off',
    radix: 'off',
    'no-fallthrough': 'off',
    'no-constant-condition': 'off',
    'react/no-did-mount-set-state': 'off',
    'require-await': 'off',
    'react/no-unescaped-entities': 'off',
    'no-dupe-keys': 'off',
    'no-duplicate-imports': 'off',
    'array-callback-return': 'off',
    'no-unused-expressions': 'off',
    'no-confusing-arrow': ['error', { allowParens: true }],
    'import/no-commonjs': 'off',
    'import/no-mutable-exports': 'off'
  },
  overrides: [
    {
      files: ['**/.eslintrc.js'],
      env: { node: true },
      rules: { 'import/no-commonjs': 'off' }
    }
  ],
  settings: {
    react: { version: '16.2' },
    'import/resolver': {
      webpack: { config: path.resolve(__dirname, '../webpack.config.js') }
    }
  }
};
