'use strict';

const net = require('net');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const protocol = require('./protocol');
const db = require('./db');
const config = require('./config');

const agents = new Map();
const operators = new Set();
let sessionCounter = 0;

function getClientAddress(socket) {
  let addr = socket.remoteAddress || '';
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  return addr;
}

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  for (const ws of operators) {
    if (ws.readyState === 1) ws.send(message);
  }
}

function buildAgentList() {
  const rows = db.getAll();
  const online = new Map(agents);
  const list = [];

  for (const row of rows) {
    const a = online.get(row.agent_id);
    list.push({
      agentId: row.agent_id,
      displayName: a ? a.info.displayName : row.last_display_name || '',
      hostname: a ? a.info.hostname : row.last_hostname || '',
      version: a ? a.info.version : row.last_version || '',
      ip: a ? a.address : row.last_ip || '',
      resolution: a ? `${a.info.screenWidth}x${a.info.screenHeight}` : '',
      capabilities: a ? a.info.capabilities : 0,
      status: a ? a.state : 'offline',
      lastSeen: a ? a.lastHeartbeat : row.last_disconnected || row.last_connected,
      lastSession: row.last_session_at,
      firstSeen: row.first_seen,
      connectionCount: row.connection_count,
      sessionCount: row.session_count,
    });
  }

  for (const [id, a] of online) {
    if (!rows.some((r) => r.agent_id === id)) {
      list.push({
        agentId: id,
        displayName: a.info.displayName,
        hostname: a.info.hostname,
        version: a.info.version,
        ip: a.address,
        resolution: `${a.info.screenWidth}x${a.info.screenHeight}`,
        capabilities: a.info.capabilities,
        status: a.state,
        lastSeen: a.lastHeartbeat,
        lastSession: null,
        firstSeen: a.connectedAt,
        connectionCount: 1,
        sessionCount: 0,
      });
    }
  }

  return list;
}

function broadcastAgentList() {
  broadcast('agents', buildAgentList());
}

function releaseSession(agentId) {
  const agent = agents.get(agentId);
  if (!agent) return;
  const ws = agent.operatorSocket;
  agent.state = 'available';
  agent.sessionId = null;
  agent.operatorSocket = null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'sessionClosed', payload: { agentId } }));
  }
  broadcastAgentList();
}

function closeAgentSocket(agentId, reason) {
  const agent = agents.get(agentId);
  if (!agent) return;

  if (agent.sessionId !== null) {
    releaseSession(agentId);
  }

  agents.delete(agentId);
  db.disconnect(agentId);
  broadcastAgentList();

  if (agent.socket && !agent.socket.destroyed) {
    agent.socket.end();
  }
  console.log(`[AGENT] ${agentId} closed (${reason})`);
}

function handleAgentPacket(agent, header, payload) {
  switch (header.type) {
    case protocol.PKT.AGENT_HEARTBEAT:
      agent.lastHeartbeat = Date.now();
      break;

    case protocol.PKT.AGENT_STATS:
      break;

    case protocol.PKT.SESSION_ACCEPT: {
      const acc = protocol.decodeSessionAccept(payload);
      agent.sessionId = acc.sessionId;
      agent.state = 'streaming';
      db.recordSession(agent.info.agentId);
      if (agent.operatorSocket && agent.operatorSocket.readyState === 1) {
        agent.operatorSocket.send(JSON.stringify({
          type: 'sessionAccepted',
          payload: { ...acc, agentId: agent.info.agentId },
        }));
      }
      broadcastAgentList();
      break;
    }

    case protocol.PKT.SESSION_REJECT: {
      const rej = protocol.decodeSessionReject(payload);
      const ws = agent.operatorSocket;
      agent.state = 'available';
      agent.sessionId = null;
      agent.operatorSocket = null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'sessionRejected',
          payload: { reason: rej.reason, agentId: agent.info.agentId },
        }));
      }
      broadcastAgentList();
      break;
    }

    case protocol.PKT.SESSION_CLOSE:
      releaseSession(agent.info.agentId);
      break;

    case protocol.PKT.VIDEO_CONFIG: {
      const cfg = protocol.decodeVideoConfig(payload);
      if (agent.operatorSocket && agent.operatorSocket.readyState === 1) {
        agent.operatorSocket.send(JSON.stringify({ type: 'videoConfig', payload: cfg }));
      }
      break;
    }

    case protocol.PKT.VIDEO_FRAME: {
      const frame = protocol.decodeVideoFrame(payload);
      if (!frame) break;
      if (agent.operatorSocket && agent.operatorSocket.readyState === 1) {
        agent.operatorSocket.send(JSON.stringify({
          type: 'videoFrame',
          payload: {
            sessionId: header.sessionId,
            width: frame.width,
            height: frame.height,
            frameNumber: frame.frameNumber,
            isKeyframe: !!frame.isKeyframe,
            data: frame.data.toString('base64'),
          },
        }));
      }
      break;
    }

    case protocol.PKT.PONG:
    case protocol.PKT.SESSION_STATS:
      if (agent.operatorSocket && agent.operatorSocket.readyState === 1) {
        agent.operatorSocket.send(JSON.stringify({
          type: 'packet',
          payload: { type: header.type, sessionId: header.sessionId },
        }));
      }
      break;

    default:
      console.log(`[AGENT] unknown packet 0x${header.type.toString(16)} from ${agent.info.agentId}`);
  }
}

function startAgentListener(port) {
  const server = net.createServer((socket) => {
    const address = getClientAddress(socket);
    console.log(`[AGENT] connection from ${address}:${socket.remotePort}`);

    let agentId = null;

    const parser = new protocol.Parser(socket, (header, payload) => {
      if (header.type === protocol.PKT.AGENT_HELLO) {
        if (agentId) return;
        const info = protocol.decodeAgentHello(payload);
        agentId = info.agentId;

        const existing = agents.get(agentId);
        if (existing) {
          protocol.sendPacket(existing.socket, protocol.PKT.SESSION_CLOSE, Buffer.alloc(0), { sessionId: existing.sessionId || 0 });
          existing.socket.end();
          agents.delete(agentId);
        }

        const agent = {
          socket,
          info,
          address,
          state: 'available',
          sessionId: null,
          operatorSocket: null,
          lastHeartbeat: Date.now(),
          connectedAt: Date.now(),
          sequence: 0,
        };

        agents.set(agentId, agent);
        db.touch(info, address);
        protocol.sendPacket(socket, protocol.PKT.AGENT_WELCOME, protocol.encodeAgentWelcome(0, Date.now()), { sequence: agent.sequence++ });
        broadcastAgentList();
      } else if (agentId) {
        const agent = agents.get(agentId);
        if (!agent || agent.socket !== socket) return;
        handleAgentPacket(agent, header, payload);
      } else {
        socket.end();
      }
    });

    socket.on('close', () => {
      if (agentId) closeAgentSocket(agentId, 'disconnected');
      console.log(`[AGENT] disconnected ${address}`);
    });

    socket.on('error', (err) => {
      console.log(`[AGENT] socket error: ${err.message}`);
      socket.destroy();
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[RELAY] agents on 0.0.0.0:${port}`);
  });

  return server;
}

function handleOperatorMessage(ws, msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'requestAgents':
      broadcastAgentList();
      break;

    case 'sessionOpen': {
      const { agentId } = payload || {};
      const agent = agents.get(agentId);
      if (!agent || agent.state !== 'available') {
        ws.send(JSON.stringify({
          type: 'sessionRejected',
          payload: { agentId, reason: agent ? 1 : 0 },
        }));
        return;
      }

      sessionCounter += 1;
      agent.state = 'reserved';
      agent.sessionId = sessionCounter;
      agent.operatorSocket = ws;

      const ok = protocol.sendPacket(agent.socket, protocol.PKT.SESSION_OPEN, protocol.encodeSessionOpen(agentId, 70), {
        sessionId: sessionCounter,
        sequence: agent.sequence++,
      });

      if (!ok) {
        releaseSession(agentId);
      }
      broadcastAgentList();
      break;
    }

    case 'sessionClose': {
      const { agentId } = payload || {};
      const agent = agents.get(agentId);
      if (!agent || agent.operatorSocket !== ws) return;
      protocol.sendPacket(agent.socket, protocol.PKT.SESSION_CLOSE, Buffer.alloc(0), {
        sessionId: agent.sessionId || 0,
        sequence: agent.sequence++,
      });
      releaseSession(agentId);
      break;
    }

    case 'mouseMove':
    case 'mouseButton':
    case 'mouseWheel':
    case 'key':
    case 'keyframeRequest':
    case 'ping': {
      const { agentId, sessionId } = payload || {};
      const agent = agents.get(agentId);
      if (!agent || agent.operatorSocket !== ws || agent.sessionId !== sessionId) return;

      let buf = Buffer.alloc(0);
      let pktType = 0;

      switch (type) {
        case 'mouseMove':
          pktType = protocol.PKT.MOUSE_MOVE;
          buf = protocol.encodeMouseMove(payload.x, payload.y);
          break;
        case 'mouseButton':
          pktType = protocol.PKT.MOUSE_BUTTON;
          buf = protocol.encodeMouseButton(payload.button, payload.down);
          break;
        case 'mouseWheel':
          pktType = protocol.PKT.MOUSE_WHEEL;
          buf = protocol.encodeMouseWheel(payload.delta);
          break;
        case 'key':
          pktType = protocol.PKT.KEY;
          buf = protocol.encodeKey(payload.vk, payload.down);
          break;
        case 'keyframeRequest':
          pktType = protocol.PKT.VIDEO_KEYFRAME_REQUEST;
          break;
        case 'ping':
          pktType = protocol.PKT.PING;
          buf = protocol.encodePingPong(payload.timestamp);
          break;
      }

      protocol.sendPacket(agent.socket, pktType, buf, {
        sessionId,
        sequence: agent.sequence++,
      });
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', payload: `unknown command ${type}` }));
  }
}

function startWebServer(httpPort) {
  const app = express();
  const webDist = path.join(__dirname, '..', 'web', 'dist');

  app.use(express.static(webDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[OPERATOR] connected');
    operators.add(ws);
    ws.send(JSON.stringify({ type: 'agents', payload: buildAgentList() }));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: 'invalid json' }));
        return;
      }
      handleOperatorMessage(ws, msg);
    });

    ws.on('close', () => {
      operators.delete(ws);
      for (const [id, agent] of agents) {
        if (agent.operatorSocket === ws) {
          protocol.sendPacket(agent.socket, protocol.PKT.SESSION_CLOSE, Buffer.alloc(0), {
            sessionId: agent.sessionId || 0,
            sequence: agent.sequence++,
          });
          agent.state = 'available';
          agent.sessionId = null;
          agent.operatorSocket = null;
        }
      }
      broadcastAgentList();
      console.log('[OPERATOR] disconnected');
    });

    ws.on('error', (err) => {
      console.log(`[OPERATOR] ws error: ${err.message}`);
    });
  });

  server.listen(httpPort, '0.0.0.0', () => {
    console.log(`[WEB] http://0.0.0.0:${httpPort}`);
  });

  return server;
}

function startHeartbeatCheck() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, agent] of agents) {
      if (now - agent.lastHeartbeat > config.HEARTBEAT_TIMEOUT_MS) {
        console.log(`[HB] timeout ${id}`);
        closeAgentSocket(id, 'timeout');
      }
    }
  }, config.HEARTBEAT_CHECK_INTERVAL_MS);
}

function start() {
  startAgentListener(config.AGENT_PORT);
  startWebServer(config.HTTP_PORT);
  startHeartbeatCheck();
}

module.exports = { start };
