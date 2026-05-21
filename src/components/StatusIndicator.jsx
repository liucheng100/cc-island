import React from 'react';

const STATUS_CONFIG = {
  working: { color: '#6366f1', label: '等待中', icon: '●' },
  thinking: { color: '#f59e0b', label: '思考中', icon: '◉' },
  answering: { color: '#3b82f6', label: '回答中', icon: '▶' },
  completed: { color: '#22c55e', label: '已完成', icon: '✓' },
  error: { color: '#ef4444', label: '错误', icon: '✗' },
  disconnected: { color: '#6b6b80', label: '已断开', icon: '○' },
};

export default function StatusIndicator({ status, size = 'sm' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;
  const dotSize = size === 'lg' ? 10 : 7;
  const fontSize = size === 'lg' ? 12 : 10;

  return (
    <div className={`status-indicator status-${status} size-${size}`}>
      <span
        className="status-dot"
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: config.color,
          boxShadow: `0 0 ${dotSize + 2}px ${config.color}60`,
        }}
      />
      <span className="status-label" style={{ fontSize, color: config.color }}>
        {config.label}
      </span>
      <style>{`
        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-weight: 500;
        }
        .status-dot {
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-working .status-dot {
          animation: pulse-glow 1.5s ease-in-out infinite;
        }
        .status-thinking .status-dot {
          animation: pulse-glow 1s ease-in-out infinite;
        }
        .status-label {
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
