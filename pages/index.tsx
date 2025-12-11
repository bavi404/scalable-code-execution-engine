import { useState, useRef, useMemo } from 'react';
import Editor, { EditorRef, ExecutionOutput } from '../components/Editor';
import OutputPanel from '../components/OutputPanel';

// Language icons/colors
const languageInfo: Record<string, { icon: string; color: string }> = {
  javascript: { icon: '🟨', color: '#f7df1e' },
  typescript: { icon: '🔵', color: '#3178c6' },
  python: { icon: '🐍', color: '#3776ab' },
  java: { icon: '☕', color: '#ed8b00' },
  cpp: { icon: '⚙️', color: '#00599c' },
  c: { icon: '⚙️', color: '#a8b9cc' },
  go: { icon: '🐹', color: '#00add8' },
  rust: { icon: '🦀', color: '#000000' },
  ruby: { icon: '💎', color: '#cc342d' },
  php: { icon: '🐘', color: '#777bb4' },
};

export default function Home() {
  const editorRef = useRef<EditorRef>(null);
  const [selectedFile, setSelectedFile] = useState('solution.js');
  const [code, setCode] = useState('// Write your code here\nconsole.log("Hello, World!");');
  const [language, setLanguage] = useState('javascript');
  const [output, setOutput] = useState<string[]>([]);
  const [problemId, setProblemId] = useState('problem-1');
  const [submissionResponse, setSubmissionResponse] = useState<any>(null);
  const [statusText, setStatusText] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<
    Array<{ id: string; status: string; timestamp: string; response?: any }>
  >([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [outputWidth, setOutputWidth] = useState(380);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Supported languages with templates
  const languageTemplates: Record<string, string> = {
    javascript: '// Write your code here\nconsole.log("Hello, World!");',
    typescript: '// Write your code here\nconsole.log("Hello, World!");',
    python: '# Write your code here\nprint("Hello, World!")',
    java: 'public class Solution {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}',
    c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}',
    go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}',
    rust: 'fn main() {\n    println!("Hello, World!");\n}',
    ruby: '# Write your code here\nputs "Hello, World!"',
    php: '<?php\n// Write your code here\necho "Hello, World!\\n";\n?>',
  };

  const files = [
    { name: 'solution.js', language: 'javascript' },
    { name: 'solution.py', language: 'python' },
    { name: 'solution.ts', language: 'typescript' },
    { name: 'Solution.java', language: 'java' },
    { name: 'solution.cpp', language: 'cpp' },
    { name: 'solution.c', language: 'c' },
    { name: 'solution.go', language: 'go' },
    { name: 'solution.rs', language: 'rust' },
    { name: 'solution.rb', language: 'ruby' },
    { name: 'solution.php', language: 'php' },
  ];

  const handleFileSelect = (file: { name: string; language: string }) => {
    setSelectedFile(file.name);
    setLanguage(file.language);
    setCode(languageTemplates[file.language] || `// ${file.name}\n// Write your code here`);
    setOutput([]);
  };

  const handleQuickRun = () => {
    if (!editorRef.current) {
      setOutput(['Editor not ready']);
      return;
    }

    setStatusText('Running quick execute...');
    setOutput(['Running...']);
    
    editorRef.current.executeCode((result: ExecutionOutput) => {
      const formattedOutput: string[] = [];

      // Handle different result types
      if (result.type === 'timeout') {
        formattedOutput.push(`⏱️ TIMEOUT: ${result.message}`);
      } else if (result.type === 'error') {
        formattedOutput.push(`❌ ERROR: ${result.message || 'Execution failed'}`);
      } else if (result.type === 'worker_error') {
        formattedOutput.push(`⚠️ WORKER ERROR: ${result.message}`);
      } else if (result.type === 'not_supported') {
        formattedOutput.push(`ℹ️ ${result.message}`);
      } else if (result.type === 'success') {
        formattedOutput.push('✓ Execution completed successfully');
      }

      // Add console logs
      if (result.logs && result.logs.length > 0) {
        formattedOutput.push('');
        formattedOutput.push('--- Console Output ---');
        result.logs.forEach(log => {
          const prefix = log.type === 'error' ? '❌' : 
                        log.type === 'warn' ? '⚠️' : 
                        log.type === 'info' ? 'ℹ️' : '>';
          const message = log.args.join(' ');
          formattedOutput.push(`${prefix} ${message}`);
        });
      }

      setOutput(formattedOutput.length > 0 ? formattedOutput : ['No output']);
      setStatusText(result.type === 'success' ? 'Execution finished' : 'Execution error/timeout');
    });
  };

  const handleSubmit = async () => {
    setStatusText('Submitting...');
    setOutput(['Submitting...']);
    
    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          language,
          problemId,
        }),
      });

      const data = await response.json();
      setSubmissionResponse(data);
      setHistory((prev) => [
        {
          id: data.submissionId || `pending-${Date.now()}`,
          status: response.ok ? 'queued' : 'failed',
          timestamp: new Date().toISOString(),
          response: data,
        },
        ...prev,
      ].slice(0, 10));
      setOutput([
        `Status: ${response.status}`,
        `Response: ${JSON.stringify(data, null, 2)}`,
      ]);
      setStatusText(response.ok ? 'Submission queued' : 'Submission failed');
      setToast({
        message: response.ok ? '✓ Submission queued successfully!' : '✗ Submission failed',
        type: response.ok ? 'success' : 'error',
      });
    } catch (error) {
      setOutput([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setStatusText('Submission failed');
      setToast({ message: '✗ Submission failed', type: 'error' });
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const onSelectHistory = (itemId: string) => {
    const hit = history.find((h) => h.id === itemId);
    if (hit?.response) {
      setSubmissionResponse(hit.response);
      setStatusText(`Selected submission ${itemId}`);
      setToast({ message: `Loaded submission ${itemId}`, type: 'info' });
    }
  };

  const startResize = (which: 'sidebar' | 'output', clientX: number) => {
    const startX = clientX;
    const startSidebar = sidebarWidth;
    const startOutput = outputWidth;
    const onMove = (e: MouseEvent) => {
      if (which === 'sidebar') {
        const next = Math.min(360, Math.max(180, startSidebar + (e.clientX - startX)));
        setSidebarWidth(next);
      } else {
        const delta = startX - e.clientX;
        const next = Math.min(500, Math.max(300, startOutput + delta));
        setOutputWidth(next);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const isDark = theme === 'dark';
  const bgPrimary = isDark ? '#1e1e1e' : '#ffffff';
  const bgSecondary = isDark ? '#252526' : '#f3f3f3';
  const bgTertiary = isDark ? '#2d2d30' : '#e8e8e8';
  const textPrimary = isDark ? '#cccccc' : '#333333';
  const textSecondary = isDark ? '#858585' : '#666666';
  const borderColor = isDark ? '#3e3e42' : '#d4d4d4';
  const accentColor = '#007acc';
  const langInfo = languageInfo[language] || { icon: '📄', color: '#858585' };

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      background: isDark ? '#1e1e1e' : '#fafafa',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Left Panel - File List */}
      <div style={{ 
        width: `${sidebarWidth}px`, 
        borderRight: `1px solid ${borderColor}`, 
        backgroundColor: bgSecondary,
        color: textPrimary,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '16px', borderBottom: `1px solid ${borderColor}` }}>
          <h2 style={{ 
            margin: '0 0 16px 0', 
            fontSize: '16px', 
            fontWeight: '600',
            color: textPrimary
          }}>
            Code Execution Engine
          </h2>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '11px', 
              marginBottom: '6px',
              color: textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: '600'
            }}>
              Problem ID
            </label>
            <input
              type="text"
              value={problemId}
              onChange={(e) => setProblemId(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '8px 10px', 
                fontSize: '13px',
                border: `1px solid ${borderColor}`,
                borderRadius: '4px',
                background: bgPrimary,
                color: textPrimary,
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = accentColor}
              onBlur={(e) => e.target.style.borderColor = borderColor}
            />
          </div>
        </div>
        
        <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
          <div style={{ 
            fontSize: '11px',
            color: textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: '600',
            marginBottom: '8px',
            padding: '0 8px'
          }}>
            Languages
          </div>
          {files.map((file) => {
            const isSelected = selectedFile === file.name;
            const fileLangInfo = languageInfo[file.language] || { icon: '📄', color: textSecondary };
            return (
              <div
                key={file.name}
                onClick={() => handleFileSelect(file)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? accentColor : 'transparent',
                  color: isSelected ? '#ffffff' : textPrimary,
                  borderRadius: '6px',
                  marginBottom: '4px',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  transition: 'all 0.2s',
                  border: isSelected ? 'none' : `1px solid transparent`,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = bgTertiary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <span style={{ fontSize: '16px' }}>{fileLangInfo.icon}</span>
                <span style={{ flex: 1 }}>{file.name}</span>
                <span style={{ 
                  fontSize: '10px',
                  opacity: 0.7,
                  textTransform: 'uppercase'
                }}>
                  {file.language}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      
      <div
        style={{ 
          width: '4px', 
          cursor: 'col-resize', 
          background: 'transparent',
          transition: 'background 0.2s'
        }}
        onMouseDown={(e) => startResize('sidebar', e.clientX)}
        onMouseEnter={(e) => e.currentTarget.style.background = isDark ? '#3e3e42' : '#d4d4d4'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      />

      {/* Center Panel - Monaco Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ 
          padding: '12px 16px', 
          borderBottom: `1px solid ${borderColor}`, 
          backgroundColor: bgSecondary,
          color: textPrimary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: isDark ? '0 2px 4px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '18px' }}>{langInfo.icon}</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{selectedFile}</div>
              <div style={{ fontSize: '11px', color: textSecondary, marginTop: '2px' }}>
                {language.toUpperCase()}
              </div>
            </div>
          </div>
          <div style={{ 
            fontSize: '12px', 
            color: textSecondary,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {statusText && (
              <span style={{
                padding: '4px 10px',
                borderRadius: '12px',
                background: isDark ? '#2d2d30' : '#e8e8e8',
                fontSize: '11px'
              }}>
                {statusText}
              </span>
            )}
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <Editor ref={editorRef} code={code} language={language} onChange={setCode} theme={isDark ? 'vs-dark' : 'vs-light'} />
        </div>
      </div>

      <div
        style={{ 
          width: '4px', 
          cursor: 'col-resize', 
          background: 'transparent',
          transition: 'background 0.2s'
        }}
        onMouseDown={(e) => startResize('output', e.clientX)}
        onMouseEnter={(e) => e.currentTarget.style.background = isDark ? '#3e3e42' : '#d4d4d4'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      />

      {/* Right Panel - Output */}
      <OutputPanel 
        output={output} 
        submissionResponse={submissionResponse}
        history={history}
        statusText={statusText}
        onToggleTheme={toggleTheme}
        theme={theme}
        onSelectHistory={onSelectHistory}
        width={outputWidth}
        onQuickRun={handleQuickRun}
        onSubmit={handleSubmit}
      />

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            padding: '14px 18px',
            background: toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6',
            color: '#ffffff',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            fontSize: '14px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            zIndex: 10000,
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            ×
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
