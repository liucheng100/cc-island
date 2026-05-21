import React, { useState, useEffect } from 'react';

function keyToString(e) {
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Win');
  const key = e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);
  return parts.join('+');
}

export default function SettingsPanel({ settings, onSave, onBack }) {
  const [recording, setRecording] = useState(false);
  const [accessPin, setAccessPin] = useState('');
  const [deviceMode, setDeviceMode] = useState(1);
  const [approvedDevices, setApprovedDevices] = useState([]);
  const [pendingDevices, setPendingDevices] = useState([]);
  const [serverUrl, setServerUrl] = useState('');
  const [firstDeviceName, setFirstDeviceName] = useState('');

  const toggleShortcut = settings.toggleShortcut || '';

  // Load auth state + listen for real-time changes
  useEffect(() => {
    if (!window.ccIsland) return;
    const refresh = async (savedSettings) => {
      const [pin, mode, devices, pending, info, freshSettings] = await Promise.all([
        window.ccIsland.getAccessPin(),
        window.ccIsland.getDeviceMode(),
        window.ccIsland.getApprovedDevices(),
        window.ccIsland.getPendingDevices(),
        window.ccIsland.getServerInfo(),
        savedSettings ? Promise.resolve(savedSettings) : window.ccIsland.getSettings(),
      ]);
      setAccessPin(pin);
      setDeviceMode(mode);
      setApprovedDevices(devices || []);
      setPendingDevices(pending || []);
      setFirstDeviceName((freshSettings && freshSettings.firstDeviceName) || '');
      const base = (info && info.publicURL) || `http://${(info && info.localIP) || '127.0.0.1'}:${(info && info.port) || 0}`;
      setServerUrl(`${base}/session/_?pin=${pin}`);
    };
    refresh();
    const unsub1 = window.ccIsland.onAuthStateChanged(() => refresh());
    const unsub2 = window.ccIsland.onSettingsChanged((s) => refresh(s));
    return () => { if (unsub1) unsub1(); if (unsub2) unsub2(); };
  }, []);

  const handleSetMode = async (mode) => {
    if (!window.ccIsland) return;
    await window.ccIsland.setDeviceMode(mode);
    setDeviceMode(mode);
  };

  const handleRegeneratePin = async () => {
    if (!window.ccIsland) return;
    const newPin = await window.ccIsland.regeneratePin();
    setAccessPin(newPin);
    const info = await window.ccIsland.getServerInfo();
    const base = (info && info.publicURL) || `http://${(info && info.localIP) || '127.0.0.1'}:${(info && info.port) || 0}`;
    setServerUrl(`${base}/session/_?pin=${newPin}`);
  };

  const handleResetFirstDevice = async () => {
    if (!window.ccIsland) return;
    await window.ccIsland.resetFirstDevice();
    setFirstDeviceName('');
  };

  const handleRevokeDevice = async (deviceId) => {
    if (!window.ccIsland) return;
    await window.ccIsland.rejectDevice(deviceId);
    setApprovedDevices(prev => prev.filter(d => d.deviceId !== deviceId));
  };

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

  // Document-level keydown listener when recording — captures even Ctrl+Space
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = keyToString(e);
      if (!combo) return;
      setRecording(false);
      const newSettings = { ...settings, toggleShortcut: combo };
      onSave(newSettings);
      if (window.ccIsland) window.ccIsland.updateGlobalShortcut(combo);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [recording, settings, onSave]);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack} title="返回">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h2 className="settings-title">设置</h2>
      </div>

      <div className="settings-body">
        <div className="setting-group">
          <label className="setting-label">主题模式</label>
          <div className="theme-options">
            <button
              className={`theme-btn ${settings.theme === 'dark' ? 'active' : ''}`}
              onClick={() => onSave({ ...settings, theme: 'dark' })}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
              <span>深色</span>
            </button>
            <button
              className={`theme-btn ${settings.theme === 'light' ? 'active' : ''}`}
              onClick={() => onSave({ ...settings, theme: 'light' })}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              <span>浅色</span>
            </button>
          </div>
        </div>

        <div className="setting-group">
          <label className="setting-label">快捷键提示</label>
          <label className="toggle-row">
            <span className="toggle-label">鼠标悬停时显示快捷键提示</span>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.showTips !== false}
              onChange={(e) => onSave({ ...settings, showTips: e.target.checked })}
            />
            <span className="toggle-switch" />
          </label>
        </div>

        <div className="setting-group">
          <label className="setting-label">提示音</label>
          <label className="toggle-row">
            <span className="toggle-label">新任务提示音</span>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.soundNewTask !== false}
              onChange={(e) => onSave({ ...settings, soundNewTask: e.target.checked })}
            />
            <span className="toggle-switch" />
          </label>
          <label className="toggle-row">
            <span className="toggle-label">完成任务提示音</span>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.soundCompletion !== false}
              onChange={(e) => onSave({ ...settings, soundCompletion: e.target.checked })}
            />
            <span className="toggle-switch" />
          </label>
        </div>

        <div className="setting-group">
          <label className="setting-label">公网连接模式</label>
          <p className="setting-desc">局域网始终可用，以下为附加的公网接入方式</p>
          <div className="theme-options" style={{ flexWrap: 'wrap' }}>
            {[
              { v: '', label: '仅局域网', icon: '🏠', desc: '不外连', disabled: false },
              { v: 'local', label: '本地隧道', icon: '🔀', desc: '自建反代', disabled: false },
              { v: 'ssh', label: 'SSH 隧道', icon: '🔗', desc: '即将开放', disabled: true },
              { v: 'server', label: '服务器', icon: '🖥', desc: '即将开放', disabled: true },
            ].map(opt => (
              <button
                key={opt.v}
                className={`theme-btn ${(settings.connectMode || '') === opt.v ? 'active' : ''}`}
                onClick={() => !opt.disabled && onSave({ ...settings, connectMode: opt.v })}
                style={{ flex: '1 1 60px', padding: '7px 4px', minWidth: 55, opacity: opt.disabled ? 0.35 : 1, cursor: opt.disabled ? 'not-allowed' : 'pointer' }}
              >
                <span style={{ fontSize: 16 }}>{opt.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 600 }}>{opt.label}</span>
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{opt.desc}</span>
              </button>
            ))}
          </div>

          {(settings.connectMode || '') === 'local' && (
            <>
              <input
                type="text"
                className="text-input"
                placeholder="监听地址，如 127.0.0.1:8081"
                value={settings.customServer || ''}
                onChange={(e) => onSave({ ...settings, customServer: e.target.value })}
              />
              <input
                type="text"
                className="text-input"
                placeholder="公网访问地址，如 https://myserver.com"
                value={settings.publicBase || ''}
                onChange={(e) => onSave({ ...settings, publicBase: e.target.value })}
                style={{ marginTop: 6 }}
              />
              {settings.customServer && settings.publicBase && (
                <p className="setting-desc" style={{ color: 'var(--success)' }}>
                  公网地址：{settings.publicBase.replace(/\/+$/, '')}/session/xxx
                </p>
              )}
            </>
          )}

          {(settings.connectMode || '') === 'server' && (
            <p className="setting-desc">服务器连接模式将在后续版本中开放</p>
          )}
        </div>

        <div className="setting-group">
          <label className="setting-label">安全认证</label>
          <div className="auth-row">
            <span className="auth-label">访问密码</span>
            <span className="auth-value">{accessPin || '---'}</span>
            <button className="preset-btn" onClick={handleRegeneratePin}>刷新</button>
          </div>

          <div className="auth-row auth-row-sub">
            <span className="auth-label">访问链接</span>
            <span className="auth-value-sub">{serverUrl || '(获取中...)'}</span>
            <button className="preset-btn" onClick={async () => {
              try { await navigator.clipboard.writeText(serverUrl); } catch(e) {}
            }}>复制</button>
          </div>

          <div className="theme-options" style={{ flexWrap: 'wrap', marginTop: 2 }}>
            <button className={`theme-btn ${deviceMode === 1 ? 'active' : ''}`} onClick={() => handleSetMode(1)} style={{ flex: 1, minWidth: 70, padding: '8px 6px' }}>
              <span style={{ fontSize: 18 }}>🔒</span>
              <span style={{ fontSize: 10 }}>首设备锁定</span>
            </button>
            <button className={`theme-btn ${deviceMode === 2 ? 'active' : ''}`} onClick={() => handleSetMode(2)} style={{ flex: 1, minWidth: 70, padding: '8px 6px' }}>
              <span style={{ fontSize: 18 }}>🛡</span>
              <span style={{ fontSize: 10 }}>手动审批</span>
            </button>
            <button className={`theme-btn ${deviceMode === 3 ? 'active' : ''}`} onClick={() => handleSetMode(3)} style={{ flex: 1, minWidth: 70, padding: '8px 6px' }}>
              <span style={{ fontSize: 18 }}>🌐</span>
              <span style={{ fontSize: 10 }}>完全放行</span>
            </button>
          </div>

          {deviceMode === 1 && (
            <div className="auth-row auth-row-sub">
              <span className="auth-label">首设备</span>
              <span className="auth-value-sub">{firstDeviceName || '(未绑定)'}</span>
              <button className="preset-btn preset-clear" onClick={handleResetFirstDevice}>重置</button>
            </div>
          )}

          {deviceMode === 2 && (
            <>
              {pendingDevices.length > 0 && (
                <div className="approved-list">
                  <p className="setting-desc" style={{ marginBottom: 4 }}>待审批设备：</p>
                  {pendingDevices.map(d => (
                    <div key={d.deviceId} className="pending-row">
                      <span className="pending-name" title={d.deviceId}>{d.name || d.deviceId}</span>
                      <button className="btn-approve" onClick={() => handleApproveDevice(d.deviceId)}>通过</button>
                      <button className="btn-reject" onClick={() => handleRejectDevice(d.deviceId)}>拒绝</button>
                    </div>
                  ))}
                </div>
              )}
              {approvedDevices.length > 0 && (
                <div className="approved-list">
                  <p className="setting-desc" style={{ marginBottom: 4 }}>已批准设备：</p>
                  {approvedDevices.map(d => (
                    <div key={d.deviceId} className="pending-row">
                      <span className="pending-name" title={d.deviceId}>{d.name || d.displayId || d.deviceId}</span>
                      <button className="btn-reject" onClick={() => handleRevokeDevice(d.deviceId)}>撤销</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="setting-group">
          <label className="setting-label">全局快捷键</label>
          <div className="shortcut-row">
            <span className="shortcut-label">展开/收起灵动岛</span>
            <div className={`shortcut-input ${recording ? 'recording' : ''}`} onClick={() => setRecording(true)}>
              <span className="shortcut-value">{recording ? '请按下快捷键...' : (toggleShortcut || '未设置')}</span>
            </div>
            <button className="preset-btn" onClick={() => { onSave({ ...settings, toggleShortcut: 'Ctrl+Space' }); if (window.ccIsland) window.ccIsland.updateGlobalShortcut('Ctrl+Space'); }}>Ctrl+Space</button>
            <button className="preset-btn preset-clear" onClick={() => { onSave({ ...settings, toggleShortcut: '' }); if (window.ccIsland) window.ccIsland.updateGlobalShortcut(''); }}>清空</button>
          </div>
        </div>
      </div>

      <style>{`
        .settings-panel {
          width: 100%; height: 100%; display: flex; flex-direction: column;
          border-radius: 0 0 var(--radius-lg) var(--radius-lg);
          overflow: hidden;
          background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.1) 100%);
        }
        .settings-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; flex-shrink: 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .btn-back {
          background: none; border: none; color: var(--text-secondary);
          cursor: pointer; padding: 4px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .btn-back:hover { color: var(--text-primary); background: var(--bg-glass); }
        .settings-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .settings-body { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 20px; }
        .setting-group { display: flex; flex-direction: column; gap: 10px; }
        .setting-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
        .theme-options { display: flex; gap: 8px; }
        .theme-btn {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 14px 20px; border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          background: var(--bg-glass); color: var(--text-secondary); font-size: 11px;
          cursor: pointer; transition: all 0.2s; min-width: 80px;
        }
        .theme-btn:hover { border-color: rgba(255,255,255,0.2); color: var(--text-primary); }
        .theme-btn.active {
          border-color: var(--border-active); background: rgba(99,102,241,0.1); color: var(--accent);
        }

        .toggle-row {
          display: flex; align-items: center; gap: 10px; cursor: pointer; position: relative;
        }
        .toggle-label { font-size: 11px; color: var(--text-primary); }
        .toggle-input { position: absolute; opacity: 0; pointer-events: none; }
        .toggle-switch {
          width: 36px; height: 20px; border-radius: 10px;
          background: rgba(255,255,255,0.1); border: 1px solid var(--border-subtle);
          transition: all 0.2s; flex-shrink: 0; margin-left: auto;
        }
        .toggle-switch::after {
          content: ''; display: block; width: 16px; height: 16px; border-radius: 50%;
          background: var(--text-muted); margin: 1px; transition: all 0.2s;
        }
        .toggle-input:checked + .toggle-switch {
          background: rgba(99,102,241,0.3); border-color: var(--border-active);
        }
        .toggle-input:checked + .toggle-switch::after {
          background: var(--accent); transform: translateX(16px);
        }

        .shortcut-row { display: flex; align-items: center; gap: 8px; }
        .shortcut-label { font-size: 11px; color: var(--text-primary); width: 110px; flex-shrink: 0; }
        .shortcut-input {
          flex: 1; padding: 5px 10px; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--border-subtle); background: var(--bg-glass);
          transition: all 0.15s; position: relative; min-height: 26px;
          display: flex; align-items: center;
        }
        .shortcut-input:hover { border-color: rgba(255,255,255,0.2); }
        .shortcut-input.recording { border-color: var(--accent); background: rgba(99,102,241,0.08); }
        .shortcut-value { font-size: 11px; color: var(--text-primary); font-family: 'Cascadia Code', monospace; }
        .shortcut-input.recording .shortcut-value { color: var(--accent); }

        .setting-desc { font-size: 10px; color: var(--text-muted); margin: -6px 0 0 0; }
        .text-input {
          display: block; width: 100%; padding: 6px 10px; border-radius: 6px;
          border: 1px solid var(--border-subtle); background: var(--bg-glass);
          color: var(--text-primary); font-size: 11px; outline: none;
        }
        .text-input:focus { border-color: var(--border-active); }
        .text-input::placeholder { color: var(--text-muted); }
        .preset-btn {
          padding: 4px 8px; border-radius: 5px; cursor: pointer;
          border: 1px solid var(--border-subtle); background: var(--bg-glass);
          color: var(--text-secondary); font-size: 10px;
          transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .preset-btn:hover { border-color: var(--border-active); color: var(--accent); background: rgba(99,102,241,0.08); }
        .preset-clear { color: var(--text-muted); }
        .preset-clear:hover { color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.06); }
        .approved-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
        .pending-row {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 8px; border-radius: 6px;
          background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle);
        }
        .pending-name { flex: 1; font-size: 10px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .btn-approve {
          background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3);
          color: var(--success); font-size: 10px; padding: 2px 8px; border-radius: 5px; cursor: pointer;
          flex-shrink: 0;
        }
        .btn-approve:hover { background: rgba(34,197,94,0.2); }
        .btn-reject {
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
          color: var(--danger); font-size: 10px; padding: 2px 8px; border-radius: 5px; cursor: pointer;
          flex-shrink: 0;
        }
        .auth-row {
          display: flex; align-items: center; gap: 8px;
          padding: 5px 8px; border-radius: 6px;
          background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle);
        }
        .auth-label { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
        .auth-value { font-size: 14px; font-weight: 600; letter-spacing: 3px; font-family: monospace; color: var(--success); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; user-select: text; }
        .auth-row-sub { border: none; background: transparent; padding: 3px 8px; }
        .auth-value-sub { font-size: 10px; font-weight: 400; letter-spacing: 0; font-family: monospace; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; user-select: text; }
      `}</style>
    </div>
  );
}
