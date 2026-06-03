import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import StatusIndicator from './StatusIndicator';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

const TOOL_META = {
  thinking: { icon: '💭', cls: 'thinking', label: '思考' },
  Bash: { icon: '🖥️', cls: 'bash', label: 'Bash' },
  Read: { icon: '📖', cls: 'read', label: 'Read' },
  Write: { icon: '✏️', cls: 'write', label: 'Write' },
  Edit: { icon: '✏️', cls: 'edit', label: 'Edit' },
  Grep: { icon: '🔍', cls: 'grep', label: 'Grep' },
  Glob: { icon: '🔍', cls: 'glob', label: 'Glob' },
  WebSearch: { icon: '🌐', cls: 'web', label: 'Search' },
  WebFetch: { icon: '🌐', cls: 'web', label: 'Fetch' },
  Agent: { icon: '🤖', cls: 'agent', label: 'Agent' },
  AskUserQuestion: { icon: '❓', cls: 'ask', label: 'Question' },
  ExitPlanMode: { icon: '📋', cls: 'plan', label: 'Plan' },
};

function parseToolMsg(content) {
  if (!content) return null;
  const m = content.match(/^\[([A-Za-z]+)\]\s*([\s\S]*)/);
  if (!m) return null;
  const name = m[1];
  const meta = TOOL_META[name];
  if (!meta) return null;
  const rest = m[2] || '';
  const lines = rest.split('\n');
  const arg = lines[0] || '';
  const body = lines.slice(1).join('\n').trim();
  return { meta, arg, body, fullContent: body || arg || '' };
}

function renderMarkdown(text) {
  if (!text) return '';
  const html = marked.parse(text);
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

const STATUS_COLORS = {
  working: '#6366f1', thinking: '#f59e0b', answering: '#3b82f6',
  completed: '#22c55e', error: '#ef4444', disconnected: '#6b6b80',
};

export default function SessionList({ sessions, wechatStatus, onShowQR, onSendMessage, onFocusCMD, onFocusChange, onOpenSettings, isExpanded, showTips }) {
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [inputValues, setInputValues] = useState({});
  const [isSending, setIsSending] = useState(false);
  const [collapsedTools, setCollapsedTools] = useState(new Set()); // Set of indices that are collapsed
  const [pendingSend, setPendingSend] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [optimisticMsg, setOptimisticMsg] = useState(null);
  const [cmdQueue, setCmdQueue] = useState([]);
  const [queueMode, setQueueMode] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [countdown, setCountdown] = useState(0); // seconds remaining, 0 = inactive
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [queueDragIdx, setQueueDragIdx] = useState(-1);
  const [queueDragOverIdx, setQueueDragOverIdx] = useState(-1);
  const [tabOrder, setTabOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('cc-island-tab-order');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragOverTabRef = useRef(false);
  const msgListRef = useRef(null);
  const prevSelectedRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const followModeRef = useRef(true);

  const orderedIds = useMemo(() => {
    const currentIds = sessions.map(s => s.id);
    const validOrder = tabOrder.filter(id => currentIds.includes(id));
    const newIds = currentIds.filter(id => !validOrder.includes(id));
    const result = [...validOrder, ...newIds];
    try { localStorage.setItem('cc-island-tab-order', JSON.stringify(result)); } catch {}
    return result;
  }, [sessions, tabOrder]);

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(lower) ||
          (s.cwd && s.cwd.toLowerCase().includes(lower))
      );
    }
    const orderMap = {};
    orderedIds.forEach((id, i) => { orderMap[id] = i; });
    result = [...result].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999));
    return result;
  }, [sessions, searchText, orderedIds]);

  // Auto-select first session when filtered list changes
  useEffect(() => {
    if (filteredSessions.length > 0) {
      setSelectedId((prev) => {
        if (prev && filteredSessions.find((s) => s.id === prev)) return prev;
        return filteredSessions[0].id;
      });
    } else {
      setSelectedId(null);
    }
  }, [filteredSessions]);

  const selectedSession = useMemo(
    () => filteredSessions.find((s) => s.id === selectedId) || null,
    [filteredSessions, selectedId]
  );

  const cycleTab = useCallback((direction) => {
    if (filteredSessions.length === 0) return;
    const idx = filteredSessions.findIndex((s) => s.id === selectedId);
    const next = idx < 0 ? 0 : (idx + direction + filteredSessions.length) % filteredSessions.length;
    setSelectedId(filteredSessions[next].id);
  }, [filteredSessions, selectedId]);

  // Clear pendingSend when Claude starts processing, or on tab switch
  useEffect(() => {
    if (!selectedSession) return;
    if (selectedSession.status === 'thinking' || selectedSession.status === 'answering' || selectedSession.status === 'completed') {
      setPendingSend(false);
    }
  }, [selectedSession?.status, selectedId]);

  const scrollToBottom = () => {
    const el = msgListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followModeRef.current = true;
  };

  const handleMsgScroll = () => {
    const el = msgListRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    followModeRef.current = distFromBottom < 10;
  };

  // ResizeObserver: when DOM inside messages changes and we're in follow mode, stick to bottom
  useEffect(() => {
    const el = msgListRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (followModeRef.current && el) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedId]);

  // Scroll to bottom on first select + focus input
  useEffect(() => {
    if (selectedId && selectedId !== prevSelectedRef.current) {
      scrollToBottom();
      if (inputRef.current) inputRef.current.focus();
      setPendingSend(false);
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  // Scroll to bottom when island expands
  useEffect(() => {
    if (isExpanded && msgListRef.current) {
      scrollToBottom();
    }
  }, [isExpanded]);

  const recentMessages = (() => {
    const base = selectedSession?.messages ? selectedSession.messages.slice(-20) : [];
    if (optimisticMsg && optimisticMsg.content) {
      // Only show optimistic if last real user msg doesn't match
      const lastUser = [...base].reverse().find(m => m.role === 'user');
      if (!lastUser || lastUser.content !== optimisticMsg.content) {
        return [...base, { ...optimisticMsg, role: 'user', _optimistic: true }];
      }
    }
    return base;
  })();
  const isActive = selectedSession && selectedSession.status !== 'disconnected' && selectedSession.status !== 'error';

  // Load command queue and autoPlay when selected session changes
  useEffect(() => {
    if (!selectedId || !window.ccIsland) { setCmdQueue([]); setAutoPlay(false); return; }
    window.ccIsland.getQueue(selectedId).then(q => setCmdQueue(q || []));
    window.ccIsland.getAutoPlay(selectedId).then(ap => { const on = ap !== false; setAutoPlay(on); if (on) window.ccIsland.setAutoPlay(selectedId, true); });
    window.ccIsland.getQueueMode(selectedId).then(v => setQueueMode(!!v));
    const unsub1 = window.ccIsland.onQueueUpdated((data) => {
      if (data.sessionId === selectedId) {
        setCmdQueue(data.queue || []);
        if (data.autoPlay !== undefined) setAutoPlay(data.autoPlay);
        if (data.queueMode !== undefined) setQueueMode(data.queueMode);
      }
    });
    const unsub2 = window.ccIsland.onQueueAutoReady((data) => {
      if (data.sessionId === selectedId) setCountdown(2);
    });
    return () => { if (unsub1) unsub1(); if (unsub2) unsub2(); };
  }, [selectedId]);

  // Countdown → send when reaches 0
  useEffect(() => {
    if (countdown <= 0) return;
    if (countdown === 1) {
      // Will hit 0 on next tick — send now
      const t = setTimeout(() => {
        setCountdown(0);
        if (window.ccIsland) window.ccIsland.sendNextFromQueue(selectedId);
      }, 1000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, selectedId]);

  // Clear optimistic message when server confirms (via sessions update)
  useEffect(() => {
    if (!optimisticMsg || !selectedSession?.messages) return;
    const lastUser = [...selectedSession.messages].reverse().find(m => m.role === 'user');
    if (lastUser && lastUser.content === optimisticMsg.content && !lastUser._optimistic) {
      setOptimisticMsg(null);
    }
  }, [selectedSession?.messages, optimisticMsg]);

  // Auto-scroll when in follow mode and content changes
  useEffect(() => {
    if (followModeRef.current) {
      scrollToBottom();
    }
  }, [recentMessages.length, selectedSession?.status, isSending, pendingSend]);

  const curInput = inputValues[selectedId] || '';

  const handleSend = useCallback(async () => {
    if (!curInput.trim() || isSending || !selectedSession) return;
    const text = curInput.trim();
    // Optimistic: clear input + inject message immediately with loading state
    setInputValues((prev) => ({ ...prev, [selectedSession.id]: '' }));
    setIsSending(true);
    setPendingSend(true);
    setSendError(null);
    // Optimistic: show message instantly with loading indicator
    setOptimisticMsg({ content: text, timestamp: new Date().toISOString() });
    try {
      const result = await onSendMessage(selectedSession.id, text);
      if (!result || !result.success) {
        // Failed — remove optimistic message, show error
        setOptimisticMsg(null);
        setSendError((result && result.error) || '发送失败');
        setTimeout(() => setSendError(null), 4000);
      }
      // On success: optimistic msg cleared when sessions-updated delivers the confirmed msg
    } catch (e) {
      setOptimisticMsg(null);
      setSendError('发送出错: ' + e.message);
      setTimeout(() => setSendError(null), 4000);
    }
    setIsSending(false);
    setPendingSend(false);
  }, [curInput, isSending, selectedSession, onSendMessage]);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback((e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
    dragOverTabRef.current = true;
  }, []);

  const handleDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOverId(null);
    dragOverTabRef.current = false;
  }, []);

  const handleDrop = useCallback((e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    dragOverTabRef.current = false;
    if (!sourceId || sourceId === targetId) return;
    setTabOrder((prev) => {
      const currentIds = sessions.map(s => s.id);
      const validOrder = prev.filter(id => currentIds.includes(id));
      const newIds = currentIds.filter(id => !validOrder.includes(id));
      let fullOrder = [...validOrder, ...newIds];
      const srcIdx = fullOrder.indexOf(sourceId);
      const tgtIdx = fullOrder.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      fullOrder.splice(srcIdx, 1);
      const adjustedTgt = fullOrder.indexOf(targetId);
      fullOrder.splice(adjustedTgt, 0, sourceId);
      return fullOrder;
    });
  }, [dragId, sessions]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
    dragOverTabRef.current = false;
  }, []);

  const handleContainerDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleContainerDrop = useCallback((e) => {
    e.preventDefault();
    if (dragOverTabRef.current) return;
    const sourceId = dragId;
    setDragId(null);
    if (!sourceId) return;
    setTabOrder((prev) => {
      const currentIds = sessions.map(s => s.id);
      const newOrder = prev.filter(id => currentIds.includes(id) && id !== sourceId);
      newOrder.push(sourceId);
      return newOrder;
    });
  }, [dragId, sessions]);

  return (
    <div className="session-list" ref={containerRef} tabIndex={-1} onKeyDown={(e) => {
      if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
    }}>
      {/* Top bar — session header + search */}
      <div className="top-bar">
        {selectedSession && (
          <div className="conv-header">
            <div className="conv-header-info">
              <StatusIndicator status={selectedSession.status} />
              <span className="conv-name">{selectedSession.name}</span>
              <span className="conv-duration">{formatDuration(selectedSession.workingDuration)}</span>
            </div>
            <div className="conv-header-actions">
              {isActive && (
                <button className="btn-focus" onClick={() => onFocusCMD(selectedSession.id)} title="弹出 CMD 窗口">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                  </svg>
                </button>
              )}
              <button className="btn-qr" onClick={() => onShowQR(selectedSession)} title="微信扫码">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
            </div>
          </div>
        )}
        <div className="search-box">
          <svg className="search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <div className="new-session-wrap" style={{position:'relative'}} ref={(el) => {
            if (el && !el._menuBound) {
              el._menuBound = true;
              const btn = el.querySelector('.btn-settings');
              const menu = el.querySelector('.new-session-menu');
              document.addEventListener('click', (e) => { if (!el.contains(e.target)) menu.style.display = 'none'; });
              btn.addEventListener('click', (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; });
            }
          }}>
            <button className="btn-settings" title="新建 Claude 会话">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <div className="new-session-menu" style={{display:'none',position:'absolute',top:'100%',right:0,zIndex:100,marginTop:4,minWidth:200,background:'var(--bg-card)',border:'1px solid var(--border-subtle)',borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,0.5)',overflow:'hidden'}}>
              <button className="new-session-opt" onMouseDown={(e) => { e.preventDefault(); e.currentTarget.parentElement.style.display='none'; if (window.ccIsland) window.ccIsland.newClaudeSession().catch(() => {}); }}>普通模式</button>
              <button className="new-session-opt" onMouseDown={(e) => { e.preventDefault(); e.currentTarget.parentElement.style.display='none'; if (window.ccIsland) window.ccIsland.newClaudeSession('', {dangerouslySkipPermissions:true}).catch(() => {}); }}>跳过权限 <span style={{display:'block',fontSize:9,color:'var(--text-muted)',marginTop:1}}>-dangerously-skip-permissions</span></button>
            </div>
          </div>
          {onOpenSettings && (
            <button className="btn-settings" onClick={() => onOpenSettings()} title="设置">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Main area — left tabs + right messages */}
      <div className="main-area">
        <div className="sidebar-left" onClick={() => containerRef.current?.focus()}>
          {isExpanded && showTips && <span className="kb-tip tip-tab">Tab 切换对话</span>}
          <div className="tab-list" onDragOver={handleContainerDragOver} onDrop={handleContainerDrop}>
            {filteredSessions.map((s) => {
              const srcMatch = s.name.match(/^\[([^\]]+)\]\s*(.*)/);
              const source = srcMatch ? srcMatch[1] : '';
              const lastUserMsg = s.messages ? [...s.messages].reverse().find(m => m.role === 'user') : null;
              const firstLine = lastUserMsg ? lastUserMsg.content.replace(/<[^>]+>/g, '').substring(0, 30) : (srcMatch ? srcMatch[2] : s.name);
              const dirName = s.cwd ? s.cwd.split('\\').pop() || s.cwd.split('/').pop() || '' : '';
              return (
                <div
                  key={s.id}
                  className={`session-tab ${s.id === selectedId ? 'active' : ''} status-${s.status}${dragId === s.id ? ' dragging' : ''}${dragOverId === s.id ? ' drag-over' : ''}`}
                  onClick={() => setSelectedId(s.id)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, s.id)}
                  onDragOver={(e) => handleDragOver(e, s.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, s.id)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="tab-dot" style={{ backgroundColor: STATUS_COLORS[s.status] || STATUS_COLORS.disconnected }} />
                  <div className="tab-text">
                    <span className="tab-name">{firstLine}</span>
                    <span className="tab-sub">{dirName}</span>
                    <span className="tab-source">{source}</span>
                  </div>
                </div>
              );
            })}
            {filteredSessions.length === 0 && (
              <div className="tab-empty">无匹配会话</div>
            )}
          </div>
        </div>

        <div className="panel-right">
          {selectedSession ? (
            <>
              <div className="conv-messages" ref={msgListRef} onScroll={handleMsgScroll}>
                {recentMessages.length > 0 ? (
                  recentMessages.map((msg, i) => {
                    const isUser = msg.role === 'user';
                    const isLastUser = isUser && i === recentMessages.length - 1;
                    const showLoading = isLastUser && (isSending || pendingSend);
                    const tool = !isUser ? parseToolMsg(msg.content) : null;
                    if (tool) {
                      const collapsed = collapsedTools.has(i);
                      return (
                        <div key={i} className="msg-row msg-row-claude">
                          <div className={`bubble-claude tool-card ${collapsed ? 'tool-collapsed' : 'tool-expanded'}`}>
                            <div className="tool-header" onClick={() => setCollapsedTools(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}>
                              <span className={`tool-badge tool-${tool.meta.cls}`}>{tool.meta.icon} {tool.meta.label}</span>
                              {collapsed && tool.arg && <span className="tool-arg">{tool.arg.substring(0, 60)}</span>}
                              <span className={`tool-arrow ${collapsed ? '' : 'tool-arrow-open'}`}>▶</span>
                            </div>
                            {!collapsed && tool.fullContent && (
                              <div className="tool-body">
                                <span className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(tool.fullContent) }} />
                              </div>
                            )}
                            {!collapsed && <div className="msg-footer"><span className="msg-time">{formatTime(msg.timestamp)}</span></div>}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={i} className={`msg-row ${isUser ? 'msg-row-user' : 'msg-row-claude'}`}>
                        <div className={`msg-bubble ${isUser ? 'bubble-user' : 'bubble-claude'}`}>
                          <span className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                          <div className="msg-footer">
                            <span className="msg-time">{formatTime(msg.timestamp)}</span>
                            {showLoading && <span className="msg-loading" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  !isActive ? <div className="no-messages">暂无对话记录</div> : null
                )}
                {(selectedSession.status === 'thinking' || selectedSession.status === 'answering') && (
                  <div className="thinking-dots"><i>.</i><i>.</i><i>.</i></div>
                )}
              </div>
              {/* Queue mode panel */}
              {queueMode && (
                <div className={`queue-panel ${queueCollapsed ? 'collapsed' : ''}`}>
                  <div className="queue-panel-hdr">
                    <span onClick={() => setQueueCollapsed(!queueCollapsed)} style={{cursor:'pointer',flex:1}}>指令队列 ({cmdQueue.length})</span>
                    <div className="queue-panel-actions">
                      <button className={`btn-autoplay ${autoPlay ? 'on' : ''}`} onClick={(e) => {
                        e.stopPropagation();
                        const v = !autoPlay;
                        setAutoPlay(v);
                        if (window.ccIsland) window.ccIsland.setAutoPlay(selectedId, v);
                        if (!v) setCountdown(0);
                      }} title={autoPlay ? '暂停' : '自动'}>{autoPlay ? '⏸' : '▶'}</button>
                      <button className="queue-collapse-btn" onClick={(e) => { e.stopPropagation(); setQueueCollapsed(!queueCollapsed); }} title={queueCollapsed ? '展开' : '收起'}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: queueCollapsed ? 'rotate(-90deg)' : 'rotate(90deg)' }}><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                    </div>
                  </div>
                  {!queueCollapsed && (
                    <div className="queue-panel-list">
                      {cmdQueue.map((cmd, i) => (
                        <div key={i}
                          className={`queue-cmd ${queueDragIdx === i ? 'dragging' : ''} ${queueDragOverIdx === i ? 'drag-over' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            setQueueDragIdx(i);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(i));
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setQueueDragOverIdx(i);
                          }}
                          onDragLeave={() => setQueueDragOverIdx(-1)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = queueDragIdx;
                            const to = i;
                            setQueueDragIdx(-1);
                            setQueueDragOverIdx(-1);
                            if (from !== to && from >= 0 && to >= 0 && window.ccIsland) {
                              window.ccIsland.reorderQueue(selectedId, from, to);
                            }
                          }}
                          onDragEnd={() => { setQueueDragIdx(-1); setQueueDragOverIdx(-1); }}
                          onTouchStart={() => setQueueDragIdx(i)}
                          onTouchEnd={(e) => {
                            if (queueDragIdx >= 0 && queueDragIdx !== i && window.ccIsland) {
                              window.ccIsland.reorderQueue(selectedId, queueDragIdx, i);
                            }
                            setQueueDragIdx(-1);
                            setQueueDragOverIdx(-1);
                          }}
                        >
                          <span className={`queue-cmd-idx ${i === 0 && countdown > 0 ? 'countdown' : ''}`} title={i === 0 ? '下一条执行' : '第' + (i + 1) + '条'}>{i === 0 && countdown > 0 ? countdown + 's' : i === 0 ? '▶' : i + 1}</span>
                          <span className="queue-cmd-text" title={cmd}>{cmd}</span>
                          {i === 0 && (
                            <button className="queue-cmd-send" onClick={() => {
                              if (window.ccIsland) window.ccIsland.sendNextFromQueue(selectedId);
                            }} title="立即发送">▶</button>
                          )}
                          <button className="queue-cmd-del" onClick={() => window.ccIsland && window.ccIsland.removeFromQueue(selectedId, i)}>×</button>
                        </div>
                      ))}
                      {cmdQueue.length === 0 && <div className="queue-cmd-empty">队列为空</div>}
                    </div>
                  )}
                </div>
              )}
              {/* Countdown shown on first queue item + cancel via pause/mode switch */}
              <div className="conv-input">
                {isExpanded && showTips && <span className="kb-tip tip-enter">Enter 发送</span>}
                <input
                  ref={inputRef}
                  type="text"
                  className="msg-input"
                  placeholder={isActive ? '输入指令...' : '会话已结束'}
                  value={curInput}
                  onChange={(e) => setInputValues((prev) => ({ ...prev, [selectedSession.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (queueMode) {
                        if (!curInput.trim()) return;
                        if (window.ccIsland) window.ccIsland.addToQueue(selectedId, curInput.trim());
                        setInputValues((prev) => ({ ...prev, [selectedSession.id]: '' }));
                      } else {
                        handleSend();
                      }
                    }
                  }}
                  onFocus={() => onFocusChange && onFocusChange(true)}
                  onBlur={() => onFocusChange && onFocusChange(false)}
                  disabled={!isActive || isSending}
                />
                {isActive && (
                  <button className="btn-queue-mode" onClick={() => {
                    const next = !queueMode;
                    setQueueMode(next);
                    if (window.ccIsland) window.ccIsland.setQueueMode(selectedId, next);
                    setCountdown(0);
                    if (!next) { setAutoPlay(false); if (window.ccIsland) window.ccIsland.setAutoPlay(selectedId, false); }
                  }} title={queueMode ? '切换为正常模式' : '切换为队列模式'}>
                    {queueMode ? '📋' : '📋'}
                  </button>
                )}
                {isActive && queueMode ? (
                  <button className="btn-send" onClick={() => {
                    if (!curInput.trim()) return;
                    if (window.ccIsland) window.ccIsland.addToQueue(selectedId, curInput.trim());
                    setInputValues((prev) => ({ ...prev, [selectedSession.id]: '' }));
                  }} disabled={!curInput.trim() || isSending}>
                    +Q
                  </button>
                ) : (
                  <button className="btn-send" onClick={handleSend} disabled={!isActive || !curInput.trim() || isSending}>
                    发送
                  </button>
                )}
              </div>
              {sendError && <div className="send-error">{sendError}</div>}
            </>
          ) : (
            <div className="conv-empty">
              <div className="empty-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><path d="M8 12h8M12 8v8" />
                </svg>
              </div>
              <p>{sessions.length === 0 ? '暂无活跃的 Claude 会话' : '选择左侧会话查看详情'}</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .session-list {
          width: 100%; height: 100%; display: flex; flex-direction: column;
          border-radius: 0 0 var(--radius-lg) var(--radius-lg);
          overflow: hidden;
          background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.2) 100%);
        }

        /* ===== Top Bar ===== */
        .top-bar {
          flex-shrink: 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .search-box {
          display: flex; align-items: center; gap: 6px;
          margin: 6px 10px;
          padding: 5px 10px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
        }
        .search-icon { color: var(--text-muted); flex-shrink: 0; }
        .search-input {
          flex: 1; min-width: 0;
          background: none; border: none; outline: none;
          font-size: 11px; color: var(--text-primary);
        }
        .search-input::placeholder { color: var(--text-muted); }
        .btn-settings {
          background: none; border: none; color: var(--text-muted);
          cursor: pointer; padding: 2px; border-radius: 4px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; flex-shrink: 0;
        }
        .btn-settings:hover { color: var(--text-primary); background: var(--bg-glass); }

        .conv-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 12px;
          background: rgba(0,0,0,0.1);
        }
        .conv-header-info {
          display: flex; align-items: center; gap: 8px; min-width: 0;
        }
        .conv-name {
          font-size: 12px; font-weight: 600; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .conv-duration {
          font-size: 10px; color: var(--text-muted); white-space: nowrap;
        }
        .conv-header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

        .btn-focus, .btn-qr {
          background: none; border: none; color: var(--text-secondary);
          cursor: pointer; padding: 4px; border-radius: 5px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .btn-focus:hover { color: #f59e0b; background: rgba(245,158,11,0.1); }
        .btn-qr:hover { color: var(--accent); background: rgba(99,102,241,0.1); }

        /* ===== Main Area (left sidebar + right panel) ===== */
        .main-area {
          flex: 1; min-height: 0;
          display: flex; flex-direction: row;
        }

        /* ===== Left Sidebar ===== */
        .sidebar-left {
          width: 160px; flex-shrink: 0;
          display: flex; flex-direction: column;
          border-right: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.04);
          position: relative;
        }
        .tab-list {
          flex: 1; overflow-y: auto; padding: 4px 0;
        }
        .session-tab {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; cursor: pointer; transition: all 0.15s;
          border-left: 2px solid transparent;
        }
        .session-tab:hover { background: rgba(255,255,255,0.03); }
        .session-tab.dragging { opacity: 0.35; }
        .session-tab.drag-over { border-top: 2px solid var(--accent); }
        .session-tab.active {
          background: rgba(99,102,241,0.08);
          border-left-color: var(--accent);
        }
        .tab-dot {
          width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
          align-self: flex-start; margin-top: 6px;
        }
        .tab-text {
          display: flex; flex-direction: column; gap: 1px;
          min-width: 0; flex: 1;
        }
        .tab-name {
          font-size: 11px; color: var(--text-primary); font-weight: 500;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .session-tab.active .tab-name { color: var(--accent); font-weight: 600; }
        .tab-sub {
          font-size: 9px; color: var(--text-muted);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .tab-source {
          font-size: 8px; color: var(--text-muted); opacity: 0.7;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .tab-empty {
          text-align: center; padding: 16px 8px;
          font-size: 10px; color: var(--text-muted);
        }

        /* ===== Right Panel ===== */
        .panel-right {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column;
        }
        .conv-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 8px;
          color: var(--text-muted); font-size: 12px;
        }
        .conv-empty .empty-icon { opacity: 0.4; }

        .conv-messages {
          flex: 1; overflow-y: auto; padding: 8px 12px;
          display: flex; flex-direction: column; gap: 5px;
          user-select: text; cursor: text;
        }
        .no-messages { text-align: center; padding: 20px; color: var(--text-muted); font-size: 11px; }

        .msg-row { display: flex; align-items: flex-end; gap: 6px; margin-bottom: 8px; }
        .msg-row-user { justify-content: flex-end; }
        .msg-row-claude { justify-content: flex-start; }

        .msg-bubble {
          flex: 1; padding: 6px 10px; border-radius: 12px;
          font-size: 11px; line-height: 1.45;
        }
        .bubble-user {
          background: var(--accent); color: white;
          border-bottom-right-radius: 4px;
          overflow-x: auto;
        }
        .bubble-user .msg-time { color: rgba(255,255,255,0.6); }
        .bubble-claude {
          background: rgba(255,255,255,0.24);
          border-bottom-left-radius: 4px;
          overflow-x: auto;
        }
        /* Tool message cards */
        .tool-card { padding: 6px 10px; border-radius: 12px; border-bottom-left-radius: 4px; }
        .tool-card .tool-header { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
        .tool-card.tool-expanded .tool-header { margin-bottom: 6px; }
        .tool-badge {
          display: inline-flex; align-items: center; gap: 3px;
          padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; white-space: nowrap;
        }
        .tool-arg { font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
        .tool-arrow { font-size: 9px; color: var(--text-muted); margin-left: auto; transition: transform 0.2s ease; display: inline-block; }
        .tool-arrow-open { transform: rotate(90deg); }
        .tool-card.tool-collapsed .tool-body { display: none; }
        .tool-card.tool-expanded .tool-body { display: block; }
        .tool-badge.tool-thinking { background: rgba(255,255,255,0.06); color: var(--text-secondary); font-style: italic; font-size: 10px; }
        .tool-badge.tool-bash { background: rgba(34,197,94,0.2); color: #4ade80; }
        .tool-badge.tool-read { background: rgba(96,165,250,0.2); color: #93bbfd; }
        .tool-badge.tool-write, .tool-badge.tool-edit { background: rgba(251,191,36,0.2); color: #fcd34d; }
        .tool-badge.tool-grep, .tool-badge.tool-glob { background: rgba(167,139,250,0.2); color: #c4b5fd; }
        .tool-badge.tool-web { background: rgba(34,211,238,0.2); color: #67e8f9; }
        .tool-badge.tool-agent { background: rgba(244,114,182,0.2); color: #f9a8d4; }
        .tool-badge.tool-ask { background: rgba(251,146,60,0.25); color: #fdba74; }
        .tool-badge.tool-plan { background: rgba(99,102,241,0.2); color: #a5b4fc; }

        .msg-content { word-break: break-word; cursor: text; }
        .bubble-user .msg-content { color: white; }
        .bubble-user .msg-content strong { color: #f0f0f5; }
        .bubble-user .msg-content em { color: #d0d0e0; }
        .bubble-user .msg-content code { background: rgba(255,255,255,0.15); padding: 1px 4px; border-radius: 3px; font-family: 'Cascadia Code', monospace; font-size: 10px; }
        .bubble-user .msg-content a { color: #c7d2fe; }
        .bubble-claude .msg-content { color: #1a1a2e; }
        .bubble-claude .msg-content strong { color: #1a1a2e; font-weight: 700; }
        .bubble-claude .msg-content em { color: #5a5a72; }
        .bubble-claude .msg-content code { background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; font-family: 'Cascadia Code', monospace; font-size: 10px; }
        .bubble-claude .msg-content a { color: var(--accent); }
        .msg-content pre { background: #f4f4f8; padding: 5px 8px; border-radius: 5px; overflow-x: auto; margin: 3px 0; font-size: 10px; }
        .msg-content pre code { background: none; padding: 0; }
        .msg-content ul, .msg-content ol { margin: 2px 0; padding-left: 14px; }
        .msg-content li { margin: 1px 0; }
        .msg-content blockquote { border-left: 2px solid rgba(255,255,255,0.2); padding-left: 6px; margin: 3px 0; opacity: 0.8; }
        .msg-content h1, .msg-content h2, .msg-content h3 { font-size: 12px; font-weight: 700; margin: 3px 0 2px; }
        .msg-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.15); margin: 3px 0; }
        .msg-content table { border-collapse: collapse; font-size: 10px; }
        .msg-content th, .msg-content td { border: 1px solid rgba(255,255,255,0.15); padding: 1px 4px; }

        .msg-footer {
          display: flex; align-items: center; justify-content: flex-end; gap: 6px;
          margin-top: 2px;
        }
        .msg-time { font-size: 8px; }
        .msg-loading {
          width: 10px; height: 10px; flex-shrink: 0;
          border: 2px solid rgba(255,255,255,0.25);
          border-top-color: white; border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        .bubble-claude .msg-loading {
          border-color: rgba(99,102,241,0.2);
          border-top-color: var(--accent);
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .thinking-dots { padding: 4px 4px 4px 0; }
        .thinking-dots i {
          font-style: normal; font-size: 14px; font-weight: 700; color: var(--accent);
          animation: dot-blink 1.2s ease-in-out infinite;
        }
        .thinking-dots i:nth-child(1) { animation-delay: 0s; }
        .thinking-dots i:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dots i:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dot-blink {
          0%, 60%, 100% { opacity: 0.15; }
          30% { opacity: 1; }
        }

        .conv-input {
          display: flex; gap: 5px; padding: 8px 12px; flex-shrink: 0;
          border-top: 1px solid rgba(255,255,255,0.05);
          position: relative;
        }
        .msg-input {
          flex: 1; min-width: 0;
          background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle);
          border-radius: 6px; padding: 6px 8px; font-size: 11px;
          color: var(--text-primary); outline: none; transition: border-color 0.2s;
          user-select: text;
        }
        .msg-input:focus { border-color: var(--border-active); }
        .msg-input:disabled { opacity: 0.4; }
        .btn-send {
          background: var(--accent); border: none; border-radius: 6px;
          padding: 6px 12px; font-size: 11px; font-weight: 600;
          color: white; cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        .btn-send:hover:not(:disabled) { background: #5558e6; }
        .btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

        .kb-tip {
          position: absolute; z-index: 10; pointer-events: none;
          background: rgba(18,18,24,0.95); color: #f0f0f5;
          font-size: 10px; padding: 3px 8px; border-radius: 5px;
          border: 1px solid rgba(255,255,255,0.15);
          white-space: nowrap; opacity: 0; transition: opacity 0.15s;
        }
        .sidebar-left:hover .kb-tip { opacity: 1; }
        .tip-tab {
          left: 50%; bottom: 40px; transform: translateX(-50%);
        }
        .conv-input:hover .kb-tip { opacity: 1; }
        .tip-enter {
          right: 80px; top: -24px;
        }

        .send-error {
          margin: 4px 12px 8px; padding: 5px 8px;
          background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
          border-radius: 6px; font-size: 10px; color: #ef4444;
        }
        .queue-panel { margin: 0; border-top: 1px solid var(--border); background: var(--bg2); overflow: hidden; transition: max-height 0.25s ease, opacity 0.25s ease; max-height: 300px; opacity: 1; }
        .queue-panel.collapsed { max-height: 30px; }
        .queue-panel-hdr { display: flex; align-items: center; justify-content: space-between; padding: 3px 14px; font-size: 10px; color: var(--text-muted); user-select: none; }
        .queue-panel-hdr:hover { background: rgba(255,255,255,0.01); }
        .queue-panel-actions { display: flex; align-items: center; gap: 4px; }
        .btn-autoplay { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px; padding: 2px 3px; border-radius: 3px; opacity: 0.5; transform: scale(0.9); }
        .btn-autoplay:hover { opacity: 1; }
        .btn-autoplay.on { color: var(--success); opacity: 1; }
        .queue-collapse-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; opacity: 0.4; }
        .queue-collapse-btn:hover { opacity: 0.8; }
        .queue-panel-list { padding: 2px 12px 6px; display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
        .queue-cmd { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 4px; cursor: grab; transition: all 0.15s; }
        .queue-cmd:hover { background: rgba(255,255,255,0.03); }
        .queue-cmd.dragging { opacity: 0.3; }
        .queue-cmd.drag-over { background: rgba(99,102,241,0.08); }
        .queue-cmd-idx { font-size: 9px; color: var(--text-muted); flex-shrink: 0; width: 18px; text-align: center; }
        .queue-cmd-idx.countdown { color: var(--warning); font-weight: 600; }
        .queue-cmd-text { flex: 1; font-size: 10px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .queue-cmd-send { background: none; border: none; color: var(--success); cursor: pointer; font-size: 10px; padding: 2px; border-radius: 3px; opacity: 0.4; transition: all 0.15s; }
        .queue-cmd-send:hover { opacity: 1; }
        .queue-cmd-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 2px; border-radius: 3px; opacity: 0.3; transition: all 0.15s; }
        .queue-cmd-del:hover { opacity: 1; color: var(--danger); }
        .queue-cmd-empty { text-align: center; font-size: 10px; color: var(--text-muted); padding: 6px; }
        .btn-queue-mode { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 4px; border-radius: 4px; opacity: 0.5; transition: all 0.15s; }
        .btn-queue-mode:hover { opacity: 0.8; }
        .btn-queue-mode.active { color: var(--accent); opacity: 1; }
        .new-session-opt { display: block; width: 100%; padding: 8px 12px; border: none; background: none; color: var(--text-primary); font-size: 11px; text-align: left; cursor: pointer; min-height: 36px; display: flex; flex-direction: column; justify-content: center; }
        .new-session-opt:hover { background: rgba(255,255,255,0.04); }
        .new-session-opt + .new-session-opt { border-top: 1px solid var(--border-subtle); }
      `}</style>
    </div>
  );
}
