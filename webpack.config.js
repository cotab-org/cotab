const path = require('path');
const webpack = require('webpack');

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
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
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
    // Force single bundle
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
  ]
};
