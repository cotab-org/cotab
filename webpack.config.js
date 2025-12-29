const path = require('path');
const webpack = require('webpack');
const { NLSBundlePlugin } = require('vscode-nls-dev/lib/webpack-bundler');

module.exports = {
  mode: 'production',
  entry: './src/extension.ts',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    clean: true
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
    'bufferutil': 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
    'canvas': 'commonjs canvas'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      'handlebars$': 'handlebars/dist/handlebars.js'
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'vscode-nls-dev/lib/webpack-loader',
            options: {
              // Base directory for computing module ids (e.g. ui/gettingStartedView)
              base: path.join(__dirname, 'src')
            }
          },
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  optimization: {
    minimize: false,
    splitChunks: false,
    runtimeChunk: false
  },
  plugins: [
    // Generate nls metadata/header from per-module *.nls.metadata.json emitted by the loader
    new NLSBundlePlugin('cotab'),
    // Force single bundle
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
  ]
};
