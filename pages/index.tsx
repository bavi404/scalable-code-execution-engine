import { useState, useRef, useMemo } from 'react';
import Editor, { EditorRef, ExecutionOutput } from '../components/Editor';
import OutputPanel from '../components/OutputPanel';

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
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [outputWidth, setOutputWidth] = useState(360);
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
        formattedOutput.push(''); // Empty line
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
        message: response.ok ? 'Submission queued' : 'Submission failed',
        type: response.ok ? 'success' : 'error',
      });
    } catch (error) {
      setOutput([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setStatusText('Submission failed');
      setToast({ message: 'Submission failed', type: 'error' });
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
        const next = Math.min(360, Math.max(160, startSidebar + (e.clientX - startX)));
        setSidebarWidth(next);
      } else {
        const delta = startX - e.clientX;
        const next = Math.min(420, Math.max(280, startOutput + delta));
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

  const headerBg = theme === 'dark' ? '#1e1e1e' : '#f5f5f5';
  const headerColor = theme === 'dark' ? '#fff' : '#333';

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', background: theme === 'dark' ? '#111' : '#fafafa', position: 'relative' }}>
      {/* Left Panel - File List */}
      <div style={{ width: `${sidebarWidth}px`, borderRight: '1px solid #ddd', padding: '10px', backgroundColor: theme === 'dark' ? '#181818' : '#f5f5f5', color: headerColor, boxSizing: 'border-box' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '14px' }}>Files</h3>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>Problem ID:</label>
          <input
            type="text"
            value={problemId}
            onChange={(e) => setProblemId(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '5px', 
              fontSize: '12px',
              border: '1px solid #ddd',
              borderRadius: '3px'
            }}
          />
        </div>
        {files.map((file) => (
          <div
            key={file.name}
            onClick={() => handleFileSelect(file)}
            style={{
              padding: '8px',
              cursor: 'pointer',
              backgroundColor: selectedFile === file.name ? '#007acc' : 'transparent',
              color: selectedFile === file.name ? 'white' : 'black',
              borderRadius: '3px',
              marginBottom: '5px',
              fontSize: '13px',
            }}
          >
            {file.name}
          </div>
        ))}
      </div>
      <div
        style={{ width: '6px', cursor: 'col-resize', background: 'transparent' }}
        onMouseDown={(e) => startResize('sidebar', e.clientX)}
      />

      {/* Center Panel - Monaco Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px', borderBottom: '1px solid #ddd', backgroundColor: headerBg, color: headerColor, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{selectedFile}</span>
            <span style={{ marginLeft: '10px', fontSize: '12px', color: headerColor === '#fff' ? '#ccc' : '#666' }}>({language})</span>
          </div>
          <div style={{ fontSize: '12px', color: headerColor === '#fff' ? '#ccc' : '#666' }}>
            {statusText || 'Idle'}
          </div>
        </div>
        <Editor ref={editorRef} code={code} language={language} onChange={setCode} theme={theme === 'dark' ? 'vs-dark' : 'vs-light'} />
      </div>

      <div
        style={{ width: '6px', cursor: 'col-resize', background: 'transparent' }}
        onMouseDown={(e) => startResize('output', e.clientX)}
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
            bottom: '20px',
            right: '20px',
            padding: '12px 14px',
            background: toast.type === 'success' ? '#28a745' : toast.type === 'error' ? '#c0392b' : '#444',
            color: '#fff',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            fontSize: '13px',
          }}
        >
          {toast.message}
          <button
            onClick={() => setToast(null)}
            style={{
              marginLeft: '10px',
              background: 'transparent',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

