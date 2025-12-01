/**
 * Web Worker for safe JavaScript code execution
 * Runs user code in an isolated context with timeout protection
 */

const EXECUTION_TIMEOUT = 2000; // 2 seconds

self.onmessage = function(e) {
  const { code, executionId } = e.data;
  
  if (!code) {
    self.postMessage({
      type: 'error',
      executionId,
      message: 'No code provided',
      logs: []
    });
    return;
  }

  // Array to capture console output
  const logs = [];
  
  // Store original console methods
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  
  // Override console methods to capture output
  console.log = (...args) => {
    logs.push({ type: 'log', args: args.map(serializeArg) });
    originalConsole.log(...args);
  };
  
  console.error = (...args) => {
    logs.push({ type: 'error', args: args.map(serializeArg) });
    originalConsole.error(...args);
  };
  
  console.warn = (...args) => {
    logs.push({ type: 'warn', args: args.map(serializeArg) });
    originalConsole.warn(...args);
  };
  
  console.info = (...args) => {
    logs.push({ type: 'info', args: args.map(serializeArg) });
    originalConsole.info(...args);
  };

  // Timeout handler
  let timeoutId = null;
  let executionComplete = false;

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

  // Helper function to serialize arguments for message passing
  function serializeArg(arg) {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
    if (typeof arg === 'symbol') return arg.toString();
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}`;
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return '[Object (circular or non-serializable)]';
      }
    }
    return String(arg);
  }

  // Restore console methods
  function restoreConsole() {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
  }

  // Execute the user code
  try {
    // Use indirect eval for better isolation
    const result = (0, eval)(code);
    
    if (!executionComplete) {
      executionComplete = true;
      clearTimeout(timeoutId);
      restoreConsole();
      
      // If code returned a value, log it
      if (result !== undefined) {
        logs.push({ 
          type: 'log', 
          args: [serializeArg(result)] 
        });
      }
      
      self.postMessage({
        type: 'success',
        executionId,
        logs,
        returnValue: result !== undefined ? serializeArg(result) : null
      });
    }
  } catch (error) {
    if (!executionComplete) {
      executionComplete = true;
      clearTimeout(timeoutId);
      restoreConsole();
      
      logs.push({ 
        type: 'error', 
        args: [`${error.name}: ${error.message}`] 
      });
      
      self.postMessage({
        type: 'error',
        executionId,
        message: error.message,
        errorName: error.name,
        stack: error.stack,
        logs
      });
    }
  }
};

// Handle worker errors
self.onerror = function(error) {
  self.postMessage({
    type: 'worker_error',
    message: error.message,
    filename: error.filename,
    lineno: error.lineno,
    colno: error.colno
  });
};

