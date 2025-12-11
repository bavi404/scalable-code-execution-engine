/**
 * Docker Executor
 * 
 * Executes code in isolated Docker containers using dockerode.
 * For local development and testing. In production, this maps to
 * ECS/Fargate tasks or GKE Jobs.
 */

import Docker from 'dockerode';
import * as path from 'path';
import * as fs from 'fs/promises';

// Initialize Docker client
const docker = new Docker({
  socketPath: process.platform === 'win32' 
    ? '//./pipe/docker_engine' 
    : '/var/run/docker.sock',
});

// Language configuration
interface LanguageConfig {
  image: string;
  compileCmd?: string[];
  runCmd: string[];
  filename: string;
  timeout?: number;
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  javascript: {
    image: 'code-runner:node',
    runCmd: ['node', '/workspace/solution.js'],
    filename: 'solution.js',
  },
  typescript: {
    image: 'code-runner:node',
    compileCmd: ['npx', 'tsc', '--outDir', '/workspace', '/workspace/solution.ts'],
    runCmd: ['node', '/workspace/solution.js'],
    filename: 'solution.ts',
  },
  python: {
    image: 'code-runner:python',
    runCmd: ['python3', '/workspace/solution.py'],
    filename: 'solution.py',
  },
  java: {
    image: 'code-runner:java',
    compileCmd: ['javac', '-d', '/workspace', '/workspace/Solution.java'],
    runCmd: ['java', '-cp', '/workspace', 'Solution'],
    filename: 'Solution.java',
  },
  cpp: {
    image: 'code-runner:cpp',
    compileCmd: ['g++', '-O2', '-o', '/workspace/solution', '/workspace/solution.cpp'],
    runCmd: ['/workspace/solution'],
    filename: 'solution.cpp',
  },
  c: {
    image: 'code-runner:cpp',
    compileCmd: ['gcc', '-O2', '-o', '/workspace/solution', '/workspace/solution.c'],
    runCmd: ['/workspace/solution'],
    filename: 'solution.c',
  },
  go: {
    image: 'code-runner:go',
    compileCmd: ['go', 'build', '-o', '/workspace/solution', '/workspace/solution.go'],
    runCmd: ['/workspace/solution'],
    filename: 'solution.go',
  },
  rust: {
    image: 'code-runner:rust',
    compileCmd: ['rustc', '-O', '-o', '/workspace/solution', '/workspace/solution.rs'],
    runCmd: ['/workspace/solution'],
    filename: 'solution.rs',
  },
  ruby: {
    image: 'code-runner:ruby',
    runCmd: ['ruby', '/workspace/solution.rb'],
    filename: 'solution.rb',
  },
  php: {
    image: 'code-runner:php',
    runCmd: ['php', '/workspace/solution.php'],
    filename: 'solution.php',
  },
};

export interface ExecutionRequest {
  workspaceDir: string;
  codeFile: string;
  language: string;
  timeLimit: number;  // in milliseconds
  memoryLimit: number;  // in KB
  submissionId: string;
  testCases?: TestCase[];
}

export interface TestCase {
  input: string;
  expected: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  executionTimeMs: number;
  memoryUsedKb: number;
  timedOut: boolean;
  passedTests?: number;
  totalTests?: number;
  score?: number;
  maxScore?: number;
  testResults?: TestCaseResult[];
}

export interface TestCaseResult {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  timeMs: number;
}

export class DockerExecutor {
  private readonly defaultImage = 'code-runner:base';

  /**
   * Execute code in a Docker container
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const config = LANGUAGE_CONFIGS[request.language];

    if (!config) {
      return {
        success: false,
        output: '',
        error: `Unsupported language: ${request.language}`,
        exitCode: 1,
        executionTimeMs: 0,
        memoryUsedKb: 0,
        timedOut: false,
      };
    }

    // Write runner script to workspace
    await this.writeRunnerScript(request.workspaceDir, request, config);

    // Create container
    let container: Docker.Container | null = null;
    let timedOut = false;

    try {
      // Pull image if not exists (optional, can be pre-pulled)
      await this.ensureImage(config.image);

      // Create container with resource limits
      container = await docker.createContainer({
        Image: config.image,
        Cmd: ['/bin/sh', '/workspace/runner.sh'],
        WorkingDir: '/workspace',
        HostConfig: {
          // Mount workspace directory
          Binds: [`${request.workspaceDir}:/workspace:rw`],
          
          // Memory limit (convert KB to bytes)
          Memory: request.memoryLimit * 1024,
          MemorySwap: request.memoryLimit * 1024, // Disable swap
          
          // CPU limit (optional)
          CpuPeriod: 100000,
          CpuQuota: 100000, // 1 CPU
          
          // Security settings
          NetworkMode: 'none', // No network access
          ReadonlyRootfs: false, // Allow writing to workspace
          
          // Use tmpfs for temp files
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=64m',
          },
          
          // Limit processes
          PidsLimit: 100,
          
          // Security options
          SecurityOpt: ['no-new-privileges:true'],
          
          // Auto remove container after exit
          AutoRemove: true,
        },
        // Environment variables
        Env: [
          `TIME_LIMIT=${request.timeLimit}`,
          `MEMORY_LIMIT=${request.memoryLimit}`,
          `SUBMISSION_ID=${request.submissionId}`,
        ],
        // Disable stdin
        AttachStdin: false,
        OpenStdin: false,
        Tty: false,
      });

      // Start container
      await container.start();

      // Wait for container with timeout
      const timeoutPromise = new Promise<{ StatusCode: number }>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error('Execution timeout'));
        }, request.timeLimit + 5000); // Add 5s buffer for startup
      });

      const waitPromise = container.wait();

      let exitInfo: { StatusCode: number };
      try {
        exitInfo = await Promise.race([waitPromise, timeoutPromise]);
      } catch (error: any) {
        if (timedOut && container) {
          // Kill container on timeout
          try {
            await container.kill();
          } catch (killError) {
            // Container might already be stopped
          }
        }
        throw error;
      }

      // Get container logs
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });

      // Parse logs (Docker multiplexed stream format)
      const { stdout, stderr } = this.parseLogs(logs);

      // Try to parse JSON result from runner script
      const result = this.parseRunnerOutput(stdout, stderr, exitInfo.StatusCode);

      return {
        ...result,
        executionTimeMs: Date.now() - startTime,
        timedOut: false,
      };

    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: timedOut ? 'Time Limit Exceeded' : error.message,
        exitCode: timedOut ? 124 : 1,
        executionTimeMs: Date.now() - startTime,
        memoryUsedKb: 0,
        timedOut,
      };

    } finally {
      // Cleanup container if it still exists
      if (container) {
        try {
          await container.remove({ force: true });
        } catch (e) {
          // Container might be auto-removed
        }
      }
    }
  }

  /**
   * Write the runner script to workspace
   */
  private async writeRunnerScript(
    workspaceDir: string,
    request: ExecutionRequest,
    config: LanguageConfig
  ): Promise<void> {
    const runnerScript = this.generateRunnerScript(request, config);
    await fs.writeFile(
      path.join(workspaceDir, 'runner.sh'),
      runnerScript,
      { mode: 0o755 }
    );
  }

  /**
   * Generate the runner shell script
   */
  private generateRunnerScript(request: ExecutionRequest, config: LanguageConfig): string {
    const timeoutSec = Math.ceil(request.timeLimit / 1000);
    
    return `#!/bin/sh
set -e

# Runner script for ${request.language}
# Submission: ${request.submissionId}

RESULT_FILE="/workspace/result.json"
START_TIME=$(date +%s%3N)

# Initialize result
echo '{"success":false,"output":"","error":"","exitCode":1}' > $RESULT_FILE

# Function to output JSON result
output_result() {
  local success=$1
  local exit_code=$2
  local output=$3
  local error=$4
  local end_time=$(date +%s%3N)
  local duration=$((end_time - START_TIME))
  
  # Get memory usage (Linux specific)
  local mem_kb=0
  if [ -f /sys/fs/cgroup/memory/memory.max_usage_in_bytes ]; then
    mem_kb=$(($(cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes) / 1024))
  fi
  
  # Escape special characters for JSON
  output=$(echo "$output" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\\n/\\\\n/g')
  error=$(echo "$error" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\\n/\\\\n/g')
  
  cat > $RESULT_FILE << EOF
{
  "success": $success,
  "output": "$output",
  "error": "$error",
  "exitCode": $exit_code,
  "executionTimeMs": $duration,
  "memoryUsedKb": $mem_kb
}
EOF

  cat $RESULT_FILE
}

# Trap for timeout
trap 'output_result false 124 "" "Time Limit Exceeded"; exit 124' TERM

${config.compileCmd ? `
# Compilation phase
echo "Compiling..."
COMPILE_OUTPUT=$(${config.compileCmd.join(' ')} 2>&1) || {
  output_result false 1 "" "Compilation Error: $COMPILE_OUTPUT"
  exit 1
}
echo "Compilation successful"
` : ''}

# Execution phase with timeout
echo "Running..."
EXEC_OUTPUT=$(timeout ${timeoutSec}s ${config.runCmd.join(' ')} 2>&1) || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    output_result false 124 "" "Time Limit Exceeded"
  else
    output_result false $EXIT_CODE "" "$EXEC_OUTPUT"
  fi
  exit $EXIT_CODE
}

# Success
output_result true 0 "$EXEC_OUTPUT" ""
exit 0
`;
  }

  /**
   * Ensure Docker image exists
   */
  private async ensureImage(imageName: string): Promise<void> {
    try {
      await docker.getImage(imageName).inspect();
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`[Docker] Image ${imageName} not found, using base image`);
        // In production, you'd pull from a registry
        // For local dev, we'll use a base image
      }
    }
  }

  /**
   * Parse Docker logs (multiplexed format)
   */
  private parseLogs(logs: Buffer): { stdout: string; stderr: string } {
    let stdout = '';
    let stderr = '';
    
    // Docker logs are in multiplexed format when TTY is false
    // Format: [8]byte{STREAM_TYPE, 0, 0, 0, SIZE1, SIZE2, SIZE3, SIZE4}
    // STREAM_TYPE: 1 = stdout, 2 = stderr
    
    let offset = 0;
    while (offset < logs.length) {
      if (offset + 8 > logs.length) break;
      
      const streamType = logs[offset];
      const size = logs.readUInt32BE(offset + 4);
      
      if (offset + 8 + size > logs.length) break;
      
      const content = logs.slice(offset + 8, offset + 8 + size).toString('utf-8');
      
      if (streamType === 1) {
        stdout += content;
      } else if (streamType === 2) {
        stderr += content;
      }
      
      offset += 8 + size;
    }
    
    // If parsing failed, treat entire buffer as stdout
    if (!stdout && !stderr && logs.length > 0) {
      stdout = logs.toString('utf-8');
    }
    
    return { stdout, stderr };
  }

  /**
   * Parse runner script output (JSON)
   */
  private parseRunnerOutput(
    stdout: string,
    stderr: string,
    exitCode: number
  ): Omit<ExecutionResult, 'timedOut'> {
    // Try to find JSON result in stdout
    const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        return {
          success: result.success,
          output: result.output || '',
          error: result.error || undefined,
          exitCode: result.exitCode,
          executionTimeMs: result.executionTimeMs || 0,
          memoryUsedKb: result.memoryUsedKb || 0,
          passedTests: result.passedTests,
          totalTests: result.totalTests,
          score: result.score,
          maxScore: result.maxScore,
          testResults: result.testResults,
        };
      } catch (e) {
        // JSON parsing failed
      }
    }
    
    // Fallback to raw output
    return {
      success: exitCode === 0,
      output: stdout,
      error: stderr || undefined,
      exitCode,
      executionTimeMs: 0,
      memoryUsedKb: 0,
    };
  }

  /**
   * List available runner images
   */
  async listImages(): Promise<string[]> {
    const images = await docker.listImages({
      filters: { reference: ['code-runner:*'] },
    });
    
    return images.map(img => img.RepoTags?.[0] || 'unknown').filter(Boolean);
  }

  /**
   * Build runner image from Dockerfile
   */
  async buildImage(
    dockerfilePath: string,
    tag: string
  ): Promise<void> {
    const stream = await docker.buildImage(
      path.dirname(dockerfilePath),
      { t: tag, dockerfile: path.basename(dockerfilePath) }
    );

    // Wait for build to complete
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
  }
}

