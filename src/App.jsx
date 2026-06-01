import React, { useState, useEffect, useCallback, useRef } from 'react';
import DynamicIsland from './components/DynamicIsland';
import QRCodeModal from './components/QRCodeModal';
import SettingsPanel from './components/SettingsPanel';
import { playCompletionSound, playErrorSound, playNewSessionSound } from './hooks/useNotification';
import './App.css';

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [wechatStatus, setWechatStatus] = useState({ connected: false });
  const [isExpanded, setIsExpanded] = useState(false);
  const [qrSession, setQrSession] = useState(null);
  const [currentView, setCurrentView] = useState('sessions');
  const [settings, setSettings] = useState({ theme: 'dark' });
  const prevStatusRef = useRef({});
  const seenIdsRef = useRef(new Set());
  const settingsRef = useRef(settings);
  const settingsLoadedRef = useRef(false);
  const isExpandedRef = useRef(false);

  // Keep settingsRef in sync
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Load settings on startup
  useEffect(() => {
    if (!window.ccIsland) return;
    window.ccIsland.getSettings().then((s) => {
      if (s && !settingsLoadedRef.current) {
        settingsLoadedRef.current = true;
        setSettings(s);
      }
    });
    const unsub = window.ccIsland.onSettingsLoaded((s) => {
      if (s && !settingsLoadedRef.current) {
        settingsLoadedRef.current = true;
        setSettings(s);
      }
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // Listen for open:settings from tray
  useEffect(() => {
    if (!window.ccIsland) return;
    const unsub = window.ccIsland.onOpenSettings(() => {
      if (!isExpanded && window.ccIsland) {
        window.ccIsland.toggleIsland();
      }
      setCurrentView('settings');
    });
    return () => { if (unsub) unsub(); };
  }, [isExpanded]);

  useEffect(() => {
    if (!window.ccIsland) return;

    const unsub1 = window.ccIsland.onSessionsUpdated((updatedSessions) => {
      const list = updatedSessions || [];
      const prev = prevStatusRef.current;

      for (const s of list) {
        if (!seenIdsRef.current.has(s.id) && settingsRef.current.soundNewTask !== false) { playNewSessionSound(); }
        seenIdsRef.current.add(s.id);
        if (prev[s.id] && (prev[s.id] === 'answering' || prev[s.id] === 'thinking') && s.status === 'completed') {
          if (settingsRef.current.soundCompletion !== false) playCompletionSound();
          if (window.ccIsland && !isExpandedRef.current) {
            window.ccIsland.toggleIsland();
          }
        }
        if (prev[s.id] && prev[s.id] !== 'error' && s.status === 'error') { playErrorSound(); }
      }

      const newPrev = {};
      for (const s of list) newPrev[s.id] = s.status;
      prevStatusRef.current = newPrev;
      setSessions(list);
    });

    const unsub2 = window.ccIsland.onWechatStatus((status) => setWechatStatus(status));
    const unsub3 = window.ccIsland.onIslandExpand(() => { setIsExpanded(true); isExpandedRef.current = true; });
    const unsub4 = window.ccIsland.onIslandCollapse(() => { setIsExpanded(false); isExpandedRef.current = false; setCurrentView('sessions'); });

    window.ccIsland.getSessions().then(setSessions);
    window.ccIsland.getWechatStatus().then(setWechatStatus);
    window.ccIsland.getIslandState().then((v) => { setIsExpanded(v); isExpandedRef.current = v; });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const handleIslandClick = useCallback(() => {
    if (window.ccIsland) window.ccIsland.toggleIsland();
  }, []);

  const handleShowQR = useCallback((session) => setQrSession(session), []);
  const handleCloseQR = useCallback(() => setQrSession(null), []);
  const handleSendMessage = useCallback(async (sessionId, message) => {
    if (window.ccIsland) return window.ccIsland.sendToSession(sessionId, message);
    return { success: false, error: 'ccIsland API not available' };
  }, []);
  const handleFocusCMD = useCallback(async (sessionId) => {
    if (window.ccIsland) return window.ccIsland.focusSessionWindow(sessionId);
    return false;
  }, []);

  const handleSaveSettings = useCallback((newSettings) => {
    setSettings(newSettings);
    if (window.ccIsland) {
      window.ccIsland.saveSettings(newSettings);
      if (newSettings.toggleShortcut !== settings.toggleShortcut) {
        window.ccIsland.updateGlobalShortcut(newSettings.toggleShortcut);
      }
    }
  }, [settings.toggleShortcut]);

  const handleOpenSettings = useCallback(() => {
    setCurrentView('settings');
  }, []);

  // Block Ctrl+W to prevent window close (global toggle is handled by main process globalShortcut)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const settingsPanel = currentView === 'settings' ? (
    <SettingsPanel
      settings={settings}
      onSave={handleSaveSettings}
      onBack={() => setCurrentView('sessions')}
    />
  ) : null;

  return (
    <div className="app-container">
      <DynamicIsland
        sessions={sessions}
        isExpanded={isExpanded}
        wechatStatus={wechatStatus}
        onClick={handleIslandClick}
        onShowQR={handleShowQR}
        onSendMessage={handleSendMessage}
        onFocusCMD={handleFocusCMD}
        onOpenSettings={handleOpenSettings}
        showTips={settings.showTips !== false}
        toggleShortcut={settings.toggleShortcut}
        panelContent={settingsPanel}
      />
      {qrSession && <QRCodeModal session={qrSession} onClose={handleCloseQR} />}
    </div>
  );
}
