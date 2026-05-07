import React, { useState, useEffect, useRef, useCallback } from 'react';

const STATUS_COLORS = {
  working: '#6366f1', thinking: '#f59e0b', completed: '#22c55e',
  error: '#ef4444', disconnected: '#6b6b80',
};

export default function DynamicIsland({ sessions, isExpanded, wechatStatus, onClick }) {
  const [animationState, setAnimationState] = useState('idle');
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, moved: false, winX: 0, winY: 0 });
  const islandRef = useRef(null);

  const activeCount = sessions.filter((s) => s.status === 'working' || s.status === 'thinking').length;
  const completedCount = sessions.filter((s) => s.status === 'completed').length;
  const totalCount = sessions.length;

  useEffect(() => {
    setAnimationState(isExpanded ? 'expanded' : 'collapsed');
  }, [isExpanded]);

  // Pure JS drag — no -webkit-app-region needed
  const handleMouseDown = useCallback((e) => {
    dragRef.current.dragging = true;
    dragRef.current.startX = e.screenX;
    dragRef.current.startY = e.screenY;
    dragRef.current.moved = false;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.dragging) return;
      const dx = e.screenX - dragRef.current.startX;
      const dy = e.screenY - dragRef.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        dragRef.current.moved = true;
      }
      if (dragRef.current.moved && window.ccIsland) {
        window.ccIsland.moveWindow(dx, dy);
        dragRef.current.startX = e.screenX;
        dragRef.current.startY = e.screenY;
      }
    };
    const onUp = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      setIsDragging(false);
      if (!dragRef.current.moved) {
        onClick();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onClick]);

  const dominantStatus = activeCount > 0 ? 'working' : completedCount > 0 ? 'completed' : totalCount > 0 ? 'working' : 'idle';
  const glowColor = STATUS_COLORS[dominantStatus] || STATUS_COLORS.working;
  const hasActivity = activeCount > 0;

  return (
    <div
      ref={islandRef}
      className={`dynamic-island ${animationState} ${hasActivity ? 'has-activity' : ''} ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
      style={{ '--glow-color': glowColor }}
    >
      <div className="island-inner">
        <div className="island-icon">
          {hasActivity ? (
            <div className="working-indicator"><div className="dot-pulse" /></div>
          ) : (
            <div className="idle-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><path d="M12 6v6l4 2" />
              </svg>
            </div>
          )}
        </div>
        <div className="island-info">
          <div className="island-title">Claude Code</div>
          <div className="island-subtitle">
            {totalCount === 0 ? '等待 Claude 启动...' : `${activeCount} 工作中 · ${completedCount} 已完成`}
          </div>
        </div>
        <div className="island-status">
          {totalCount > 0 && (
            <div className="session-dots">
              {sessions.slice(0, 4).map((s, i) => (
                <span key={s.id} className="dot"
                  style={{ backgroundColor: STATUS_COLORS[s.status] || STATUS_COLORS.disconnected, animationDelay: `${i * 0.15}s` }}
                  title={`${s.name}: ${s.status}`} />
              ))}
              {totalCount > 4 && <span className="dot-more">+{totalCount - 4}</span>}
            </div>
          )}
          <div className={`wechat-indicator ${wechatStatus.connected ? 'connected' : ''}`} title={wechatStatus.connected ? '微信已连接' : '微信未连接'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill={wechatStatus.connected ? '#22c55e' : '#6b6b80'}>
              <path d="M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm5 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-6.5 3c0 2.5 4 3.5 6 3.5s6-1 6-3.5M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
          </div>
          <div className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </div>
      <style>{`
        .dynamic-island {
          width: 280px; height: 44px; border-radius: 22px;
          background: var(--bg-primary);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-subtle);
          cursor: grab; transition: all var(--transition);
          user-select: none; position: relative; overflow: hidden;
        }
        .dynamic-island:active { cursor: grabbing; }
        .dynamic-island::before {
          content: ''; position: absolute; top: -1px; left: -1px; right: -1px; bottom: -1px;
          border-radius: 23px;
          background: linear-gradient(135deg, var(--glow-color), transparent, var(--glow-color));
          opacity: 0.3; z-index: -1; transition: opacity var(--transition);
        }
        .dynamic-island:hover:not(.dragging) { border-color: var(--border-active); transform: scale(1.02); box-shadow: var(--shadow-glow); }
        .dynamic-island.has-activity::before { opacity: 0.6; animation: pulse-glow 2s ease-in-out infinite; }
        .island-inner { display: flex; align-items: center; height: 100%; padding: 0 12px; gap: 10px; pointer-events: none; }
        .island-icon { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
        .working-indicator { display: flex; align-items: center; justify-content: center; }
        .dot-pulse { width: 10px; height: 10px; border-radius: 50%; background: var(--glow-color); animation: pulse-glow 1.5s ease-in-out infinite; }
        .idle-icon { color: var(--text-secondary); opacity: 0.7; }
        .island-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .island-title { font-size: 13px; font-weight: 600; color: var(--text-primary); line-height: 1.2; }
        .island-subtitle { font-size: 10px; color: var(--text-secondary); line-height: 1.2; }
        .island-status { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
        .session-dots { display: flex; align-items: center; gap: 3px; }
        .session-dots .dot { width: 6px; height: 6px; border-radius: 50%; animation: breathe 2s ease-in-out infinite; }
        .dot-more { font-size: 8px; color: var(--text-muted); margin-left: 2px; }
        .wechat-indicator { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; opacity: 0.5; transition: opacity var(--transition); }
        .wechat-indicator.connected { opacity: 1; }
        .expand-arrow { display: flex; align-items: center; color: var(--text-muted); transition: transform var(--transition); }
        .expand-arrow.expanded { transform: rotate(180deg); }
      `}</style>
    </div>
  );
}
