import React, { useState, useEffect, useCallback, useRef } from 'react';
import DynamicIsland from './components/DynamicIsland';
import SessionList from './components/SessionList';
import QRCodeModal from './components/QRCodeModal';
import { playCompletionSound, playErrorSound, playNewSessionSound } from './hooks/useNotification';
import './App.css';

const VIEWS = { ISLAND: 'island', SESSIONS: 'sessions' };

export default function App() {
  const [view, setView] = useState(VIEWS.ISLAND);
  const [sessions, setSessions] = useState([]);
  const [wechatStatus, setWechatStatus] = useState({ connected: false });
  const [isExpanded, setIsExpanded] = useState(false);
  const [qrSession, setQrSession] = useState(null);
  const prevStatusRef = useRef({});

  // Determine view from hash
  useEffect(() => {
    const hash = window.location.hash.replace('#/', '');
    if (hash === 'sessions') {
      setView(VIEWS.SESSIONS);
      // Session list window must NOT be draggable so clicks work
      document.body.style.setProperty('-webkit-app-region', 'no-drag');
    } else {
      setView(VIEWS.ISLAND);
      // Island window IS draggable
      document.body.style.setProperty('-webkit-app-region', 'drag');
    }
  }, []);

  // Listen for session updates from Electron
  useEffect(() => {
    if (!window.ccIsland) return;

    const unsub1 = window.ccIsland.onSessionsUpdated((updatedSessions) => {
      const list = updatedSessions || [];
      const prev = prevStatusRef.current;
      const currentIds = new Set(list.map((s) => s.id));

      // Detect new sessions
      for (const s of list) {
        if (!prev[s.id]) {
          playNewSessionSound();
        }
        // Detect completion transition
        if (prev[s.id] && prev[s.id] !== 'completed' && s.status === 'completed') {
          playCompletionSound();
        }
        // Detect errors
        if (prev[s.id] && prev[s.id] !== 'error' && s.status === 'error') {
          playErrorSound();
        }
      }

      // Update prev state
      const newPrev = {};
      for (const s of list) newPrev[s.id] = s.status;
      prevStatusRef.current = newPrev;

      setSessions(list);
    });

    const unsub2 = window.ccIsland.onWechatStatus((status) => {
      setWechatStatus(status);
    });

    const unsub3 = window.ccIsland.onIslandExpand(() => {
      setIsExpanded(true);
    });

    const unsub4 = window.ccIsland.onIslandCollapse(() => {
      setIsExpanded(false);
    });

    // Initial load
    window.ccIsland.getSessions().then(setSessions);
    window.ccIsland.getWechatStatus().then(setWechatStatus);

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const handleIslandClick = useCallback(() => {
    if (window.ccIsland) {
      window.ccIsland.toggleIsland();
    }
  }, []);

  const handleShowQR = useCallback((session) => {
    setQrSession(session);
  }, []);

  const handleCloseQR = useCallback(() => {
    setQrSession(null);
  }, []);

  const handleSendMessage = useCallback(async (sessionId, message) => {
    if (window.ccIsland) return window.ccIsland.sendToSession(sessionId, message);
    return false;
  }, []);

  if (view === VIEWS.ISLAND) {
    return (
      <div className="app island-app">
        <DynamicIsland
          sessions={sessions}
          isExpanded={isExpanded}
          wechatStatus={wechatStatus}
          onClick={handleIslandClick}
        />
      </div>
    );
  }

  return (
    <div className="app sessions-app">
      <SessionList
        sessions={sessions}
        wechatStatus={wechatStatus}
        onShowQR={handleShowQR}
        onSendMessage={handleSendMessage}
      />
      {qrSession && (
        <QRCodeModal session={qrSession} onClose={handleCloseQR} />
      )}
    </div>
  );
}
