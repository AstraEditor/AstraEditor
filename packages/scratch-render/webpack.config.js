const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

const base = {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devServer: {
        static: false,
        host: '0.0.0.0',
        port: process.env.PORT || 8361,
        hot: true,
        allowedHosts: 'all'
    },
    devtool: 'cheap-module-source-map',
    resolve: {
        fallback: {
            "buffer": require.resolve("buffer/"),
            "process": require.resolve("process/browser"),
            "events": require.resolve("events/"),
        }
    },
    module: {
        rules: [
            {
                include: [
                    path.resolve('src')
                ],
                test: /\.js$/,
                loader: 'babel-loader',
                options: {
                    presets: [['@babel/preset-env', { targets: { browsers: ['last 3 versions', 'Safari >= 8', 'iOS >= 8'] } }]]
                }
            },
            {
                test: /\.(vert|frag|glsl)$/,
                use: [
                    {
                        loader: 'raw-loader',
                        options: {
                            esModule: false
                        }
                    }
                ]
            }
        ]
    },
    optimization: {
        minimize: process.env.NODE_ENV === 'production',
        minimizer: [
            new TerserPlugin({
                include: /\.min\.js$/
            })
        ]
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser'
        })
    ]
};

module.exports = [
    // Playground
    {
        ...base,
        name: 'playground',
        target: 'web',
        entry: {
            playground: './src/playground/playground.js',
            queryPlayground: './src/playground/queryPlayground.js'
        },
        output: {
            libraryTarget: 'umd',
            path: path.resolve('playground'),
            filename: '[name].js'
        },
        plugins: base.plugins.concat([
            new CopyWebpackPlugin({
                patterns: [
                    {
                        context: 'src/playground',
                        from: '*.+(html|css)'
                    }
                ]
            })
        ])
    },
    // Web-compatible
    {
        ...base,
        name: 'web',
        target: 'web',
        entry: {
            'scratch-render': './src/index.js',
            'scratch-render.min': './src/index.js'
        },
        output: {
            library: 'ScratchRender',
            libraryTarget: 'umd',
            path: path.resolve('dist', 'web'),
            filename: '[name].js',
            globalObject: 'this'
        }
    },
    // Node-compatible
    {
        ...base,
        name: 'node',
        target: 'node',
        entry: {
            'scratch-render': './src/index.js'
        },
        output: {
            library: 'ScratchRender',
            libraryTarget: 'commonjs2',
            path: path.resolve('dist', 'node'),
            filename: '[name].js'
        },
        externals: {
            '!ify-loader!grapheme-breaker': 'grapheme-breaker',
            '!ify-loader!linebreak': 'linebreak',
            'hull.js': true,
            '@turbowarp/scratch-svg-renderer': true,
            'twgl.js': true,
            'xml-escape': true
        },
        resolve: {
            fallback: {}
        },
        plugins: [] 
    }
];