'use strict';
/** 运行配置，全部来自环境变量 */

const path = require('node:path');

module.exports = {
  PORT: Number(process.env.PORT || 8686),
  HOST: process.env.HOST || '0.0.0.0',
  PIN: process.env.PIN || '',
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),
  ROOT: path.join(__dirname, '..'),
};
