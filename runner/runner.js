#!/usr/bin/env node

/**
 * Code Runner Script
 * 
 * Runs inside Docker container, executes user code with
 * time/memory limits, and outputs JSON result to stdout.
 * 
 * Environment variables:
 *   LANGUAGE     - Programming language (javascript, python, etc.)
 *   CODE_FILE    - Filename of the code to execute
 *   TIMEOUT_MS   - Execution timeout in milliseconds
 *   MEMORY_LIMIT_KB - Memory limit in kilobytes (enforced by Docker)
 *   TEST_CASES   - Optional JSON string of test cases
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration from environment
const LANGUAGE = process.env.LANGUAGE || 'javascript';
const CODE_FILE = process.env.CODE_FILE || 'solution.js';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '5000');
const MEMORY_LIMIT_KB = parseInt(process.env.MEMORY_LIMIT_KB || '262144');
const TEST_CASES_JSON = process.env.TEST_CASES || null;
const WORKSPACE_DIR = '/workspace';

// Result structure
const result = {
  success: false,
  output: '',
  error: null,
  exitCode: 0,
  executionTimeMs: 0,
  memoryUsedKb: 0,
  testResults: [],
};
const MAX_RESULT_STRING = 16 * 1024; // cap output/error in JSON
const MAX_TEST_RESULTS = 50; // avoid unbounded arrays
const RUN_ID = process.env.RUN_ID || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

/**
 * Get command and args for running code based on language
 */
function getRunCommand(language, codeFile) {
  const commands = {
    javascript: {
      cmd: 'node',
      args: [codeFile],
      compile: null,
    },
    typescript: {
      cmd: 'npx',
      args: ['ts-node', codeFile],
      compile: null,
    },
    python: {
      cmd: 'python3',
      args: [codeFile],
      compile: null,
    },
    java: {
      cmd: 'java',
      args: [codeFile.replace('.java', '')],
      compile: {
        cmd: 'javac',
        args: [codeFile],
      },
    },
    cpp: {
      cmd: './a.out',
      args: [],
      compile: {
        cmd: 'g++',
        args: ['-O2', '-o', 'a.out', codeFile],
      },
    },
    c: {
      cmd: './a.out',
      args: [],
      compile: {
        cmd: 'gcc',
        args: ['-O2', '-o', 'a.out', codeFile],
      },
    },
    go: {
      cmd: 'go',
      args: ['run', codeFile],
      compile: null,
    },
    rust: {
      cmd: './solution',
      args: [],
      compile: {
        cmd: 'rustc',
        args: ['-O', '-o', 'solution', codeFile],
      },
    },
    ruby: {
      cmd: 'ruby',
      args: [codeFile],
      compile: null,
    },
    php: {
      cmd: 'php',
      args: [codeFile],
      compile: null,
    },
  };

  return commands[language] || commands.javascript;
}

/**
 * Compile code if needed (for compiled languages)
 */
function compileCode(compileConfig) {
  return new Promise((resolve, reject) => {
    if (!compileConfig) {
      resolve({ success: true });
      return;
    }

    const startTime = Date.now();
    const compile = spawn(compileConfig.cmd, compileConfig.args, {
      cwd: WORKSPACE_DIR,
      timeout: 30000, // 30 second compile timeout
    });

    let stderr = '';

    compile.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    compile.on('close', (code) => {
      const compileTime = Date.now() - startTime;
      
      if (code === 0) {
        resolve({ success: true, compileTime });
      } else {
        reject(new Error(`Compilation failed: ${stderr}`));
      }
    });

    compile.on('error', (err) => {
      reject(new Error(`Compilation error: ${err.message}`));
    });
  });
}

/**
 * Execute code with timeout and capture output
 */
function executeCode(cmd, args, input = null) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    let memoryUsed = 0;

    const proc = spawn(cmd, args, {
      cwd: WORKSPACE_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Limit memory in Node.js
        NODE_OPTIONS: `--max-old-space-size=${Math.floor(MEMORY_LIMIT_KB / 1024)}`,
      },
    });

    // Timeout handler
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, TIMEOUT_MS);

    // Provide input if specified
    if (input !== null) {
      proc.stdin.write(input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Limit output size
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.substring(0, 1024 * 1024) + '\n... (output truncated)';
        proc.kill('SIGKILL');
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 64 * 1024) {
        stderr = stderr.substring(0, 64 * 1024) + '\n... (truncated)';
      }
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      const executionTime = Date.now() - startTime;

      // Try to get memory usage (Linux-specific)
      try {
        const status = fs.readFileSync(`/proc/${proc.pid}/status`, 'utf8');
        const vmRss = status.match(/VmRSS:\s*(\d+)/);
        if (vmRss) {
          memoryUsed = parseInt(vmRss[1]);
        }
      } catch (e) {
        // Process already exited, can't read memory
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
        signal,
        killed,
        executionTimeMs: executionTime,
        memoryUsedKb: memoryUsed,
        timedOut: killed && executionTime >= TIMEOUT_MS,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        signal: null,
        killed: false,
        executionTimeMs: Date.now() - startTime,
        memoryUsedKb: 0,
        timedOut: false,
      });
    });
  });
}

/**
 * Run test cases against the code
 */
async function runTestCases(cmd, args, testCases) {
  const results = [];

  for (const testCase of testCases) {
    const startTime = Date.now();
    const execResult = await executeCode(cmd, args, testCase.input);
    const executionTime = Date.now() - startTime;

    const actualOutput = execResult.stdout.trim();
    const expectedOutput = (testCase.expectedOutput || '').trim();
    const passed = actualOutput === expectedOutput;

    results.push({
      testId: testCase.id || `test-${results.length + 1}`,
      passed,
      input: testCase.input,
      expectedOutput,
      actualOutput,
      executionTimeMs: executionTime,
      error: execResult.stderr || null,
      timedOut: execResult.timedOut,
    });

    // Stop on first failure if configured
    if (!passed && testCase.stopOnFailure) {
      break;
    }
  }

  return results;
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();

  try {
    // Check if code file exists
    const codePath = path.join(WORKSPACE_DIR, CODE_FILE);
    if (!fs.existsSync(codePath)) {
      throw new Error(`Code file not found: ${CODE_FILE}`);
    }

    // Get run configuration
    const runConfig = getRunCommand(LANGUAGE, CODE_FILE);

    // Compile if needed
    if (runConfig.compile) {
      try {
        await compileCode(runConfig.compile);
      } catch (compileError) {
        result.success = false;
        result.error = compileError.message;
        result.executionTimeMs = Date.now() - startTime;
        outputResult();
        return;
      }
    }

    // Parse test cases if provided
    let testCases = null;
    if (TEST_CASES_JSON) {
      try {
        testCases = JSON.parse(TEST_CASES_JSON);
      } catch (e) {
        // Invalid test cases, run without them
      }
    }

    // Execute code
    if (testCases && testCases.length > 0) {
      // Run with test cases
      const testResults = await runTestCases(runConfig.cmd, runConfig.args, testCases);
      const allPassed = testResults.every(t => t.passed);
      const totalTime = testResults.reduce((sum, t) => sum + t.executionTimeMs, 0);

      result.success = allPassed;
      result.output = testResults.map(t => t.actualOutput).join('\n');
      result.testResults = testResults;
      result.executionTimeMs = totalTime;
      result.exitCode = allPassed ? 0 : 1;

      if (!allPassed) {
        const failedTests = testResults.filter(t => !t.passed);
        result.error = `Failed ${failedTests.length}/${testResults.length} test cases`;
      }
    } else {
      // Simple execution without test cases
      const execResult = await executeCode(runConfig.cmd, runConfig.args);

      result.success = execResult.exitCode === 0 && !execResult.timedOut;
      result.output = execResult.stdout;
      result.exitCode = execResult.exitCode;
      result.executionTimeMs = execResult.executionTimeMs;
      result.memoryUsedKb = execResult.memoryUsedKb;

      if (execResult.timedOut) {
        result.success = false;
        result.error = `Execution timeout (${TIMEOUT_MS}ms exceeded)`;
      } else if (execResult.stderr) {
        result.error = execResult.stderr;
      }
    }

  } catch (error) {
    result.success = false;
    result.error = error.message;
    result.executionTimeMs = Date.now() - startTime;
    logEvent('runner_error', { error: error.message });
  }

  outputResult();
}

/**
 * Output result as JSON to stdout
 */
function outputResult() {
  // Clamp payload sizes to avoid oversized messages
  if (typeof result.output === 'string') {
    result.output = truncate(result.output, MAX_RESULT_STRING);
  }
  if (typeof result.error === 'string') {
    result.error = truncate(result.error, MAX_RESULT_STRING);
  }
  if (Array.isArray(result.testResults) && result.testResults.length > MAX_TEST_RESULTS) {
    result.testResults = result.testResults.slice(0, MAX_TEST_RESULTS);
  }

  // Output JSON result to stdout (worker reads this)
  const payload = `__RESULT__${JSON.stringify(result)}\n`;
  process.stdout.write(payload);
  logEvent('runner_result', {
    success: result.success,
    exitCode: result.exitCode,
    executionTimeMs: result.executionTimeMs,
    memoryUsedKb: result.memoryUsedKb,
  });
  
  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (truncated)';
}

function logEvent(event, data = {}) {
  const payload = {
    event,
    ts: new Date().toISOString(),
    runId: RUN_ID,
    language: LANGUAGE,
    codeFile: CODE_FILE,
    ...data,
  };
  // Avoid interfering with __RESULT__ parsing; structured log is separate line
  console.log(JSON.stringify(payload));
}

// Run main
main().catch((error) => {
  result.success = false;
  result.error = `Runner error: ${error.message}`;
  outputResult();
});

