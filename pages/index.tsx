import { useState, useRef } from 'react';
import Editor, { EditorRef, ExecutionOutput } from '../components/Editor';
import OutputPanel from '../components/OutputPanel';

export default function Home() {
  const editorRef = useRef<EditorRef>(null);
  const [selectedFile, setSelectedFile] = useState('solution.js');
  const [code, setCode] = useState('// Write your code here\nconsole.log("Hello, World!");');
  const [language, setLanguage] = useState('javascript');
  const [output, setOutput] = useState<string[]>([]);
  const [problemId, setProblemId] = useState('problem-1');

  // Mock file list
  const files = [
    { name: 'solution.js', language: 'javascript' },
    { name: 'solution.py', language: 'python' },
    { name: 'solution.ts', language: 'typescript' },
  ];

  const handleFileSelect = (file: { name: string; language: string }) => {
    setSelectedFile(file.name);
    setLanguage(file.language);
    setCode(`// ${file.name}\n// Write your code here`);
    setOutput([]);
  };

  const handleQuickRun = () => {
    if (!editorRef.current) {
      setOutput(['Editor not ready']);
      return;
    }

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
    });
  };

  const handleSubmit = async () => {
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
      setOutput([
        `Status: ${response.status}`,
        `Response: ${JSON.stringify(data, null, 2)}`,
      ]);
    } catch (error) {
      setOutput([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Left Panel - File List */}
      <div style={{ width: '200px', borderRight: '1px solid #ddd', padding: '10px', backgroundColor: '#f5f5f5' }}>
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

      {/* Center Panel - Monaco Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px', borderBottom: '1px solid #ddd', backgroundColor: '#f5f5f5' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{selectedFile}</span>
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>({language})</span>
        </div>
        <Editor ref={editorRef} code={code} language={language} onChange={setCode} />
      </div>

      {/* Right Panel - Output */}
      <OutputPanel 
        output={output} 
        onQuickRun={handleQuickRun}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

