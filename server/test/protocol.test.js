'use strict';

const test = require('node:test');
const assert = require('node:assert');
const protocol = require('../protocol');

test('encode and decode packet header', () => {
  const header = protocol.encodeHeader({
    type: protocol.PKT.AGENT_HELLO,
    payloadSize: 0,
    sessionId: 7,
    sequence: 3,
    timestampUs: 1234567890,
  });
  const decoded = protocol.decodeHeader(header);

  assert.equal(decoded.magic, protocol.RAT_MAGIC);
  assert.equal(decoded.version, protocol.RAT_VERSION);
  assert.equal(decoded.type, protocol.PKT.AGENT_HELLO);
  assert.equal(decoded.sessionId, 7);
  assert.equal(decoded.sequence, 3);
  assert.equal(decoded.payloadSize, 0);
});

test('encode and decode AgentInfo', () => {
  const payload = protocol.encodeAgentInfo({
    agentId: '76b2e569-ef41-45b1-88fc-0f96fd4d251d',
    displayName: 'carl@pc',
    hostname: 'pc',
    version: '1.0.0',
    screenWidth: 1920,
    screenHeight: 1080,
    capabilities: protocol.PKT.AGENT_HELLO,
    status: 0,
  });

  const info = protocol.decodeAgentHello(payload);

  assert.equal(info.agentId, '76b2e569-ef41-45b1-88fc-0f96fd4d251d');
  assert.equal(info.displayName, 'carl@pc');
  assert.equal(info.hostname, 'pc');
  assert.equal(info.version, '1.0.0');
  assert.equal(info.screenWidth, 1920);
  assert.equal(info.screenHeight, 1080);
  assert.equal(info.status, 0);
});

test('encode and decode session accept', () => {
  const payload = protocol.encodeSessionAccept({
    sessionId: 1,
    videoWidth: 1280,
    videoHeight: 720,
    fps: 15,
  });
  const decoded = protocol.decodeSessionAccept(payload);

  assert.equal(decoded.sessionId, 1);
  assert.equal(decoded.videoWidth, 1280);
  assert.equal(decoded.videoHeight, 720);
  assert.equal(decoded.fps, 15);
});
