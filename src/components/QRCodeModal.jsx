import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';

export default function QRCodeModal({ session, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [startingTunnel, setStartingTunnel] = useState(false);

  const generateQR = useCallback(async () => {
    if (!window.ccIsland) return;
    try {
      const url = await window.ccIsland.getQRCodeUrl(session.id);
      if (url) {
        setSessionUrl(url);
        const dataUrl = await QRCode.toDataURL(url, {
          width: 220,
          margin: 2,
          color: { dark: '#f0f0f5', light: '#121218' },
        });
        setQrDataUrl(dataUrl);
      }
    } catch (e) {
      const fallbackUrl = `cc-island://session/${session.id}`;
      setSessionUrl(fallbackUrl);
      const dataUrl = await QRCode.toDataURL(fallbackUrl, {
        width: 220, margin: 2,
        color: { dark: '#f0f0f5', light: '#121218' },
      });
      setQrDataUrl(dataUrl);
    }
  }, [session.id]);

  const checkTunnel = useCallback(async () => {
    if (!window.ccIsland) return;
    try {
      const status = await window.ccIsland.getTunnelStatus();
      setTunnelStatus(status);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    generateQR();
    checkTunnel();
  }, [generateQR, checkTunnel]);

  const handleStartTunnel = async () => {
    if (!window.ccIsland || startingTunnel) return;
    setStartingTunnel(true);
    try {
      const status = await window.ccIsland.startTunnel();
      setTunnelStatus(status);
      // Regenerate QR with new public URL
      if (status.active) {
        const url = await window.ccIsland.getQRCodeUrl(session.id);
        setSessionUrl(url);
        const dataUrl = await QRCode.toDataURL(url, {
          width: 220, margin: 2,
          color: { dark: '#f0f0f5', light: '#121218' },
        });
        setQrDataUrl(dataUrl);
      }
    } catch (e) { /* ignore */ }
    setStartingTunnel(false);
  };

  const handleStopTunnel = async () => {
    if (!window.ccIsland) return;
    try {
      await window.ccIsland.stopTunnel();
      setTunnelStatus({ active: false });
      // Regenerate QR with local URL
      const url = await window.ccIsland.getQRCodeUrl(session.id);
      setSessionUrl(url);
      const dataUrl = await QRCode.toDataURL(url, {
        width: 220, margin: 2,
        color: { dark: '#f0f0f5', light: '#121218' },
      });
      setQrDataUrl(dataUrl);
    } catch (e) { /* ignore */ }
  };

  const handleCopyUrl = async () => {
    if (sessionUrl) {
      try {
        await navigator.clipboard.writeText(sessionUrl);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = sessionUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isPublic = tunnelStatus && tunnelStatus.active;

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-header">
          <h3>扫码连接 Claude</h3>
          <button className="btn-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="qr-session-info">
          <span className="qr-session-name">{session.name}</span>
          <span className="qr-session-cwd">{session.cwd}</span>
        </div>

        {/* Tunnel status */}
        <div className={`tunnel-badge ${isPublic ? 'active' : ''}`}>
          <span className="tunnel-dot" />
          <span>{isPublic ? `公网已连接 · ${tunnelStatus.service}` : '局域网模式'}</span>
          {!isPublic && (
            <button className="btn-tunnel" onClick={handleStartTunnel} disabled={startingTunnel}>
              {startingTunnel ? '开启中...' : '开启公网'}
            </button>
          )}
          {isPublic && (
            <button className="btn-tunnel stop" onClick={handleStopTunnel}>关闭公网</button>
          )}
        </div>

        <div className="qr-container">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className="qr-image" />
          ) : (
            <div className="qr-loading">
              <div className="qr-spinner" />
              <span>生成中...</span>
            </div>
          )}
        </div>

        <div className="qr-instructions">
          <div className="instruction-step">
            <span className="step-number">1</span>
            <span>{isPublic ? '任意网络均可访问' : '确保手机和电脑在同一网络'}</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">2</span>
            <span>打开微信或浏览器扫一扫</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">3</span>
            <span>实时查看和接管 Claude 对话</span>
          </div>
        </div>

        <div className="qr-url-box">
          <input type="text" className="url-input" value={sessionUrl} readOnly onClick={(e) => e.target.select()} />
          <button className="btn-copy" onClick={handleCopyUrl}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>

        {isPublic && <p className="qr-tip success">公网隧道已开启，手机无需连同一 WiFi</p>}
        {!isPublic && <p className="qr-tip">建议开启公网隧道，手机无需连同一 WiFi</p>}
      </div>

      <style>{`
        .qr-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
          animation: fade-in 0.2s ease-out;
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

        .qr-modal {
          background: var(--bg-secondary);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle);
          padding: 24px; width: 320px;
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          animation: slide-in 0.3s ease-out;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        }
        .qr-header {
          display: flex; align-items: center; justify-content: space-between; width: 100%;
        }
        .qr-header h3 { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .btn-close {
          background: none; border: none; color: var(--text-muted); cursor: pointer;
          padding: 4px; border-radius: 6px; display: flex; transition: all 0.2s;
        }
        .btn-close:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
        .qr-session-info { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .qr-session-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .qr-session-cwd { font-size: 10px; color: var(--text-muted); }

        .tunnel-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 12px;
          background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle);
          font-size: 11px; color: var(--text-muted);
        }
        .tunnel-badge.active {
          border-color: rgba(34,197,94,0.4); color: var(--success);
        }
        .tunnel-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--text-muted);
        }
        .tunnel-badge.active .tunnel-dot {
          background: var(--success); box-shadow: 0 0 8px var(--success-glow);
        }
        .btn-tunnel {
          margin-left: 4px; padding: 3px 10px; border-radius: 10px; border: 1px solid var(--accent);
          background: rgba(99,102,241,0.1); color: var(--accent); font-size: 10px; cursor: pointer;
          transition: all 0.2s;
        }
        .btn-tunnel:hover { background: rgba(99,102,241,0.2); }
        .btn-tunnel.stop { border-color: var(--danger); color: var(--danger); background: rgba(239,68,68,0.1); }
        .btn-tunnel:disabled { opacity: 0.5; }

        .qr-container {
          position: relative; padding: 12px;
          background: #121218; border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }
        .qr-image { display: block; width: 220px; height: 220px; }
        .qr-loading {
          width: 220px; height: 220px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; color: var(--text-muted); font-size: 12px;
        }
        .qr-spinner {
          width: 28px; height: 28px;
          border: 2px solid var(--border-subtle);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        .qr-instructions { width: 100%; display: flex; flex-direction: column; gap: 8px; }
        .instruction-step {
          display: flex; align-items: center; gap: 10px;
          font-size: 12px; color: var(--text-secondary);
        }
        .step-number {
          width: 20px; height: 20px; border-radius: 50%;
          background: rgba(99,102,241,0.15); color: var(--accent);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 600; flex-shrink: 0;
        }
        .qr-url-box { width: 100%; display: flex; gap: 6px; }
        .url-input {
          flex: 1; background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
          padding: 7px 10px; font-size: 10px; color: var(--text-secondary); outline: none;
        }
        .btn-copy {
          background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm); padding: 7px 12px; font-size: 11px;
          color: var(--text-primary); cursor: pointer; white-space: nowrap; transition: all 0.2s;
        }
        .btn-copy:hover { background: rgba(255,255,255,0.1); }
        .qr-tip { font-size: 10px; color: var(--text-muted); }
        .qr-tip.success { color: var(--success); }
      `}</style>
    </div>
  );
}
