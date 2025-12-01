import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import MonacoEditor from '@monaco-editor/react';

interface EditorProps {
  code: string;
  language: string;
  onChange: (value: string) => void;
}

export interface EditorRef {
  executeCode: (onOutput: (output: ExecutionOutput) => void) => void;
  terminateWorker: () => void;
}

export interface ExecutionOutput {
  type: 'success' | 'error' | 'timeout' | 'worker_error' | 'not_supported';
  message?: string;
  logs: LogEntry[];
  executionTime?: number;
}

export interface LogEntry {
  type: 'log' | 'error' | 'warn' | 'info';
  args: string[];
}

const WORKER_TIMEOUT = 2500; // Main thread timeout (slightly longer than worker's internal timeout)

const Editor = forwardRef<EditorRef, EditorProps>(({ code, language, onChange }, ref) => {
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const executionIdRef = useRef(0);
  const currentCallbackRef = useRef<((output: ExecutionOutput) => void) | null>(null);

  // Create a new worker instance
  const createWorker = () => {
    terminateWorker();
    
    try {
      workerRef.current = new Worker('/worker.js');
      
      workerRef.current.onmessage = (e) => {
        const { type, logs, message, executionId } = e.data;
        
        // Clear timeout since we got a response
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        if (currentCallbackRef.current) {
          currentCallbackRef.current({
            type: type as 'success' | 'error' | 'timeout' | 'worker_error',
            message,
            logs: logs || [],
          });
          currentCallbackRef.current = null;
        }
      };

      workerRef.current.onerror = (error) => {
        console.error('Worker error:', error);
        if (currentCallbackRef.current) {
          currentCallbackRef.current({
            type: 'worker_error',
            message: error.message || 'Worker error occurred',
            logs: [],
          });
          currentCallbackRef.current = null;
        }
        terminateWorker();
      };
    } catch (error) {
      console.error('Failed to create worker:', error);
    }
  };

  // Terminate the current worker
  const terminateWorker = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  };

  // Execute code in the worker
  const executeCode = (onOutput: (output: ExecutionOutput) => void) => {
    // Only support JavaScript/TypeScript for now
    if (language !== 'javascript' && language !== 'typescript') {
      onOutput({
        type: 'not_supported',
        message: `Quick run only supports JavaScript/TypeScript. Current language: ${language}`,
        logs: [],
      });
      return;
    }

    // Create worker if it doesn't exist
    if (!workerRef.current) {
      createWorker();
    }

    if (!workerRef.current) {
      onOutput({
        type: 'worker_error',
        message: 'Failed to initialize worker',
        logs: [],
      });
      return;
    }

    // Store callback
    currentCallbackRef.current = onOutput;
    
    // Increment execution ID
    const executionId = ++executionIdRef.current;

    // Set main thread timeout as a safety net
    timeoutRef.current = setTimeout(() => {
      if (currentCallbackRef.current) {
        currentCallbackRef.current({
          type: 'timeout',
          message: `Execution timeout - worker terminated (${WORKER_TIMEOUT}ms)`,
          logs: [],
        });
        currentCallbackRef.current = null;
      }
      terminateWorker();
      createWorker(); // Recreate for next execution
    }, WORKER_TIMEOUT);

    // Send code to worker
    try {
      workerRef.current.postMessage({
        code,
        executionId,
      });
    } catch (error) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      
      onOutput({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to send code to worker',
        logs: [],
      });
      currentCallbackRef.current = null;
    }
  };

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    executeCode,
    terminateWorker,
  }));

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      terminateWorker();
    };
  }, []);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={code}
      onChange={handleEditorChange}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
      }}
    />
  );
});

Editor.displayName = 'Editor';

export default Editor;

