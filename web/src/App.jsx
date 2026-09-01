import React, { useState, useEffect, useCallback } from 'react';
import AgentList from './components/AgentList.jsx';
import SessionView from './components/SessionView.jsx';
import './index.css';

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState([]);
  const [session, setSession] = useState(null);
  const [videoConfig, setVideoConfig] = useState(null);
  const [videoFrame, setVideoFrame] = useState(null);
  const [statusText, setStatusText] = useState('Conectando...');

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      setStatusText('Conectado');
      ws.send(JSON.stringify({ type: 'requestAgents' }));
    };

    ws.onclose = () => {
      setConnected(false);
      setStatusText('Desconectado');
      setSession(null);
    };

    ws.onerror = () => {
      setStatusText('Error de conexión');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };

    setSocket(ws);
    return () => ws.close();
  }, []);

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'agents':
        setAgents(msg.payload);
        break;
      case 'sessionAccepted':
        setSession({
          sessionId: msg.payload.sessionId,
          agentId: msg.payload.agentId,
          width: msg.payload.videoWidth,
          height: msg.payload.videoHeight,
          fps: msg.payload.fps,
        });
        setStatusText('Sesión activa');
        break;
      case 'sessionRejected':
        setStatusText(`Sesión rechazada: ${msg.payload.reason}`);
        setSession(null);
        break;
      case 'sessionClosed':
        setSession(null);
        setVideoFrame(null);
        setVideoConfig(null);
        setStatusText('Sesión cerrada');
        break;
      case 'videoConfig':
        setVideoConfig(msg.payload);
        break;
      case 'videoFrame':
        setVideoFrame(msg.payload);
        break;
      case 'error':
        setStatusText(`Error: ${msg.payload}`);
        break;
      default:
        break;
    }
  }, []);

  const openSession = (agentId) => {
    socket?.send(JSON.stringify({ type: 'sessionOpen', payload: { agentId } }));
    setStatusText('Solicitando sesión...');
  };

  const closeSession = () => {
    if (!session) return;
    socket?.send(JSON.stringify({ type: 'sessionClose', payload: { agentId: session.agentId } }));
  };

  const sendInput = (type, payload) => {
    if (!session || !socket) return;
    socket.send(JSON.stringify({
      type,
      payload: { ...payload, agentId: session.agentId, sessionId: session.sessionId },
    }));
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Perrubi Operator</h1>
        <div className={`status ${connected ? 'ok' : 'bad'}`}>{statusText}</div>
      </header>
      <main className="app-main">
        <aside className="app-sidebar">
          <AgentList agents={agents} onConnect={openSession} />
        </aside>
        <section className="app-content">
          {session ? (
            <SessionView
              session={session}
              videoConfig={videoConfig}
              videoFrame={videoFrame}
              onClose={closeSession}
              onInput={sendInput}
            />
          ) : (
            <div className="placeholder">Selecciona un agente para conectar.</div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
