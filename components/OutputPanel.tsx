import React, { useState } from 'react';

interface SubmissionHistoryItem {
  id: string;
  status: string;
  timestamp: string;
  response?: any;
}

interface OutputPanelProps {
  output: string[];
  submissionResponse?: any;
  history?: SubmissionHistoryItem[];
  statusText?: string;
  onQuickRun: () => void;
  onSubmit: () => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
  onSelectHistory?: (id: string) => void;
  width?: number;
}

export default function OutputPanel({
  output,
  submissionResponse,
  history = [],
  statusText,
  onQuickRun,
  onSubmit,
  onToggleTheme,
  theme,
  onSelectHistory,
  width = 380,
}: OutputPanelProps) {
  const [activeTab, setActiveTab] = useState<'console' | 'response' | 'history'>('console');
  const isDark = theme === 'dark';
  const bgPrimary = isDark ? '#1e1e1e' : '#ffffff';
  const bgSecondary = isDark ? '#252526' : '#f3f3f3';
  const bgTertiary = isDark ? '#2d2d30' : '#e8e8e8';
  const textPrimary = isDark ? '#cccccc' : '#333333';
  const textSecondary = isDark ? '#858585' : '#666666';
  const borderColor = isDark ? '#3e3e42' : '#d4d4d4';
  const accentColor = '#007acc';

  const renderConsole = () => (
    <div style={{ 
      fontFamily: '"Fira Code", "Consolas", "Monaco", monospace', 
      fontSize: '13px', 
      whiteSpace: 'pre-wrap',
      lineHeight: '1.6',
      color: textPrimary
    }}>
      {output.length === 0 ? (
        <div style={{ 
          color: textSecondary,
          padding: '20px',
          textAlign: 'center',
          fontSize: '12px'
        }}>
          No output yet. Click "Run" to execute JavaScript/TypeScript code locally.
        </div>
      ) : (
        output.map((line, index) => {
          const isError = line.toLowerCase().includes('error') || line.includes('❌');
          const isWarning = line.toLowerCase().includes('warn') || line.includes('⚠️');
          const isSuccess = line.includes('✓') || line.toLowerCase().includes('success');
          
          return (
            <div
              key={index}
              style={{
                padding: '4px 0',
                color: isError ? '#f48771' : isWarning ? '#dcdcaa' : isSuccess ? '#4ec9b0' : textPrimary,
                fontFamily: 'inherit',
              }}
            >
              {line}
            </div>
          );
        })
      )}
    </div>
  );

  const renderResponse = () => (
    <div style={{ 
      fontFamily: '"Fira Code", "Consolas", "Monaco", monospace', 
      fontSize: '12px', 
      whiteSpace: 'pre-wrap',
      color: textPrimary,
      lineHeight: '1.6'
    }}>
      {submissionResponse ? (
        <div style={{
          background: bgSecondary,
          padding: '12px',
          borderRadius: '6px',
          border: `1px solid ${borderColor}`
        }}>
          <pre style={{ margin: 0, color: textPrimary }}>
            {JSON.stringify(submissionResponse, null, 2)}
          </pre>
        </div>
      ) : (
        <div style={{ 
          color: textSecondary,
          padding: '20px',
          textAlign: 'center',
          fontSize: '12px'
        }}>
          No submission response yet. Submit your code to see the result.
        </div>
      )}
    </div>
  );

  const renderHistory = () => (
    <div style={{ fontSize: '13px' }}>
      {history.length === 0 ? (
        <div style={{ 
          color: textSecondary,
          padding: '20px',
          textAlign: 'center',
          fontSize: '12px'
        }}>
          No submission history yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {history.map((item) => {
            const statusColor = item.status === 'queued' ? '#3b82f6' : 
                               item.status === 'failed' ? '#ef4444' : 
                               item.status === 'completed' ? '#10b981' : textSecondary;
            return (
              <div
                key={item.id}
                style={{
                  padding: '12px',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  background: bgSecondary,
                  color: textPrimary,
                  cursor: onSelectHistory ? 'pointer' : 'default',
                  transition: 'all 0.2s',
                }}
                onClick={() => onSelectHistory?.(item.id)}
                onMouseEnter={(e) => {
                  if (onSelectHistory) {
                    e.currentTarget.style.background = bgTertiary;
                    e.currentTarget.style.borderColor = accentColor;
                  }
                }}
                onMouseLeave={(e) => {
                  if (onSelectHistory) {
                    e.currentTarget.style.background = bgSecondary;
                    e.currentTarget.style.borderColor = borderColor;
                  }
                }}
              >
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px'
                }}>
                  <div style={{ 
                    fontWeight: '600',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    color: textPrimary
                  }}>
                    {item.id.slice(0, 8)}...
                  </div>
                  <div style={{
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: statusColor + '20',
                    color: statusColor,
                    fontSize: '10px',
                    fontWeight: '600',
                    textTransform: 'uppercase'
                  }}>
                    {item.status}
                  </div>
                </div>
                <div style={{ 
                  fontSize: '11px', 
                  color: textSecondary,
                  fontFamily: 'monospace'
                }}>
                  {new Date(item.timestamp).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ 
      width: `${width}px`, 
      borderLeft: `1px solid ${borderColor}`, 
      display: 'flex', 
      flexDirection: 'column',
      backgroundColor: bgPrimary,
      color: textPrimary
    }}>
      {/* Toolbar */}
      <div style={{ 
        padding: '12px', 
        borderBottom: `1px solid ${borderColor}`, 
        backgroundColor: bgSecondary,
        display: 'flex', 
        gap: '8px',
        boxShadow: isDark ? '0 2px 4px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        <button
          onClick={onQuickRun}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            transition: 'all 0.2s',
            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 8px rgba(16, 185, 129, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
          }}
        >
          ▶ Run
        </button>
        <button
          onClick={onSubmit}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            transition: 'all 0.2s',
            boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 8px rgba(59, 130, 246, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.3)';
          }}
        >
          ✓ Submit
        </button>
        <button
          onClick={onToggleTheme}
          style={{
            width: '44px',
            padding: '10px',
            background: bgTertiary,
            color: textPrimary,
            border: `1px solid ${borderColor}`,
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '16px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark ? '#3e3e42' : '#d4d4d4';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = bgTertiary;
          }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      {/* Status bar */}
      {statusText && (
        <div style={{ 
          padding: '10px 14px', 
          borderBottom: `1px solid ${borderColor}`, 
          background: isDark ? '#2d2d30' : '#fffbe6',
          color: isDark ? '#dcdcaa' : '#8c6d1f',
          fontSize: '12px',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>●</span>
          <span>{statusText}</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '4px', 
        padding: '8px',
        borderBottom: `1px solid ${borderColor}`, 
        background: bgSecondary
      }}>
        {(['console', 'response', 'history'] as const).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '8px 12px',
                cursor: 'pointer',
                border: 'none',
                background: isActive ? bgPrimary : 'transparent',
                color: isActive ? accentColor : textSecondary,
                fontSize: '12px',
                fontWeight: isActive ? '600' : '500',
                borderRadius: '4px',
                transition: 'all 0.2s',
                borderBottom: isActive ? `2px solid ${accentColor}` : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = bgTertiary;
                  e.currentTarget.style.color = textPrimary;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = textSecondary;
                }
              }}
            >
              {tab === 'console' ? 'Console' : tab === 'response' ? 'Submission' : 'History'}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ 
        flex: 1, 
        padding: '16px', 
        backgroundColor: bgPrimary,
        color: textPrimary,
        overflow: 'auto'
      }}>
        {activeTab === 'console' && renderConsole()}
        {activeTab === 'response' && renderResponse()}
        {activeTab === 'history' && renderHistory()}
      </div>
    </div>
  );
}
