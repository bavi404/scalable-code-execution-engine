# Web Worker Sandbox Implementation

This document explains the Web Worker based sandbox for safe JavaScript code execution.

## Architecture Overview

The implementation consists of three main components:

1. **`public/worker.js`** - Dedicated Web Worker for code execution
2. **`components/Editor.tsx`** - React component with worker integration
3. **`pages/index.tsx`** - Main page that uses the Editor

## File Structure

```
├── public/
│   └── worker.js          # Dedicated Web Worker script
├── components/
│   └── Editor.tsx         # Editor with worker integration
└── pages/
    └── index.tsx          # Main page using the editor
```

## 1. Worker Implementation (`public/worker.js`)

### Key Features

- **Console Capture**: Overrides `console.log`, `console.error`, `console.warn`, `console.info`
- **Timeout Enforcement**: 2000ms internal timeout
- **Safe Execution**: Runs code in isolated worker context
- **Structured Messages**: Returns typed messages with logs

### Message Protocol

#### Input Message
```javascript
{
  code: string,           // JavaScript code to execute
  executionId: number     // Unique execution identifier
}
```

#### Output Messages

**Success:**
```javascript
{
  type: 'success',
  executionId: number,
  logs: LogEntry[],
  returnValue: string | null
}
```

**Error:**
```javascript
{
  type: 'error',
  executionId: number,
  message: string,
  errorName: string,
  stack: string,
  logs: LogEntry[]
}
```

**Timeout:**
```javascript
{
  type: 'timeout',
  executionId: number,
  message: string,
  logs: LogEntry[]
}
```

**Worker Error:**
```javascript
{
  type: 'worker_error',
  message: string,
  filename: string,
  lineno: number,
  colno: number
}
```

### Log Entry Format
```javascript
{
  type: 'log' | 'error' | 'warn' | 'info',
  args: string[]  // Serialized arguments
}
```

### Timeout Mechanism

The worker implements a **2-second timeout**:

```javascript
const EXECUTION_TIMEOUT = 2000; // 2 seconds

timeoutId = setTimeout(() => {
  if (!executionComplete) {
    executionComplete = true;
    restoreConsole();
    self.postMessage({
      type: 'timeout',
      executionId,
      message: `Execution timeout (${EXECUTION_TIMEOUT}ms exceeded)`,
      logs
    });
  }
}, EXECUTION_TIMEOUT);
```

### Console Capture

Original console methods are preserved and overridden:

```javascript
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

console.log = (...args) => {
  logs.push({ type: 'log', args: args.map(serializeArg) });
  originalConsole.log(...args);
};
```

### Argument Serialization

Handles various data types for message passing:

```javascript
function serializeArg(arg) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
  if (typeof arg === 'symbol') return arg.toString();
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, null, 2);
    } catch (e) {
      return '[Object (circular or non-serializable)]';
    }
  }
  return String(arg);
}
```

## 2. Editor Component (`components/Editor.tsx`)

### Component API

**Props:**
```typescript
interface EditorProps {
  code: string;
  language: string;
  onChange: (value: string) => void;
}
```

**Ref Methods (via `useImperativeHandle`):**
```typescript
interface EditorRef {
  executeCode: (onOutput: (output: ExecutionOutput) => void) => void;
  terminateWorker: () => void;
}
```

**Execution Output:**
```typescript
interface ExecutionOutput {
  type: 'success' | 'error' | 'timeout' | 'worker_error' | 'not_supported';
  message?: string;
  logs: LogEntry[];
  executionTime?: number;
}
```

### Worker Lifecycle Management

#### Creating Worker
```typescript
const createWorker = () => {
  terminateWorker(); // Clean up existing worker
  
  workerRef.current = new Worker('/worker.js');
  
  workerRef.current.onmessage = (e) => {
    // Handle worker messages
    // Clear timeout
    // Call output callback
  };
  
  workerRef.current.onerror = (error) => {
    // Handle worker errors
    // Call output callback with error
    // Terminate worker
  };
};
```

#### Terminating Worker
```typescript
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
```

### Timeout Enforcement

**Two-layer timeout protection:**

1. **Worker Internal Timeout**: 2000ms (inside worker.js)
2. **Main Thread Timeout**: 2500ms (safety net in Editor.tsx)

```typescript
const WORKER_TIMEOUT = 2500; // Slightly longer than worker's internal timeout

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
```

### Execution Flow

1. **Check language support** (JavaScript/TypeScript only)
2. **Create worker if needed**
3. **Set main thread timeout** (safety net)
4. **Post message to worker** with code and execution ID
5. **Wait for worker response** or timeout
6. **Clear timeout on response**
7. **Call output callback** with results
8. **Terminate worker on timeout** and recreate

### Code Example

```typescript
// In parent component
const editorRef = useRef<EditorRef>(null);

const handleRun = () => {
  editorRef.current?.executeCode((result) => {
    console.log('Execution result:', result);
    // Handle result.type: success, error, timeout, etc.
  });
};

return <Editor ref={editorRef} code={code} language="javascript" onChange={setCode} />;
```

## 3. Integration in `pages/index.tsx`

### Using the Editor with Worker

```typescript
import { useRef } from 'react';
import Editor, { EditorRef, ExecutionOutput } from '../components/Editor';

export default function Home() {
  const editorRef = useRef<EditorRef>(null);
  const [output, setOutput] = useState<string[]>([]);

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
      }
      // ... handle other types

      // Add console logs
      if (result.logs && result.logs.length > 0) {
        result.logs.forEach(log => {
          const message = log.args.join(' ');
          formattedOutput.push(`${log.type}: ${message}`);
        });
      }

      setOutput(formattedOutput);
    });
  };

  return (
    <Editor ref={editorRef} code={code} language="javascript" onChange={setCode} />
  );
}
```

## Safety Features

### 1. Isolated Execution Context
- Code runs in Web Worker (separate thread)
- No access to DOM or main window
- Cannot access parent page's variables or functions

### 2. Timeout Protection
- **Worker-level**: 2000ms timeout with cleanup
- **Main thread-level**: 2500ms timeout that terminates worker
- Prevents infinite loops and hanging execution

### 3. Worker Termination & Recreation
- Workers are terminated on timeout
- New worker created for next execution
- Prevents memory leaks

### 4. Error Handling
- Try-catch around code execution
- Worker error handlers
- Structured error messages with stack traces

### 5. Safe Serialization
- Handles circular references
- Converts non-serializable objects
- Prevents message passing errors

## Example Usage Scenarios

### Basic Console Output
```javascript
console.log("Hello, World!");
console.error("This is an error");
console.warn("Warning!");
```

Output:
```
✓ Execution completed successfully

--- Console Output ---
> Hello, World!
❌ This is an error
⚠️ Warning!
```

### Infinite Loop (Timeout)
```javascript
while(true) {
  console.log("Loop");
}
```

Output:
```
⏱️ TIMEOUT: Execution timeout - worker terminated (2500ms)
```

### Runtime Error
```javascript
console.log("Start");
throw new Error("Something went wrong");
console.log("This won't run");
```

Output:
```
❌ ERROR: Something went wrong

--- Console Output ---
> Start
❌ Error: Something went wrong
```

### Object Logging
```javascript
const user = { name: "John", age: 30 };
console.log(user);
console.log([1, 2, 3]);
```

Output:
```
✓ Execution completed successfully

--- Console Output ---
> {
  "name": "John",
  "age": 30
}
> [
  1,
  2,
  3
]
```

## Testing the Implementation

1. **Test Normal Execution:**
   ```javascript
   console.log("Test");
   ```

2. **Test Timeout:**
   ```javascript
   while(true) {}
   ```

3. **Test Error Handling:**
   ```javascript
   undefined.method();
   ```

4. **Test Multiple Logs:**
   ```javascript
   console.log("Log 1");
   console.warn("Warning");
   console.error("Error");
   console.log({ key: "value" });
   ```

## Performance Considerations

- Worker creation/termination has minimal overhead
- Workers are reused between executions (unless terminated by timeout)
- Main thread remains responsive during code execution
- Message passing serialization is optimized

## Limitations

1. **Language Support**: Only JavaScript/TypeScript for quick run
2. **No External Resources**: Cannot make HTTP requests in current implementation
3. **No Persistent State**: Each execution is isolated
4. **Browser Support**: Requires Web Worker support (all modern browsers)

## Future Enhancements

- [ ] Add support for async code execution
- [ ] Implement memory usage monitoring
- [ ] Add execution statistics (time, memory)
- [ ] Support for importing modules
- [ ] Persistent worker pool for better performance
- [ ] Syntax validation before execution

