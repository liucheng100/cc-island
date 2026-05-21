import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';

export default function QRCodeModal({ session, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [connectMode, setConnectMode] = useState('');
  const [accessPin, setAccessPin] = useState('');
  const [pinCopied, setPinCopied] = useState(false);
  const [pendingDevices, setPendingDevices] = useState([]);

  const generateQR = useCallback(async () => {
    if (!window.ccIsland) return;
    try {
      let url = await window.ccIsland.getQRCodeUrl(session.id);
      const pin = await window.ccIsland.getAccessPin();
      if (pin) {
        setAccessPin(pin);
        url = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'pin=' + pin;
      }
      if (url) {
        setSessionUrl(url);
        const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 2, color: { dark: '#f0f0f5', light: '#121218' } });
        setQrDataUrl(dataUrl);
      }
    } catch (e) {
      const fallbackUrl = `cc-island://session/${session.id}`;
      setSessionUrl(fallbackUrl);
      const dataUrl = await QRCode.toDataURL(fallbackUrl, { width: 220, margin: 2, color: { dark: '#f0f0f5', light: '#121218' } });
      setQrDataUrl(dataUrl);
    }
  }, [session.id]);

  const loadState = useCallback(async () => {
    if (!window.ccIsland) return;
    try {
      const settings = await window.ccIsland.getSettings();
      setConnectMode(settings.connectMode || '');
      const pin = await window.ccIsland.getAccessPin();
      setAccessPin(pin);
      const pending = await window.ccIsland.getPendingDevices();
      setPendingDevices(pending || []);
    } catch (e) {}
  }, []);

  useEffect(() => { generateQR(); loadState(); }, [generateQR, loadState]);

  // Listen for settings changes from other components
  useEffect(() => {
    if (!window.ccIsland) return;
    const unsub = window.ccIsland.onSettingsChanged((s) => {
      setConnectMode(s.connectMode || '');
      generateQR();
    });
    return () => { if (unsub) unsub(); };
  }, [generateQR]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (!window.ccIsland) return;
      try { const p = await window.ccIsland.getPendingDevices(); setPendingDevices(p || []); } catch (e) {}
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const handleApproveDevice = async (deviceId) => {
    if (!window.ccIsland) return;
    await window.ccIsland.approveDevice(deviceId);
    setPendingDevices(prev => prev.filter(d => d.deviceId !== deviceId));
  };

  const handleRejectDevice = async (deviceId) => {
    if (!window.ccIsland) return;
    await window.ccIsland.rejectDevice(deviceId);
    setPendingDevices(prev => prev.filter(d => d.deviceId !== deviceId));
  };

  const handleCopyUrl = async () => {
    if (!sessionUrl) return;
    try { await navigator.clipboard.writeText(sessionUrl); } catch {
      const ta = document.createElement('textarea'); ta.value = sessionUrl;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const modeLabel = connectMode === 'ssh' ? 'SSH 隧道' : connectMode === 'local' ? '本地隧道' : connectMode === 'server' ? '服务器' : '局域网';
  const hasPublic = connectMode !== '';

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-header">
          <h3>扫码连接 Claude</h3>
          <button className="btn-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className={`tunnel-badge ${hasPublic ? 'active' : ''}`}>
          <span className="tunnel-dot" />
          <span>{modeLabel + '模式'}</span>
        </div>

        {/* Connection mode selector */}
        <div className="mode-selector">
          <span className="mode-label">切换连接模式</span>
          <div className="mode-btns">
            {[
              { v: '', label: '局域网', icon: '🏠', disabled: false },
              { v: 'local', label: '本地隧道', icon: '🔀', disabled: false },
              { v: 'ssh', label: 'SSH', icon: '🔗', disabled: true },
              { v: 'server', label: '服务器', icon: '🖥', disabled: true },
            ].map(opt => (
              <button
                key={opt.v}
                className={`mode-btn ${connectMode === opt.v ? 'sel' : ''}`}
                disabled={opt.disabled}
                onClick={async () => {
                  if (opt.disabled || !window.ccIsland) return;
                  const s = await window.ccIsland.getSettings();
                  await window.ccIsland.saveSettings({ ...s, connectMode: opt.v });
                  setConnectMode(opt.v);
                  setTimeout(() => generateQR(), 1500);
                }}
                title={opt.disabled ? opt.label + '（即将开放）' : opt.label}
                style={opt.disabled ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
              >{opt.icon}</button>
            ))}
          </div>
        </div>

        {accessPin && (
          <div className="pin-display">
            <span className="pin-label">访问密码</span>
            <span className="pin-value">{accessPin}</span>
            <button className="btn-copy-pin" onClick={async () => {
              try { await navigator.clipboard.writeText(accessPin); } catch(e) {}
              setPinCopied(true); setTimeout(() => setPinCopied(false), 2000);
            }}>{pinCopied ? '已复制' : '复制'}</button>
          </div>
        )}

        {pendingDevices.length > 0 && (
          <div className="pending-devices">
            <span className="pending-label">待审批设备</span>
            {pendingDevices.map(d => (
              <div key={d.deviceId} className="pending-row">
                <span className="pending-name" title={d.deviceId}>{d.name || d.deviceId}</span>
                <button className="btn-approve" onClick={() => handleApproveDevice(d.deviceId)}>通过</button>
                <button className="btn-reject" onClick={() => handleRejectDevice(d.deviceId)}>拒绝</button>
              </div>
            ))}
          </div>
        )}

        <div className="qr-container">
          {qrDataUrl ? <img src={qrDataUrl} alt="QR Code" className="qr-image" /> : (
            <div className="qr-loading"><div className="qr-spinner" /><span>生成中...</span></div>
          )}
        </div>

        <div className="qr-instructions">
          <div className="instruction-step"><span className="step-number">1</span><span>{hasPublic ? '任意网络均可访问' : '确保手机和电脑在同一网络'}</span></div>
          <div className="instruction-step"><span className="step-number">2</span><span>打开微信或浏览器扫一扫</span></div>
          <div className="instruction-step"><span className="step-number">3</span><span>实时查看和接管 Claude 对话</span></div>
        </div>

        <div className="qr-url-box">
          <input type="text" className="url-input" value={sessionUrl} readOnly onClick={(e) => e.target.select()} />
          <button className="btn-copy" onClick={handleCopyUrl}>{copied ? '已复制 ✓' : '复制'}</button>
        </div>

        {hasPublic ? <p className="qr-tip success">已开启公网连接，手机无需连同一 WiFi</p> : <p className="qr-tip">在设置中选择公网连接模式，手机无需连同一 WiFi</p>}
      </div>

      <style>{`
        .qr-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fade-in 0.2s ease-out; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .qr-modal { background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px solid var(--border-subtle); padding: 24px; width: 320px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 14px; animation: slide-in 0.3s ease-out; box-shadow: 0 16px 48px rgba(0,0,0,0.5); }
        .qr-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
        .qr-header h3 { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .btn-close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; display: flex; transition: all 0.2s; }
        .btn-close:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
        .tunnel-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle); font-size: 11px; color: var(--text-muted); }
        .tunnel-badge.active { border-color: rgba(34,197,94,0.4); color: var(--success); }
        .tunnel-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }
        .tunnel-badge.active .tunnel-dot { background: var(--success); box-shadow: 0 0 8px var(--success-glow); }
        .pin-display { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); width: 100%; justify-content: center; }
        .pin-label { font-size: 10px; color: var(--text-muted); }
        .pin-value { font-size: 18px; font-weight: 700; letter-spacing: 6px; font-family: monospace; color: var(--success); user-select: text; }
        .btn-copy-pin { background: none; border: 1px solid var(--border-subtle); color: var(--text-secondary); font-size: 10px; padding: 3px 8px; border-radius: 5px; cursor: pointer; }
        .pending-devices { width: 100%; display: flex; flex-direction: column; gap: 6px; }
        .pending-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
        .pending-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); }
        .pending-name { flex: 1; font-size: 10px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .btn-approve { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3); color: var(--success); font-size: 10px; padding: 3px 8px; border-radius: 5px; cursor: pointer; }
        .btn-reject { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: var(--danger); font-size: 10px; padding: 3px 8px; border-radius: 5px; cursor: pointer; }
        .qr-container { position: relative; padding: 12px; background: #121218; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
        .qr-image { display: block; width: 220px; height: 220px; }
        .qr-loading { width: 220px; height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
        .qr-spinner { width: 28px; height: 28px; border: 2px solid var(--border-subtle); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
        .qr-instructions { width: 100%; display: flex; flex-direction: column; gap: 8px; }
        .instruction-step { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-secondary); }
        .step-number { width: 20px; height: 20px; border-radius: 50%; background: rgba(99,102,241,0.15); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }
        .qr-url-box { width: 100%; display: flex; gap: 6px; }
        .url-input { flex: 1; background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 7px 10px; font-size: 10px; color: var(--text-secondary); outline: none; }
        .btn-copy { background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 11px; color: var(--text-primary); cursor: pointer; white-space: nowrap; transition: all 0.2s; }
        .btn-copy:hover { background: rgba(255,255,255,0.1); }
        .qr-tip { font-size: 10px; color: var(--text-muted); }
        .qr-tip.success { color: var(--success); }
        .mode-selector { width: 100%; display: flex; flex-direction: column; gap: 4px; align-items: center; }
        .mode-label { font-size: 10px; color: var(--text-muted); }
        .mode-btns { display: flex; gap: 6px; }
        .mode-btn {
          background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle);
          border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 14px;
          transition: all 0.15s;
        }
        .mode-btn.sel { background: rgba(99,102,241,0.15); border-color: var(--accent); }
        .mode-btn:hover { background: rgba(255,255,255,0.08); }
      `}</style>
    </div>
  );
}
