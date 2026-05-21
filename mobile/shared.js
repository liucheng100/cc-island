// Shared utilities for CC Island web clients
// Keep in sync with src/components/SessionList.jsx

var STATUS_MAP = {
  working: '工作中', thinking: '思考中', answering: '回答中',
  completed: '已完成', error: '错误', disconnected: '已断开'
};

var STATUS_COLORS = {
  working: '#6366f1', thinking: '#f59e0b', answering: '#3b82f6',
  completed: '#22c55e', error: '#ef4444', disconnected: '#6b6b80'
};

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
}

function formatDuration(s) {
  if (!s || s < 0) return '';
  var m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return h + 'h' + (m % 60) + 'm';
  if (m > 0) return m + 'm';
  return s + 's';
}

// Uses marked.js (GFM), loaded via <script src="/lib/marked/marked.umd.js">
function renderContent(text) {
  if (!text) return '';
  try {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      var html = marked.parse(text);
      // Strip outer <p> for single-line content to match desktop behavior
      return html.replace(/^<p>|<\/p>\n?$/g, '');
    }
  } catch (e) {}
  // Fallback — basic regex rendering
  var html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return html;
}
