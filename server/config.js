'use strict';

const path = require('path');

module.exports = {
  AGENT_PORT: Number(process.env.AGENT_PORT) || 5556,
  HTTP_PORT: Number(process.env.HTTP_PORT) || 3000,
  HEARTBEAT_TIMEOUT_MS: 15000,
  HEARTBEAT_CHECK_INTERVAL_MS: 5000,
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
};
