import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SessionList from './SessionList';

const STATUS_COLORS = {
  working: '#6366f1', thinking: '#f59e0b', answering: '#3b82f6',
  completed: '#22c55e', error: '#ef4444', disconnected: '#6b6b80',
};
const STATUS_LABELS = {
  working: '工作中', thinking: '思考中', answering: '回答中',
  completed: '已完成', error: '错误',
};

export default function DynamicIsland({ sessions, isExpanded, wechatStatus, onClick, onShowQR, onSendMessage, onFocusCMD, onFocusChange, panelContent, onOpenSettings, showTips, toggleShortcut }) {
  const [isDragging, setIsDragging] = useState(false);
  const [visualExpanded, setVisualExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, moved: false });
  const islandRef = useRef(null);

  useEffect(() => {
    let raf = null;
    let timer = null;
    const el = islandRef.current;

    if (isExpanded) {
      // Expand: delay one frame so browser paints collapsed size first
      raf = requestAnimationFrame(() => setVisualExpanded(true));
    } else if (visualExpanded) {
      // Collapse: remove expanded class → CSS animates height down
      setVisualExpanded(false);
      if (el) {
        const onEnd = (e) => {
          if (e.propertyName === 'height') {
            el.removeEventListener('transitionend', onEnd);
            window.ccIsland?.collapseAnimationDone();
          }
        };
        el.addEventListener('transitionend', onEnd);
      }
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      // Note: transitionend listener self-removes on fire, so no cleanup needed here
    };
  }, [isExpanded, visualExpanded]);

  const activeCount = sessions.filter((s) => s.status === 'working' || s.status === 'thinking' || s.status === 'answering').length;
  const completedCount = sessions.filter((s) => s.status === 'completed').length;
  const totalCount = sessions.length;

  const activeSession = useMemo(() => {
    const priority = { answering: 3, thinking: 2, working: 1 };
    let best = null;
    for (const s of sessions) {
      const p = priority[s.status] || 0;
      if (p > (priority[best?.status] || 0)) best = s;
    }
    return best;
  }, [sessions]);

  const previewText = useMemo(() => {
    if (!activeSession || !activeSession.messages || activeSession.messages.length === 0) return null;
    const msgs = activeSession.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' || m.role === 'user') {
        const roleLabel = m.role === 'assistant' ? 'Claude' : '你';
        const content = m.content.replace(/<[^>]+>/g, '').replace(/[#*`\n\r]/g, ' ').substring(0, 60);
        return { role: roleLabel, content };
      }
    }
    return null;
  }, [activeSession]);

  const handleMouseDown = useCallback((e) => {
    dragRef.current.dragging = true;
    dragRef.current.startX = e.screenX;
    dragRef.current.startY = e.screenY;
    dragRef.current.moved = false;
    dragRef.current.buttonClicked = false;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.dragging) return;
      const dx = e.screenX - dragRef.current.startX;
      const dy = e.screenY - dragRef.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
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
      if (!dragRef.current.moved && !dragRef.current.buttonClicked) onClick();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onClick]);

  const handleToggleFullscreen = useCallback((e) => {
    e.stopPropagation();
    dragRef.current.buttonClicked = true;
    if (window.ccIsland) window.ccIsland.toggleFullscreen().then(setIsFullscreen);
  }, []);

  // Sync fullscreen state on expand
  useEffect(() => {
    if (isExpanded && window.ccIsland) window.ccIsland.getFullscreenState().then(setIsFullscreen);
  }, [isExpanded]);

  const dominantStatus = activeSession?.status || (completedCount > 0 ? 'completed' : 'idle');
  const glowColor = STATUS_COLORS[dominantStatus] || STATUS_COLORS.working;
  const hasActivity = activeCount > 0;
  const statusLabel = activeSession ? STATUS_LABELS[activeSession.status] || '' : '';

  return (
    <div
      ref={islandRef}
      className={`dynamic-island ${visualExpanded ? 'expanded' : ''} ${hasActivity ? 'has-activity' : ''} ${isDragging ? 'dragging' : ''} status-${dominantStatus}`}
      style={{ '--status-color': glowColor, '--status-glow': `${glowColor}66`, '--status-glow-strong': `${glowColor}33` }}
    >
      {/* Pill header — always visible, draggable */}
      <div className="island-header" onMouseDown={handleMouseDown}>
        {isExpanded && showTips && toggleShortcut && <span className="kb-tip tip-ctrl-w">{toggleShortcut} 收起</span>}
        {!isExpanded && showTips && toggleShortcut && <span className="kb-tip tip-expand">{toggleShortcut} 展开</span>}
        <div className="island-inner">
          <div className="island-left">
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
              {previewText && !visualExpanded ? (
                <>
                  <div className="island-preview-role">{previewText.role} <span className="island-status-tag" style={{ color: glowColor }}>● {statusLabel}</span></div>
                  <div className="island-preview-content">{previewText.content}</div>
                </>
              ) : (
                <>
                  <div className="island-title">Claude Code</div>
                  <div className="island-subtitle">
                    {totalCount === 0 ? '等待 Claude 启动...' : `${activeCount} 工作中 · ${completedCount} 已完成`}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="island-right">
            {!visualExpanded && totalCount > 0 && (
              <div className="session-dots">
                {sessions.slice(0, 4).map((s, i) => (
                  <span key={s.id} className="dot"
                    style={{ backgroundColor: STATUS_COLORS[s.status] || STATUS_COLORS.disconnected, animationDelay: `${i * 0.15}s` }}
                    title={`${s.name}: ${s.status}`} />
                ))}
                {totalCount > 4 && <span className="dot-more">+{totalCount - 4}</span>}
              </div>
            )}
            {!visualExpanded && (
              <div className={`wechat-indicator ${wechatStatus.connected ? 'connected' : ''}`} title={wechatStatus.connected ? '微信已连接' : '微信未连接'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill={wechatStatus.connected ? '#22c55e' : '#6b6b80'}>
                  <path d="M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm5 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-6.5 3c0 2.5 4 3.5 6 3.5s6-1 6-3.5M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                </svg>
              </div>
            )}
            {visualExpanded && (
              <div className="btn-fullscreen" onMouseDown={(e) => e.stopPropagation()} onClick={handleToggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏模式'}>
                {isFullscreen ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                  </svg>
                )}
              </div>
            )}
            <div className={`expand-arrow ${visualExpanded ? 'expanded' : ''}`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Panel body — visible when expanded */}
      <div className={`island-panel ${visualExpanded ? 'panel-visible' : ''}`}>
        {panelContent || (
          <SessionList
            sessions={sessions}
            wechatStatus={wechatStatus}
            onShowQR={onShowQR}
            onSendMessage={onSendMessage}
            onFocusCMD={onFocusCMD}
            onFocusChange={onFocusChange}
            onOpenSettings={onOpenSettings}
            isExpanded={isExpanded}
            showTips={showTips}
          />
        )}
      </div>

      <style>{`
        .dynamic-island {
          width: 340px; height: 52px; border-radius: 26px;
          background: var(--bg-panel-top);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--border-subtle);
          cursor: grab; user-select: none; position: relative; overflow: hidden;
          display: flex; flex-direction: column;
          transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                      height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                      border-radius 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                      background 0.5s ease, border-color 0.5s ease;
        }
        .dynamic-island.expanded {
          width: 420px; height: 640px; border-radius: 20px;
          background: linear-gradient(180deg, var(--bg-panel-top) 0%, var(--bg-panel-top) 52px, var(--bg-deep) 52px, var(--bg-panel-bot) 100%);
        }
        .dynamic-island:not(.expanded).status-working {
          background: linear-gradient(135deg, rgba(99,102,241,0.5) 0%, var(--bg-panel-top) 60%, var(--bg-panel-top) 100%);
          border-color: rgba(99,102,241,0.45);
        }
        .dynamic-island:not(.expanded).status-thinking {
          background: linear-gradient(135deg, rgba(245,158,11,0.5) 0%, var(--bg-panel-top) 60%, var(--bg-panel-top) 100%);
          border-color: rgba(245,158,11,0.45);
        }
        .dynamic-island:not(.expanded).status-answering {
          background: linear-gradient(135deg, rgba(59,130,246,0.5) 0%, var(--bg-panel-top) 60%, var(--bg-panel-top) 100%);
          border-color: rgba(59,130,246,0.45);
        }
        .dynamic-island:not(.expanded).status-completed {
          background: linear-gradient(135deg, rgba(34,197,94,0.4) 0%, var(--bg-panel-top) 60%, var(--bg-panel-top) 100%);
          border-color: rgba(34,197,94,0.35);
        }
        .dynamic-island:not(.expanded).status-error {
          background: linear-gradient(135deg, rgba(239,68,68,0.5) 0%, var(--bg-panel-top) 60%, var(--bg-panel-top) 100%);
          border-color: rgba(239,68,68,0.45);
        }
        .dynamic-island:not(.expanded).status-idle {
          background: var(--bg-panel-top);
          border-color: var(--border-subtle);
        }
        .dynamic-island:active { cursor: grabbing; }
        .dynamic-island::before {
          content: ''; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px;
          border-radius: calc(26px - 2px); pointer-events: none;
          background: linear-gradient(135deg, var(--status-color), transparent 40%, transparent 60%, var(--status-color));
          opacity: 0; z-index: -1;
          transition: opacity 0.5s ease, border-radius 0.35s ease;
        }
        .dynamic-island.expanded::before {
          border-radius: calc(20px - 2px);
        }
        .dynamic-island:not(.expanded).has-activity::before { opacity: 0.25; animation: pulse-glow 2s ease-in-out infinite; }
        .dynamic-island.expanded::before {
          opacity: 0.1;
          background: linear-gradient(135deg, var(--status-color), transparent 50%, transparent);
        }
        .dynamic-island:hover:not(.dragging):not(.expanded) { border-color: var(--status-color); }
        .dynamic-island.expanded:hover:not(.dragging) { border-color: rgba(255,255,255,0.12); }

        .island-header {
          flex-shrink: 0; width: 100%; height: 52px;
          display: flex; align-items: center;
          position: relative; z-index: 1;
        }
        .island-header:hover { background: none; }
        .dynamic-island.expanded .island-header {
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .island-inner { display: flex; align-items: center; width: 100%; height: 100%; padding: 0 14px; gap: 8px; pointer-events: none; }
        .island-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .island-icon { flex-shrink: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
        .working-indicator { display: flex; align-items: center; justify-content: center; }
        .dot-pulse { width: 10px; height: 10px; border-radius: 50%; background: var(--glow-color); animation: pulse-glow 1.5s ease-in-out infinite; }
        .idle-icon { color: var(--text-secondary); opacity: 0.7; }
        .island-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
        .island-title { font-size: 12px; font-weight: 600; color: var(--text-primary); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dynamic-island.expanded .island-title { font-size: 13px; }
        .island-subtitle { font-size: 10px; color: var(--text-secondary); line-height: 1.2; white-space: nowrap; }
        .dynamic-island.status-completed:not(.expanded) .island-subtitle { color: #22c55e; }
        .dynamic-island.status-error:not(.expanded) .island-subtitle { color: #ef4444; }
        .island-preview-role { font-size: 9px; color: var(--text-muted); line-height: 1.2; white-space: nowrap; }
        .island-status-tag { font-size: 8px; font-weight: 600; }
        .island-preview-content { font-size: 11px; color: var(--text-primary); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: fade-slide-in 0.4s ease-out; }
        @keyframes fade-slide-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .kb-tip {
          position: absolute; z-index: 10; pointer-events: none;
          background: rgba(18,18,24,0.95); color: #f0f0f5;
          font-size: 10px; padding: 3px 8px; border-radius: 5px;
          border: 1px solid rgba(255,255,255,0.15);
          white-space: nowrap; opacity: 0; transition: opacity 0.15s;
        }
        .island-header:hover .kb-tip { opacity: 1; }
        .tip-ctrl-w {
          right: 30px; top: 50%; transform: translateY(-50%);
        }
        .tip-expand {
          left: 50%; top: 50%; transform: translate(-50%, -50%);
        }
        .island-right { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
        .session-dots { display: flex; align-items: center; gap: 3px; }
        .session-dots .dot { width: 6px; height: 6px; border-radius: 50%; animation: breathe 2s ease-in-out infinite; }
        .dot-more { font-size: 8px; color: var(--text-muted); margin-left: 2px; }
        .wechat-indicator { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; opacity: 0.5; transition: opacity var(--transition); }
        .wechat-indicator.connected { opacity: 1; }
        .btn-fullscreen { display: flex; align-items: center; color: var(--text-muted); cursor: pointer; padding: 2px; border-radius: 4px; transition: all 0.15s; }
        .btn-fullscreen:hover { color: var(--text-primary); background: rgba(255,255,255,0.06); }
        .expand-arrow { display: flex; align-items: center; color: var(--text-muted); transition: transform var(--transition), color 0.3s; }
        .expand-arrow.expanded { transform: rotate(180deg); color: rgba(255,255,255,0.5); }

        .island-panel {
          flex: 1; min-height: 0; overflow: hidden;
          opacity: 0; pointer-events: none;
          transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative; z-index: 0;
        }
        .island-panel.panel-visible {
          opacity: 1; pointer-events: auto;
        }
      `}</style>
    </div>
  );
}
