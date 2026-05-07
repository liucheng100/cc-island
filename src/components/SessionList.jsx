import React, { useState, useMemo } from 'react';
import SessionCard from './SessionCard';

const FILTERS = {
  all: { label: '全部', icon: '⊡' },
  working: { label: '工作中', icon: '●' },
  completed: { label: '已完成', icon: '✓' },
};

export default function SessionList({ sessions, wechatStatus, onShowQR, onSendMessage }) {
  const [filter, setFilter] = useState('all');
  const [searchText, setSearchText] = useState('');

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (filter !== 'all') {
      result = result.filter((s) => s.status === filter);
    }
    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(lower) ||
          (s.cwd && s.cwd.toLowerCase().includes(lower))
      );
    }
    return result;
  }, [sessions, filter, searchText]);

  const counts = useMemo(() => {
    return {
      all: sessions.length,
      working: sessions.filter((s) => s.status === 'working' || s.status === 'thinking').length,
      completed: sessions.filter((s) => s.status === 'completed').length,
    };
  }, [sessions]);

  return (
    <div className="session-list">
      {/* Header */}
      <div className="list-header">
        <div className="list-header-top">
          <h2 className="list-title">Claude Code 灵动岛</h2>
          <div className="header-actions">
            <div className={`wechat-status-badge ${wechatStatus.connected ? 'connected' : ''}`}>
              <span className="wechat-dot" />
              <span className="wechat-text">
                {wechatStatus.connected ? '微信已连接' : '微信未连接'}
              </span>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="search-box">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="搜索会话..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        {/* Filters */}
        <div className="filter-tabs">
          {Object.entries(FILTERS).map(([key, { label, icon }]) => (
            <button
              key={key}
              className={`filter-tab ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              <span>{icon}</span>
              <span>{label}</span>
              <span className="filter-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Session Cards */}
      <div className="list-body">
        {filteredSessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
                <path d="M8 12h8M12 8v8" />
              </svg>
            </div>
            <p className="empty-title">
              {sessions.length === 0 ? '暂无活跃的 Claude 会话' : '没有匹配的会话'}
            </p>
            <p className="empty-desc">
              {sessions.length === 0
                ? '启动 Claude Code 后，会话将自动出现在这里'
                : '尝试更改筛选条件'}
            </p>
          </div>
        ) : (
          <div className="card-list">
            {filteredSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onShowQR={onShowQR}
                onSendMessage={onSendMessage}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .session-list {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-primary);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle);
          overflow: hidden;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        .list-header {
          padding: 16px 14px 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .list-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .list-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0.5px;
        }

        .wechat-status-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle);
          font-size: 10px;
          color: var(--text-muted);
        }

        .wechat-status-badge.connected {
          border-color: rgba(34,197,94,0.3);
          color: var(--success);
        }

        .wechat-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-muted);
        }

        .wechat-status-badge.connected .wechat-dot {
          background: var(--success);
          box-shadow: 0 0 6px var(--success-glow);
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          margin-bottom: 10px;
        }

        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .search-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: 12px;
          color: var(--text-primary);
        }

        .search-input::placeholder {
          color: var(--text-muted);
        }

        .filter-tabs {
          display: flex;
          gap: 6px;
        }

        .filter-tab {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 12px;
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-secondary);
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-tab:hover {
          border-color: var(--text-muted);
        }

        .filter-tab.active {
          background: rgba(99,102,241,0.15);
          border-color: var(--border-active);
          color: var(--accent);
        }

        .filter-count {
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 8px;
          background: rgba(255,255,255,0.06);
        }

        .list-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px 14px;
        }

        .card-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
        }

        .empty-icon {
          color: var(--text-muted);
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .empty-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 6px;
        }

        .empty-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
