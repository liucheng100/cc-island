import React, { useState, useRef, useEffect, useMemo } from 'react';
import StatusIndicator from './StatusIndicator';
import { marked } from 'marked';

// Configure marked for safe inline rendering
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  const html = marked.parse(text);
  // Strip wrapping <p> tags for inline display
  return html.replace(/^<p>|<\/p>\n?$/g, '');
}

function formatDuration(s) {
  if (!s || s < 0) return '刚刚开始';
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function SessionCard({ session, onShowQR, onSendMessage, onFocusCMD, onFocusChange }) {
  const [expanded, setExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const msgListRef = useRef(null);
  const prevExpandedRef = useRef(false);

  const recentMessages = session.messages ? session.messages.slice(-20) : [];
  const isActive = session.status !== 'disconnected' && session.status !== 'error';

  useEffect(() => {
    if (expanded && msgListRef.current) {
      const el = msgListRef.current;
      const isFirstExpand = !prevExpandedRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (isFirstExpand || isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevExpandedRef.current = expanded;
  }, [expanded, session.messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      const result = await onSendMessage(session.id, inputValue.trim());
      if (result && result.success) {
        setInputValue('');
      } else {
        setSendError((result && result.error) || '发送失败');
        setTimeout(() => setSendError(null), 4000);
      }
    } catch (e) {
      setSendError('发送出错: ' + e.message);
      setTimeout(() => setSendError(null), 4000);
    }
    setIsSending(false);
  };

  return (
    <div className={`session-card ${expanded ? 'expanded' : ''} status-${session.status}`}>
      <div className="card-header" onClick={() => setExpanded(!expanded)}>
        <div className="card-header-left">
          <StatusIndicator status={session.status} />
          <div className="card-title">
            <span className="session-name">{session.name}</span>
            <span className="session-cwd">{session.cwd}</span>
            <span className="session-pid">PID:{session.pid} → Terminal:{session.terminalPid || session.parentPid || '?'}</span>
          </div>
        </div>
        <div className="card-header-right">
          <span className="session-duration">{formatDuration(session.workingDuration)}</span>
          {isActive && (
            <button className="btn-focus" onClick={(e) => { e.stopPropagation(); onFocusCMD(session.id); }} title="弹出 CMD 窗口">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
              </svg>
            </button>
          )}
          <button className="btn-qr" onClick={(e) => { e.stopPropagation(); onShowQR(session); }} title="微信扫码">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button className="btn-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.3s' }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="card-body">
          {recentMessages.length > 0 ? (
            <div className="message-list" ref={msgListRef}>
              {recentMessages.map((msg, i) => (
                <div key={i} className={`message msg-${msg.role}`}>
                  <span className="msg-role">{msg.role === 'user' ? '你' : 'Claude'}</span>
                  <span className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  <span className="msg-time">{formatTime(msg.timestamp)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-messages">暂无对话记录</div>
          )}
          <div className="card-input">
            <input type="text" className="msg-input" placeholder={isActive ? '输入指令...' : '会话已结束'}
              value={inputValue} onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
              onFocus={() => onFocusChange && onFocusChange(true)}
              onBlur={() => onFocusChange && onFocusChange(false)}
              disabled={!isActive || isSending} />
            <button className="btn-send" onClick={handleSend} disabled={!isActive || !inputValue.trim() || isSending}>
              {isSending ? '...' : '发送'}
            </button>
          </div>
          {sendError && <div className="send-error">{sendError}</div>}
        </div>
      )}

      <style>{`
        .session-card {
          position: relative;
          background: linear-gradient(135deg, rgba(38,38,48,0.7), rgba(28,28,36,0.6));
          border-radius: var(--radius-md);
          border: 1px solid rgba(255,255,255,0.05);
          overflow: hidden;
          transition: all var(--transition);
          animation: slide-in 0.3s ease-out;
        }
        .session-card::before {
          content: ''; position: absolute; top: 0; left: 0; width: 3px; height: 100%;
          border-radius: var(--radius-md) 0 0 var(--radius-md);
          transition: all 0.3s ease;
        }
        .session-card:hover { border-color: rgba(255,255,255,0.1); box-shadow: 0 2px 12px rgba(0,0,0,0.2); }
        .session-card.status-working { border-left: 3px solid #6366f1; }
        .session-card.status-working:hover { box-shadow: 0 2px 16px rgba(99,102,241,0.12); }
        .session-card.status-thinking { border-left: 3px solid #f59e0b; }
        .session-card.status-thinking:hover { box-shadow: 0 2px 16px rgba(245,158,11,0.12); }
        .session-card.status-answering { border-left: 3px solid #3b82f6; }
        .session-card.status-answering:hover { box-shadow: 0 2px 16px rgba(59,130,246,0.12); }
        .session-card.status-completed { border-left: 3px solid #22c55e; opacity: 0.8; }
        .session-card.status-error { border-left: 3px solid #ef4444; }
        .session-card.status-error:hover { box-shadow: 0 2px 16px rgba(239,68,68,0.12); }
        .card-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; user-select: none; }
        .card-header-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .card-title { display: flex; flex-direction: column; min-width: 0; }
        .session-name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .session-cwd { font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .session-pid { font-size: 9px; color: var(--text-muted); font-family: monospace; opacity: 0.7; }
        .card-header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .session-duration { font-size: 10px; color: var(--text-muted); white-space: nowrap; }
        .btn-focus, .btn-qr, .btn-expand { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .btn-focus:hover { color: #f59e0b; background: rgba(245,158,11,0.1); }
        .btn-qr:hover { color: var(--accent); background: rgba(99,102,241,0.1); }
        .btn-expand:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
        .card-body { padding: 0 14px 12px; animation: slide-in 0.25s ease-out; }
        .message-list { max-height: 240px; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
        .message { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 11px; line-height: 1.4; }
        .msg-user { background: rgba(99,102,241,0.1); border-left: 2px solid var(--accent); }
        .msg-assistant { background: rgba(255,255,255,0.03); border-left: 2px solid var(--text-muted); }
        .msg-role { font-size: 9px; font-weight: 600; color: var(--text-muted); }
        .msg-content { color: var(--text-primary); word-break: break-word; }
        .msg-content strong { color: #f0f0f5; font-weight: 700; }
        .msg-content em { font-style: italic; color: #d0d0e0; }
        .msg-content code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 10px; }
        .msg-content pre { background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 6px; overflow-x: auto; margin: 4px 0; }
        .msg-content pre code { background: none; padding: 0; }
        .msg-content ul, .msg-content ol { margin: 2px 0; padding-left: 16px; }
        .msg-content li { margin: 1px 0; }
        .msg-content blockquote { border-left: 2px solid var(--border-active); padding-left: 8px; margin: 4px 0; color: var(--text-secondary); }
        .msg-content h1, .msg-content h2, .msg-content h3 { font-size: 12px; font-weight: 700; margin: 4px 0 2px; }
        .msg-content a { color: var(--accent); }
        .msg-content hr { border: none; border-top: 1px solid var(--border-subtle); margin: 4px 0; }
        .msg-content table { border-collapse: collapse; font-size: 10px; }
        .msg-content th, .msg-content td { border: 1px solid var(--border-subtle); padding: 2px 6px; }
        .msg-time { font-size: 9px; color: var(--text-muted); text-align: right; }
        .no-messages { text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px; }
        .card-input { display: flex; gap: 6px; }
        .msg-input { flex: 1; background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 7px 10px; font-size: 12px; color: var(--text-primary); outline: none; transition: border-color 0.2s; }
        .msg-input:focus { border-color: var(--border-active); }
        .msg-input:disabled { opacity: 0.4; }
        .btn-send { background: var(--accent); border: none; border-radius: var(--radius-sm); padding: 7px 14px; font-size: 12px; font-weight: 600; color: white; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
        .btn-send:hover:not(:disabled) { background: #5558e6; }
        .btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
        .send-error { margin-top: 6px; padding: 6px 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-sm); font-size: 11px; color: #ef4444; animation: slide-in 0.2s ease-out; }
      `}</style>
    </div>
  );
}
