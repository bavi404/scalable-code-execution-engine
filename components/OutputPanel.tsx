import React from 'react';

interface OutputPanelProps {
  output: string[];
  onQuickRun: () => void;
  onSubmit: () => void;
}

export default function OutputPanel({ output, onQuickRun, onSubmit }: OutputPanelProps) {
  return (
    <div style={{ width: '300px', borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
      {/* Action Buttons */}
      <div style={{ padding: '15px', borderBottom: '1px solid #ddd', backgroundColor: '#f5f5f5' }}>
        <button
          onClick={onQuickRun}
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: '10px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          ▶ Run (Quick)
        </button>
        <button
          onClick={onSubmit}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#007acc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          ✓ Submit
        </button>
      </div>

      {/* Output Display */}
      <div style={{ flex: 1, padding: '15px', backgroundColor: '#1e1e1e', color: '#d4d4d4', overflow: 'auto' }}>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#fff' }}>Console Output</h4>
        <div style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          {output.length === 0 ? (
            <div style={{ color: '#888' }}>No output yet. Click "Run (Quick)" to execute JavaScript code.</div>
          ) : (
            output.map((line, index) => (
              <div 
                key={index} 
                style={{ 
                  marginBottom: '5px',
                  color: line.includes('[error]') ? '#f48771' : 
                         line.includes('[warn]') ? '#dcdcaa' : '#d4d4d4'
                }}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

