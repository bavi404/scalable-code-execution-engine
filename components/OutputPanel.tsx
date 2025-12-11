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

const tabStyles = {
  base: {
    padding: '8px 10px',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    fontSize: '13px',
    background: 'transparent',
  },
  active: {
    borderBottomColor: '#007acc',
    color: '#007acc',
    fontWeight: 'bold',
  },
};

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
  width = 340,
}: OutputPanelProps) {
  const [activeTab, setActiveTab] = useState<'console' | 'response' | 'history'>('console');

  const renderConsole = () => (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
      {output.length === 0 ? (
        <div style={{ color: '#888' }}>No output yet. Click "Run (Quick)" to execute JavaScript code.</div>
      ) : (
        output.map((line, index) => (
          <div
            key={index}
            style={{
              marginBottom: '5px',
              color:
                line.includes('[error]') || line.toLowerCase().includes('error') ? '#f48771' :
                line.toLowerCase().includes('warn') ? '#dcdcaa' : '#d4d4d4',
            }}
          >
            {line}
          </div>
        ))
      )}
    </div>
  );

  const renderResponse = () => (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
      {submissionResponse ? (
        JSON.stringify(submissionResponse, null, 2)
      ) : (
        <div style={{ color: '#888' }}>No submission yet.</div>
      )}
    </div>
  );

  const renderHistory = () => (
    <div style={{ fontSize: '12px' }}>
      {history.length === 0 ? (
        <div style={{ color: '#888' }}>No submissions yet.</div>
      ) : (
        history.map((item) => (
          <div
            key={item.id}
            style={{
              padding: '8px',
              border: '1px solid #333',
              borderRadius: '4px',
              marginBottom: '8px',
              background: '#111',
              color: '#eaeaea',
              cursor: onSelectHistory ? 'pointer' : 'default',
            }}
            onClick={() => onSelectHistory?.(item.id)}
          >
            <div style={{ fontWeight: 'bold' }}>{item.id}</div>
            <div>Status: {item.status}</div>
            <div style={{ color: '#999' }}>{item.timestamp}</div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={{ width: `${width}px`, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ padding: '12px', borderBottom: '1px solid #ddd', backgroundColor: '#f5f5f5', display: 'flex', gap: '8px' }}>
        <button
          onClick={onQuickRun}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 'bold',
          }}
        >
          ▶ Run
        </button>
        <button
          onClick={onSubmit}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#007acc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 'bold',
          }}
        >
          ✓ Submit
        </button>
        <button
          onClick={onToggleTheme}
          style={{
            width: '44px',
            padding: '10px',
            backgroundColor: '#444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      {/* Status bar */}
      {statusText && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ddd', background: '#fffbe6', color: '#8c6d1f', fontSize: '12px' }}>
          {statusText}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', padding: '10px', borderBottom: '1px solid #333', background: '#1e1e1e', color: '#d4d4d4' }}>
        {(['console', 'response', 'history'] as const).map((tab) => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...tabStyles.base,
              ...(activeTab === tab ? tabStyles.active : {}),
            }}
          >
            {tab === 'console' ? 'Console' : tab === 'response' ? 'Submission' : 'History'}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '12px', backgroundColor: '#1e1e1e', color: '#d4d4d4', overflow: 'auto' }}>
        {activeTab === 'console' && renderConsole()}
        {activeTab === 'response' && renderResponse()}
        {activeTab === 'history' && renderHistory()}
      </div>
    </div>
  );
}

