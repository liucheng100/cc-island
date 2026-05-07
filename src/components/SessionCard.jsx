import React, { useState } from 'react';
import StatusIndicator from './StatusIndicator';

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '刚刚开始';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}小时${m % 60}分钟`;
  if (m > 0) return `${m}分钟`;
  return `${seconds}秒`;
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function SessionCard({ session, onShowQR, onSendMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);

  const recentMessages = session.messages ? session.messages.slice(-4) : [];
  const isActive = session.status === 'working' || session.status === 'thinking';

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;
    setIsSending(true);
    try {
      await onSendMessage(session.id, inputValue.trim());
      setInputValue('');
    } catch (e) {
      // ignore
    }
    setIsSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`session-card ${expanded ? 'expanded' : ''} status-${session.status}`}>
      {/* Header */}
      <div className="card-header" onClick={() => setExpanded(!expanded)}>
        <div className="card-header-left">
          <StatusIndicator status={session.status} />
          <div className="card-title">
            <span className="session-name">{session.name}</span>
            <span className="session-cwd">{session.cwd}</span>
          </div>
        </div>
        <div className="card-header-right">
          <span className="session-duration">{formatDuration(session.workingDuration)}</span>
          <button
            className="btn-qr"
            onClick={(e) => {
              e.stopPropagation();
              onShowQR(session);
            }}
            title="微信扫码连接"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button className="btn-expand" title={expanded ? '收起' : '展开'}>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.3s' }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="card-body">
          {/* Messages */}
          {recentMessages.length > 0 && (
            <div className="message-list">
              {recentMessages.map((msg, i) => (
                <div key={i} className={`message msg-${msg.role}`}>
                  <span className="msg-role">{msg.role === 'user' ? '你' : 'Claude'}</span>
                  <span className="msg-content">{msg.content}</span>
                  <span className="msg-time">{formatTime(msg.timestamp)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Input area */}
          <div className="card-input">
            <input
              type="text"
              className="msg-input"
              placeholder={isActive ? '输入指令发送到 Claude...' : '会话已结束'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isActive || isSending}
            />
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={!isActive || !inputValue.trim() || isSending}
            >
              {isSending ? '...' : '发送'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .session-card {
          background: var(--bg-card);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          overflow: hidden;
          transition: all var(--transition);
          animation: slide-in 0.3s ease-out;
        }

        .session-card:hover {
          border-color: var(--border-active);
        }

        .session-card.status-working {
          border-left: 3px solid #6366f1;
        }
        .session-card.status-completed {
          border-left: 3px solid #22c55e;
        }
        .session-card.status-error {
          border-left: 3px solid #ef4444;
        }
        .session-card.status-thinking {
          border-left: 3px solid #f59e0b;
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          cursor: pointer;
          user-select: none;
        }

        .card-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
        }

        .card-title {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .session-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .session-cwd {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .card-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .session-duration {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .btn-qr, .btn-expand {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .btn-qr:hover {
          color: var(--accent);
          background: rgba(99,102,241,0.1);
        }

        .btn-expand:hover {
          color: var(--text-primary);
          background: rgba(255,255,255,0.05);
        }

        .card-body {
          padding: 0 14px 12px;
          animation: slide-in 0.25s ease-out;
        }

        .message-list {
          max-height: 200px;
          overflow-y: auto;
          margin-bottom: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .message {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px 10px;
          border-radius: var(--radius-sm);
          font-size: 11px;
          line-height: 1.4;
        }

        .msg-user {
          background: rgba(99,102,241,0.1);
          border-left: 2px solid var(--accent);
        }

        .msg-assistant {
          background: rgba(255,255,255,0.03);
          border-left: 2px solid var(--text-muted);
        }

        .msg-role {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .msg-content {
          color: var(--text-primary);
        }

        .msg-time {
          font-size: 9px;
          color: var(--text-muted);
          text-align: right;
        }

        .card-input {
          display: flex;
          gap: 6px;
        }

        .msg-input {
          flex: 1;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 7px 10px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.2s;
        }

        .msg-input:focus {
          border-color: var(--border-active);
        }

        .msg-input:disabled {
          opacity: 0.4;
        }

        .btn-send {
          background: var(--accent);
          border: none;
          border-radius: var(--radius-sm);
          padding: 7px 14px;
          font-size: 12px;
          font-weight: 600;
          color: white;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .btn-send:hover:not(:disabled) {
          background: #5558e6;
        }

        .btn-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
