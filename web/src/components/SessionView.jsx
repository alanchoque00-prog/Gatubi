import React, { useRef, useEffect, useState } from 'react';

function mapButton(browserButton) {
  if (browserButton === 0) return 0;
  if (browserButton === 2) return 1;
  if (browserButton === 1) return 2;
  return browserButton;
}

export default function SessionView({ session, videoConfig, videoFrame, onClose, onInput }) {
  const canvasRef = useRef(null);
  const [imageDimensions, setImageDimensions] = useState({
    width: session.width || 1280,
    height: session.height || 720,
  });

  useEffect(() => {
    canvasRef.current?.focus();
  }, []);

  useEffect(() => {
    if (videoConfig) {
      setImageDimensions({ width: videoConfig.width, height: videoConfig.height });
    }
  }, [videoConfig]);

  useEffect(() => {
    if (!videoFrame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, rect.width, rect.height);

      const aspect = img.width / img.height;
      const containerW = rect.width;
      const containerH = rect.height;
      let dw, dh, dx, dy;

      if (aspect > containerW / containerH) {
        dw = containerW;
        dh = dw / aspect;
        dx = 0;
        dy = (containerH - dh) / 2;
      } else {
        dh = containerH;
        dw = dh * aspect;
        dy = 0;
        dx = (containerW - dw) / 2;
      }

      ctx.drawImage(img, dx, dy, dw, dh);
      setImageDimensions({ width: img.width, height: img.height });
    };

    img.src = `data:image/jpeg;base64,${videoFrame.data}`;
  }, [videoFrame]);

  function computeNormalized(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const aspect = imageDimensions.width / imageDimensions.height;
    const containerW = rect.width;
    const containerH = rect.height;
    let dw, dh, dx, dy;

    if (aspect > containerW / containerH) {
      dw = containerW;
      dh = dw / aspect;
      dx = 0;
      dy = (containerH - dh) / 2;
    } else {
      dh = containerH;
      dw = dh * aspect;
      dy = 0;
      dx = (containerW - dw) / 2;
    }

    const x = e.clientX - rect.left - dx;
    const y = e.clientY - rect.top - dy;
    return {
      x: Math.max(0, Math.min(1, x / dw)),
      y: Math.max(0, Math.min(1, y / dh)),
    };
  }

  function handleMouseMove(e) {
    const { x, y } = computeNormalized(e);
    onInput('mouseMove', { x, y });
  }

  function handleMouseButton(e, down) {
    e.preventDefault();
    const { x, y } = computeNormalized(e);
    onInput('mouseButton', { button: mapButton(e.button), down, x, y });
  }

  function handleWheel(e) {
    e.preventDefault();
    onInput('mouseWheel', { delta: Math.max(-32768, Math.min(32767, -e.deltaY)) });
  }

  function handleKey(e, down) {
    e.preventDefault();
    const vk = e.nativeEvent.keyCode;
    onInput('key', { vk, down });
  }

  return (
    <div className="session-view">
      <div className="session-toolbar">
        <div className="session-info">
          {session.width}x{session.height} @ {session.fps} FPS
        </div>
        <button className="session-close" onClick={onClose}>Cerrar sesión</button>
      </div>
      <div className="session-video">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onMouseMove={handleMouseMove}
          onMouseDown={(e) => handleMouseButton(e, true)}
          onMouseUp={(e) => handleMouseButton(e, false)}
          onWheel={handleWheel}
          onKeyDown={(e) => handleKey(e, true)}
          onKeyUp={(e) => handleKey(e, false)}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
