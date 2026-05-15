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

  const toggleShortcut = settings.toggleShortcut || '';

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

        .preset-btn {
          padding: 4px 8px; border-radius: 5px; cursor: pointer;
          border: 1px solid var(--border-subtle); background: var(--bg-glass);
          color: var(--text-secondary); font-size: 10px;
          transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .preset-btn:hover { border-color: var(--border-active); color: var(--accent); background: rgba(99,102,241,0.08); }
        .preset-clear { color: var(--text-muted); }
        .preset-clear:hover { color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.06); }
      `}</style>
    </div>
  );
}
