'use strict';

const RAT_MAGIC = 0x52415432;
const RAT_VERSION = 1;
const HEADER_SIZE = 36;

const PKT = {
  AGENT_HELLO: 0x0001,
  AGENT_WELCOME: 0x0002,
  AGENT_HEARTBEAT: 0x0003,

  AGENT_LIST_REQUEST: 0x0010,
  AGENT_LIST: 0x0011,

  SESSION_OPEN: 0x0020,
  SESSION_ACCEPT: 0x0021,
  SESSION_REJECT: 0x0022,
  SESSION_CLOSE: 0x0023,

  VIDEO_CONFIG: 0x0030,
  VIDEO_FRAME: 0x0031,
  VIDEO_KEYFRAME_REQUEST: 0x0032,

  MOUSE_MOVE: 0x0040,
  MOUSE_BUTTON: 0x0041,
  MOUSE_WHEEL: 0x0042,
  KEY: 0x0043,

  PING: 0x0050,
  PONG: 0x0051,

  AGENT_STATS: 0x0060,
  SESSION_STATS: 0x0061,
};

function writeFixedString(buf, value, offset, length) {
  buf.fill(0, offset, offset + length);
  const segment = String(value).padEnd(length, '\0').slice(0, length);
  const bytes = Buffer.from(segment, 'utf8');
  bytes.copy(buf, offset, 0, length);
}

function readFixedString(buf, offset, length) {
  return buf.toString('utf8', offset, offset + length).replace(/\0+$/, '');
}

function encodeHeader({ type, payloadSize = 0, sessionId = 0, sequence = 0, timestampUs = Date.now() * 1000 }) {
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.writeUInt32LE(RAT_MAGIC, 0);
  buf.writeUInt16LE(RAT_VERSION, 4);
  buf.writeUInt16LE(type, 6);
  buf.writeUInt32LE(payloadSize, 8);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(sessionId)), 12);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(sequence)), 20);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(timestampUs)), 28);
  return buf;
}

function decodeHeader(buf) {
  if (buf.length < HEADER_SIZE) return null;
  return {
    magic: buf.readUInt32LE(0),
    version: buf.readUInt16LE(4),
    type: buf.readUInt16LE(6),
    payloadSize: buf.readUInt32LE(8),
    sessionId: Number(buf.readBigUInt64LE(12)),
    sequence: Number(buf.readBigUInt64LE(20)),
    timestampUs: Number(buf.readBigUInt64LE(28)),
  };
}

function encodeAgentInfo(info) {
  const buf = Buffer.alloc(209);
  writeFixedString(buf, info.agentId, 0, 40);
  writeFixedString(buf, info.displayName, 40, 64);
  writeFixedString(buf, info.hostname, 104, 64);
  writeFixedString(buf, info.version, 168, 32);
  buf.writeUInt16LE(info.screenWidth || 0, 200);
  buf.writeUInt16LE(info.screenHeight || 0, 202);
  buf.writeUInt32LE(info.capabilities || 0, 204);
  buf.writeUInt8(info.status || 0, 208);
  return buf;
}

function decodeAgentHello(payload) {
  return {
    agentId: readFixedString(payload, 0, 40),
    displayName: readFixedString(payload, 40, 64),
    hostname: readFixedString(payload, 104, 64),
    version: readFixedString(payload, 168, 32),
    screenWidth: payload.readUInt16LE(200),
    screenHeight: payload.readUInt16LE(202),
    capabilities: payload.readUInt32LE(204),
    status: payload.readUInt8(208),
  };
}

function encodeAgentWelcome(assignedAgentId = 0, timestamp = Date.now()) {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(assignedAgentId)), 0);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(timestamp)), 8);
  return buf;
}

function encodeAgentList(agents) {
  const infos = agents.map(encodeAgentInfo);
  const total = 4 + infos.reduce((sum, b) => sum + b.length, 0);
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(agents.length, 0);
  let offset = 4;
  for (const b of infos) {
    b.copy(buf, offset);
    offset += b.length;
  }
  return buf;
}

function encodeSessionOpen(agentId, requestedQuality = 70) {
  const buf = Buffer.alloc(44);
  writeFixedString(buf, agentId, 0, 40);
  buf.writeUInt32LE(requestedQuality, 40);
  return buf;
}

function encodeSessionAccept({ sessionId, videoWidth, videoHeight, fps }) {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(sessionId)), 0);
  buf.writeUInt16LE(videoWidth, 8);
  buf.writeUInt16LE(videoHeight, 10);
  buf.writeUInt32LE(fps, 12);
  return buf;
}

function decodeSessionAccept(payload) {
  return {
    sessionId: Number(payload.readBigUInt64LE(0)),
    videoWidth: payload.readUInt16LE(8),
    videoHeight: payload.readUInt16LE(10),
    fps: payload.readUInt32LE(12),
  };
}

function encodeSessionReject(reason) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(reason, 0);
  return buf;
}

function decodeSessionReject(payload) {
  return { reason: payload.readUInt32LE(0) };
}

function encodeVideoConfig({ width, height, codec = 0, quality = 70, fps = 15 }) {
  const buf = Buffer.alloc(8);
  buf.writeUInt16LE(width, 0);
  buf.writeUInt16LE(height, 2);
  buf.writeUInt8(codec, 4);
  buf.writeUInt8(quality, 5);
  buf.writeUInt16LE(fps, 6);
  return buf;
}

function decodeVideoConfig(payload) {
  return {
    width: payload.readUInt16LE(0),
    height: payload.readUInt16LE(2),
    codec: payload.readUInt8(4),
    quality: payload.readUInt8(5),
    fps: payload.readUInt16LE(6),
  };
}

function encodeVideoFrame({ width, height, isKeyframe = 1, frameNumber = 0, data }) {
  const buf = Buffer.alloc(13 + data.length);
  buf.writeUInt16LE(width, 0);
  buf.writeUInt16LE(height, 2);
  buf.writeUInt32LE(data.length, 4);
  buf.writeUInt8(isKeyframe, 8);
  buf.writeUInt32LE(frameNumber, 9);
  data.copy(buf, 13);
  return buf;
}

function decodeVideoFrame(payload) {
  if (payload.length < 13) return null;
  const width = payload.readUInt16LE(0);
  const height = payload.readUInt16LE(2);
  const dataSize = payload.readUInt32LE(4);
  const isKeyframe = payload.readUInt8(8);
  const frameNumber = payload.readUInt32LE(9);
  const data = payload.slice(13, 13 + dataSize);
  return { width, height, dataSize, isKeyframe, frameNumber, data };
}

function encodeMouseMove(x, y) {
  const buf = Buffer.alloc(8);
  buf.writeFloatLE(x, 0);
  buf.writeFloatLE(y, 4);
  return buf;
}

function encodeMouseButton(button, down) {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(button, 0);
  buf.writeUInt8(down ? 1 : 0, 1);
  return buf;
}

function encodeMouseWheel(delta) {
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(delta, 0);
  return buf;
}

function encodeKey(vk, down) {
  const buf = Buffer.alloc(3);
  buf.writeUInt16LE(vk, 0);
  buf.writeUInt8(down ? 1 : 0, 2);
  return buf;
}

function encodePingPong(timestamp = Date.now() * 1000) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt.asUintN(64, BigInt(timestamp)), 0);
  return buf;
}

function decodePingPong(payload) {
  return { timestamp: Number(payload.readBigUInt64LE(0)) };
}

function sendPacket(socket, type, payload = Buffer.alloc(0), { sessionId = 0, sequence = 0, timestampUs = Date.now() * 1000 } = {}) {
  if (!socket || socket.destroyed) return false;
  const header = encodeHeader({ type, payloadSize: payload.length, sessionId, sequence, timestampUs });
  return socket.write(Buffer.concat([header, payload]));
}

class Parser {
  constructor(socket, onPacket) {
    this.socket = socket;
    this.onPacket = onPacket;
    this.buffer = Buffer.alloc(0);
    socket.on('data', (data) => this.feed(data));
    socket.on('close', () => { this.buffer = null; });
  }

  feed(data) {
    if (!this.buffer) return;
    this.buffer = Buffer.concat([this.buffer, data]);

    while (true) {
      if (this.buffer.length < HEADER_SIZE) return;
      const header = decodeHeader(this.buffer);
      if (!header || header.magic !== RAT_MAGIC || header.version !== RAT_VERSION) {
        this.socket.destroy();
        return;
      }
      const total = HEADER_SIZE + header.payloadSize;
      if (this.buffer.length < total) return;
      const payload = this.buffer.slice(HEADER_SIZE, total);
      this.buffer = this.buffer.slice(total);
      this.onPacket(header, payload);
    }
  }
}

module.exports = {
  RAT_MAGIC,
  RAT_VERSION,
  HEADER_SIZE,
  PKT,
  Parser,
  sendPacket,
  encodeHeader,
  decodeHeader,
  encodeAgentInfo,
  decodeAgentHello,
  encodeAgentWelcome,
  encodeAgentList,
  encodeSessionOpen,
  encodeSessionAccept,
  decodeSessionAccept,
  encodeSessionReject,
  decodeSessionReject,
  encodeVideoConfig,
  decodeVideoConfig,
  encodeVideoFrame,
  decodeVideoFrame,
  encodeMouseMove,
  encodeMouseButton,
  encodeMouseWheel,
  encodeKey,
  encodePingPong,
  decodePingPong,
};
