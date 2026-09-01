import React from 'react';

function formatDate(ts) {
  if (!ts) return 'Nunca';
  return new Date(ts).toLocaleString('es-ES');
}

function statusLabel(status) {
  switch (status) {
    case 'available':
      return 'Disponible';
    case 'reserved':
      return 'Reservado';
    case 'streaming':
      return 'En uso';
    case 'offline':
      return 'Desconectado';
    default:
      return status;
  }
}

export default function AgentList({ agents, onConnect }) {
  return (
    <div className="agent-list">
      <h2>Agentes</h2>
      {agents.length === 0 && <p>No hay agentes registrados.</p>}
      <ul className="agent-items">
        {agents.map((a) => (
          <li key={a.agentId} className="agent-card">
            <div className="agent-header">
              <span className="agent-name">{a.displayName || a.hostname}</span>
              <span className={`agent-status agent-status-${a.status}`}>{statusLabel(a.status)}</span>
            </div>
            <div className="agent-meta">
              <div><strong>Hostname:</strong> {a.hostname}</div>
              <div><strong>ID:</strong> {a.agentId}</div>
              <div><strong>Versión:</strong> {a.version}</div>
              <div><strong>IP:</strong> {a.ip || '-'}</div>
              <div><strong>Resolución:</strong> {a.resolution || '-'}</div>
              <div><strong>Última vez:</strong> {formatDate(a.lastSeen)}</div>
              <div><strong>Última sesión:</strong> {formatDate(a.lastSession)}</div>
            </div>
            {a.status === 'available' && (
              <button className="agent-connect" onClick={() => onConnect(a.agentId)}>
                Conectar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
