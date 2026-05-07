import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';

export default function QRCodeModal({ session, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  const generateQR = useCallback(async () => {
    if (!window.ccIsland) return;

    try {
      const url = await window.ccIsland.getQRCodeUrl(session.id);
      if (url) {
        setSessionUrl(url);
        const dataUrl = await QRCode.toDataURL(url, {
          width: 220,
          margin: 2,
          color: {
            dark: '#f0f0f5',
            light: '#121218',
          },
        });
        setQrDataUrl(dataUrl);
      }
    } catch (e) {
      // Fallback: generate QR with session ID
      const fallbackUrl = `cc-island://session/${session.id}`;
      setSessionUrl(fallbackUrl);
      const dataUrl = await QRCode.toDataURL(fallbackUrl, {
        width: 220,
        margin: 2,
        color: { dark: '#f0f0f5', light: '#121218' },
      });
      setQrDataUrl(dataUrl);
    }
  }, [session.id]);

  useEffect(() => {
    generateQR();
  }, [generateQR]);

  const handleCopyUrl = async () => {
    if (sessionUrl) {
      try {
        await navigator.clipboard.writeText(sessionUrl);
      } catch {
        // Fallback
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

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="qr-header">
          <h3>微信扫码连接</h3>
          <button className="btn-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Session info */}
        <div className="qr-session-info">
          <span className="qr-session-name">{session.name}</span>
          <span className="qr-session-cwd">{session.cwd}</span>
        </div>

        {/* QR Code */}
        <div className="qr-container">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className="qr-image" />
          ) : (
            <div className="qr-loading">
              <div className="qr-spinner" />
              <span>生成中...</span>
            </div>
          )}
          <div className="qr-border-decoration" />
        </div>

        {/* Instructions */}
        <div className="qr-instructions">
          <div className="instruction-step">
            <span className="step-number">1</span>
            <span>打开微信扫一扫</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">2</span>
            <span>扫描二维码</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">3</span>
            <span>在手机上实时查看和接管 Claude 对话</span>
          </div>
        </div>

        {/* URL copy */}
        <div className="qr-url-box">
          <input
            type="text"
            className="url-input"
            value={sessionUrl}
            readOnly
            onClick={(e) => e.target.select()}
          />
          <button className="btn-copy" onClick={handleCopyUrl}>
            {copied ? '已复制 ✓' : '复制链接'}
          </button>
        </div>

        <p className="qr-tip">手机需与电脑在同一局域网</p>
      </div>

      <style>{`
        .qr-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fade-in 0.2s ease-out;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .qr-modal {
          background: var(--bg-secondary);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle);
          padding: 24px;
          width: 320px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          animation: slide-in 0.3s ease-out;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        }

        .qr-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
        }

        .qr-header h3 {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .btn-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          transition: all 0.2s;
        }

        .btn-close:hover {
          color: var(--text-primary);
          background: rgba(255,255,255,0.05);
        }

        .qr-session-info {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .qr-session-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .qr-session-cwd {
          font-size: 10px;
          color: var(--text-muted);
        }

        .qr-container {
          position: relative;
          padding: 12px;
          background: #121218;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }

        .qr-image {
          display: block;
          width: 220px;
          height: 220px;
        }

        .qr-loading {
          width: 220px;
          height: 220px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-muted);
          font-size: 12px;
        }

        .qr-spinner {
          width: 28px;
          height: 28px;
          border: 2px solid var(--border-subtle);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .qr-instructions {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .instruction-step {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .step-number {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(99,102,241,0.15);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .qr-url-box {
          width: 100%;
          display: flex;
          gap: 6px;
        }

        .url-input {
          flex: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 7px 10px;
          font-size: 10px;
          color: var(--text-secondary);
          outline: none;
        }

        .btn-copy {
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 7px 12px;
          font-size: 11px;
          color: var(--text-primary);
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }

        .btn-copy:hover {
          background: rgba(255,255,255,0.1);
        }

        .qr-tip {
          font-size: 10px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
