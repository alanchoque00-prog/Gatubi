'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'agents.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_connected INTEGER,
    last_disconnected INTEGER,
    last_session_at INTEGER,
    last_ip TEXT,
    last_hostname TEXT,
    last_display_name TEXT,
    last_version TEXT,
    connection_count INTEGER NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0
  );
`);

const upsertAgent = db.prepare(`
  INSERT INTO agents (
    agent_id, first_seen, last_connected, last_ip,
    last_hostname, last_display_name, last_version, connection_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(agent_id) DO UPDATE SET
    last_connected = excluded.last_connected,
    last_ip = excluded.last_ip,
    last_hostname = excluded.last_hostname,
    last_display_name = excluded.last_display_name,
    last_version = excluded.last_version,
    connection_count = agents.connection_count + 1
`);

const updateDisconnect = db.prepare('UPDATE agents SET last_disconnected = ? WHERE agent_id = ?');
const updateSession = db.prepare('UPDATE agents SET last_session_at = ?, session_count = session_count + 1 WHERE agent_id = ?');
const selectAll = db.prepare('SELECT * FROM agents');

module.exports = {
  touch(info, ip) {
    const now = Date.now();
    upsertAgent.run(
      info.agentId,
      now,
      now,
      ip,
      info.hostname,
      info.displayName,
      info.version
    );
  },

  disconnect(agentId) {
    updateDisconnect.run(Date.now(), agentId);
  },

  recordSession(agentId) {
    updateSession.run(Date.now(), agentId);
  },

  getAll() {
    return selectAll.all();
  },
};
