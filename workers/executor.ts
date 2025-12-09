/**
 * Code Execution Worker
 * 
 * Consumes jobs from Redis Stream, fetches code from S3,
 * executes in Docker container, and updates results.
 */

import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getRedisClient, ackJob, ExecutionJob, pushJob, pushDeadLetter } from '../lib/redis';
import { downloadCode, getS3Client } from '../lib/s3';
import { submissionDb, query } from '../lib/db';
import { recordJobStart, recordJobEnd, recordJobCompletion, jobErrorsCounter } from '../monitoring/metrics';

// Configuration
const CONFIG = {
  WORKER_NAME: process.env.WORKER_NAME || `worker-${uuidv4().slice(0, 8)}`,
  CONSUMER_GROUP: process.env.CONSUMER_GROUP || 'execution-workers',
  STREAM_KEY: process.env.REDIS_STREAM_KEY || 'code-execution-jobs',
  RUNNER_IMAGE: process.env.RUNNER_IMAGE || 'code-runner:latest',
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
  MAX_CONCURRENT_JOBS: parseInt(process.env.MAX_CONCURRENT_JOBS || '2'),
  DEFAULT_TIMEOUT_MS: parseInt(process.env.DEFAULT_TIMEOUT_MS || '5000'),
  DEFAULT_MEMORY_MB: parseInt(process.env.DEFAULT_MEMORY_MB || '256'),
  WORKSPACE_BASE: process.env.WORKSPACE_BASE || os.tmpdir(),
  MAX_JOB_ATTEMPTS: parseInt(process.env.MAX_JOB_ATTEMPTS || '3'),
  RETRY_BACKOFF_BASE_MS: parseInt(process.env.RETRY_BACKOFF_BASE_MS || '2000'),
  RETRY_BACKOFF_MAX_MS: parseInt(process.env.RETRY_BACKOFF_MAX_MS || '20000'),
  POOL_NAME: process.env.POOL_NAME || 'container',
  HEALTH_PORT: parseInt(process.env.HEALTH_PORT || '8081'),
  HEALTH_PATH: process.env.HEALTH_PATH || '/health',
  READY_PATH: process.env.READY_PATH || '/ready',
};

// Docker client (for local development)
const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  // For Windows: process.env.DOCKER_HOST || 'npipe:////./pipe/docker_engine'
});

// Execution result interface
interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  executionTimeMs: number;
  memoryUsedKb?: number;
  testResults?: TestResult[];
}

interface TestResult {
  testId: string;
  passed: boolean;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  executionTimeMs: number;
}

// Active jobs tracking
let activeJobs = 0;
let isShuttingDown = false;

/**
 * Main worker loop
 */
async function startWorker(): Promise<void> {
  validateConfig();
  await verifyDbSchema();
  startHealthServer();

  logEvent('worker_start', {
    worker: CONFIG.WORKER_NAME,
    consumerGroup: CONFIG.CONSUMER_GROUP,
    runnerImage: CONFIG.RUNNER_IMAGE,
    maxConcurrentJobs: CONFIG.MAX_CONCURRENT_JOBS,
    pool: CONFIG.POOL_NAME,
  });

  // Ensure consumer group exists
  await ensureConsumerGroup();

  // Start polling loop
  while (!isShuttingDown) {
    try {
      // Check if we can accept more jobs
      if (activeJobs >= CONFIG.MAX_CONCURRENT_JOBS) {
        await sleep(100);
        continue;
      }

      // Claim jobs from Redis Stream
      const jobs = await claimJobs(CONFIG.MAX_CONCURRENT_JOBS - activeJobs);

      if (jobs.length === 0) {
        await sleep(CONFIG.POLL_INTERVAL_MS);
        continue;
      }

      // Process jobs concurrently
      for (const job of jobs) {
        activeJobs++;
        processJob(job)
          .catch((error) => {
            console.error(`❌ Job processing error:`, error);
          })
          .finally(() => {
            activeJobs--;
          });
      }
    } catch (error) {
      console.error('Worker loop error:', error);
      await sleep(5000); // Back off on error
    }
  }

  console.log('Worker shutting down...');
}

/**
 * Ensure consumer group exists
 */
async function ensureConsumerGroup(): Promise<void> {
  const redis = await getRedisClient();
  
  try {
    await redis.xGroupCreate(CONFIG.STREAM_KEY, CONFIG.CONSUMER_GROUP, '$', {
      MKSTREAM: true,
    });
    console.log(`✅ Created consumer group: ${CONFIG.CONSUMER_GROUP}`);
  } catch (error: any) {
    if (error.message.includes('BUSYGROUP')) {
      console.log(`✅ Consumer group already exists: ${CONFIG.CONSUMER_GROUP}`);
    } else {
      throw error;
    }
  }
}

/**
 * Claim jobs from Redis Stream
 */
async function claimJobs(count: number): Promise<Array<{ id: string; job: ExecutionJob }>> {
  const redis = await getRedisClient();
  
  const messages = await redis.xReadGroup(
    CONFIG.CONSUMER_GROUP,
    CONFIG.WORKER_NAME,
    [{ key: CONFIG.STREAM_KEY, id: '>' }],
    { COUNT: count, BLOCK: 5000 }
  );

  if (!messages || messages.length === 0) {
    return [];
  }

  const jobs: Array<{ id: string; job: ExecutionJob }> = [];

  for (const stream of messages) {
    for (const message of stream.messages) {
      const data = message.message as any;
      jobs.push({
        id: message.id,
        job: {
          submissionId: data.submissionId,
          userId: data.userId,
          problemId: data.problemId,
          language: data.language,
          s3Key: data.s3Key,
          codeSizeBytes: parseInt(data.codeSizeBytes),
          timeLimit: parseInt(data.timeLimit) || CONFIG.DEFAULT_TIMEOUT_MS,
          memoryLimit: parseInt(data.memoryLimit) || CONFIG.DEFAULT_MEMORY_MB * 1024,
          priority: data.priority as 'low' | 'normal' | 'high',
          createdAt: data.createdAt,
          attempts: parseInt(data.attempts || '1'),
        },
      });
    }
  }

  return jobs;
}

/**
 * Process a single job
 */
async function processJob(jobData: { id: string; job: ExecutionJob }): Promise<void> {
  const { id: messageId, job } = jobData;
  const startTime = Date.now();
  const attempts = job.attempts || 1;

  logEvent('job_start', {
    submissionId: job.submissionId,
    language: job.language,
    attempts,
    worker: CONFIG.WORKER_NAME,
  });

  let workspaceDir: string | null = null;

  try {
    recordJobStart(CONFIG.POOL_NAME, CONFIG.WORKER_NAME);
    // Update status to processing
    await submissionDb.updateStatus(job.submissionId, 'processing');

    // Create workspace directory
    workspaceDir = await createWorkspace(job.submissionId);

    // Fetch code from S3
    console.log(`📦 Fetching code from S3: ${job.s3Key}`);
    const code = await downloadCode(job.s3Key);

    // Write code to workspace
    const codeFile = getCodeFilename(job.language);
    await fs.writeFile(path.join(workspaceDir, codeFile), code);

    // Execute in Docker container
    console.log(`🐳 Executing in container...`);
    const result = await executeInContainer({
      workspaceDir,
      language: job.language,
      codeFile,
      timeLimit: job.timeLimit || CONFIG.DEFAULT_TIMEOUT_MS,
      memoryLimit: job.memoryLimit || CONFIG.DEFAULT_MEMORY_MB * 1024,
      testCases: job.testCases,
    });

    const executionTime = Date.now() - startTime;

    // Update submission with results
    if (result.success) {
      await submissionDb.updateStatus(job.submissionId, 'completed', {
        execution_time_ms: result.executionTimeMs,
        memory_used_kb: result.memoryUsedKb,
        passed_test_cases: result.testResults?.filter(t => t.passed).length || 0,
        total_test_cases: result.testResults?.length || 0,
        score: calculateScore(result),
      });
      logEvent('job_completed', {
        submissionId: job.submissionId,
        language: job.language,
        executionTimeMs: executionTime,
        attempts,
      });
      recordJobCompletion(
        CONFIG.POOL_NAME,
        job.language,
        executionTime / 1000,
        'success',
        result.memoryUsedKb || 0,
        true
      );
    } else {
      const willRetry = attempts < CONFIG.MAX_JOB_ATTEMPTS;

      if (willRetry) {
        logEvent('job_retry_scheduled', {
          submissionId: job.submissionId,
          nextAttempt: attempts + 1,
          maxAttempts: CONFIG.MAX_JOB_ATTEMPTS,
          error: result.error,
        });
        jobErrorsCounter.inc({ pool: CONFIG.POOL_NAME, language: job.language, error_type: 'retry' });
        await submissionDb.updateStatus(job.submissionId, 'queued');
        await scheduleRetry(job, attempts + 1);
      } else {
        await submissionDb.updateStatus(job.submissionId, 'failed', {
          execution_time_ms: result.executionTimeMs,
          error_message: result.error,
        });
        logEvent('job_failed', {
          submissionId: job.submissionId,
          language: job.language,
          error: result.error,
          attempts,
        });
        jobErrorsCounter.inc({ pool: CONFIG.POOL_NAME, language: job.language, error_type: 'retry_exhausted' });
        await pushDeadLetter(job, result.error || 'unknown_error');
      }

      recordJobCompletion(
        CONFIG.POOL_NAME,
        job.language,
        executionTime / 1000,
        'failed',
        result.memoryUsedKb || 0,
        false
      );
    }

    // Acknowledge job completion
    await ackJob(messageId, CONFIG.CONSUMER_GROUP);

  } catch (error: any) {
    logEvent('job_error', {
      submissionId: job.submissionId,
      error: error.message || 'Unknown error',
      attempts,
    });

    const willRetry = attempts < CONFIG.MAX_JOB_ATTEMPTS;

    if (willRetry) {
      logEvent('job_retry_scheduled', {
        submissionId: job.submissionId,
        nextAttempt: attempts + 1,
        maxAttempts: CONFIG.MAX_JOB_ATTEMPTS,
        error: error.message,
      });
      jobErrorsCounter.inc({ pool: CONFIG.POOL_NAME, language: job.language, error_type: 'retry' });
      await submissionDb.updateStatus(job.submissionId, 'queued');
      await scheduleRetry(job, attempts + 1);
    } else {
      // Update status to failed
      await submissionDb.updateStatus(job.submissionId, 'failed', {
        error_message: error.message || 'Unknown error',
      });
      jobErrorsCounter.inc({ pool: CONFIG.POOL_NAME, language: job.language, error_type: 'retry_exhausted' });
      await pushDeadLetter(job, error.message || 'unknown_error');
    }

    recordJobCompletion(
      CONFIG.POOL_NAME,
      job.language,
      (Date.now() - startTime) / 1000,
      'error',
      0,
      false
    );

    // Acknowledge regardless to avoid tight retry loops; requeue handles retries
    await ackJob(messageId, CONFIG.CONSUMER_GROUP);

  } finally {
    // Cleanup workspace
    if (workspaceDir) {
      await cleanupWorkspace(workspaceDir);
    }
    recordJobEnd(CONFIG.POOL_NAME, CONFIG.WORKER_NAME);
  }
}

/**
 * Create ephemeral workspace directory
 */
async function createWorkspace(submissionId: string): Promise<string> {
  const workspaceDir = path.join(
    CONFIG.WORKSPACE_BASE,
    'code-execution',
    `${submissionId}-${Date.now()}`
  );

  await fs.mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}

/**
 * Cleanup workspace directory
 */
async function cleanupWorkspace(workspaceDir: string): Promise<void> {
  try {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to cleanup workspace: ${workspaceDir}`, error);
  }
}

/**
 * Get code filename based on language
 */
function getCodeFilename(language: string): string {
  const filenames: Record<string, string> = {
    javascript: 'solution.js',
    typescript: 'solution.ts',
    python: 'solution.py',
    java: 'Solution.java',
    cpp: 'solution.cpp',
    c: 'solution.c',
    go: 'solution.go',
    rust: 'solution.rs',
    ruby: 'solution.rb',
    php: 'solution.php',
  };

  return filenames[language] || 'solution.txt';
}

/**
 * Execute code in Docker container
 */
async function executeInContainer(options: {
  workspaceDir: string;
  language: string;
  codeFile: string;
  timeLimit: number;
  memoryLimit: number;
  testCases?: string;
}): Promise<ExecutionResult> {
  const { workspaceDir, language, codeFile, timeLimit, memoryLimit, testCases } = options;
  const startTime = Date.now();

  let container: Docker.Container | null = null;

  try {
    // Create container
    container = await docker.createContainer({
      Image: CONFIG.RUNNER_IMAGE,
      Cmd: ['node', '/runner/runner.js'],
      Env: [
        `LANGUAGE=${language}`,
        `CODE_FILE=${codeFile}`,
        `TIMEOUT_MS=${timeLimit}`,
        `MEMORY_LIMIT_KB=${memoryLimit}`,
        ...(testCases ? [{ TEST_CASES: testCases }] : []),
      ],
      HostConfig: {
        // Mount workspace as /workspace
        Binds: [`${workspaceDir}:/workspace:ro`],
        // Memory limit
        Memory: memoryLimit * 1024, // Convert KB to bytes
        MemorySwap: memoryLimit * 1024, // Disable swap
        // CPU limit (optional)
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% of one CPU
        // Security options
        NetworkMode: 'none', // No network access
        ReadonlyRootfs: false, // Allow writes to tmpfs
        // Tmpfs for execution
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=64m',
        },
        // Security
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        // Resource limits
        PidsLimit: 50, // Max processes
        // Auto remove
        AutoRemove: false,
      },
      WorkingDir: '/workspace',
      User: 'runner', // Non-root user
      // Timeout for container (slightly longer than code timeout)
      StopTimeout: Math.ceil(timeLimit / 1000) + 5,
    });

    // Start container
    await container.start();

    // Wait for container with timeout
    const waitPromise = container.wait();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Container execution timeout')), timeLimit + 5000);
    });

    const waitResult = await Promise.race([waitPromise, timeoutPromise]);

    // Get container logs (stdout contains JSON result)
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    // Parse logs - Docker logs have 8-byte header per line
    const output = demuxDockerLogs(logs);
    
    // Try to parse JSON result from stdout using __RESULT__ prefix
    let result: ExecutionResult;
    
    try {
      const resultLine = output.stdout
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith('__RESULT__'));

      if (resultLine) {
        const jsonPayload = resultLine.replace('__RESULT__', '');
        const parsed = JSON.parse(jsonPayload);
        result = {
          success: parsed.success,
          output: parsed.output || '',
          error: parsed.error,
          exitCode: waitResult.StatusCode,
          executionTimeMs: parsed.executionTimeMs || (Date.now() - startTime),
          memoryUsedKb: parsed.memoryUsedKb,
          testResults: parsed.testResults,
        };
      } else {
        // No JSON found, treat as raw output
        result = {
          success: waitResult.StatusCode === 0,
          output: output.stdout,
          error: output.stderr || undefined,
          exitCode: waitResult.StatusCode,
          executionTimeMs: Date.now() - startTime,
        };
      }
    } catch (parseError) {
      // JSON parse failed
      result = {
        success: false,
        output: output.stdout,
        error: `Output parse error: ${output.stderr}`,
        exitCode: waitResult.StatusCode,
        executionTimeMs: Date.now() - startTime,
      };
    }

    return result;

  } catch (error: any) {
    // Handle timeout
    if (error.message.includes('timeout')) {
      // Kill container if still running
      if (container) {
        try {
          await container.kill();
        } catch (killError) {
          // Container may already be stopped
        }
      }

      return {
        success: false,
        output: '',
        error: `Execution timeout (${timeLimit}ms exceeded)`,
        exitCode: 124, // Standard timeout exit code
        executionTimeMs: timeLimit,
      };
    }

    throw error;

  } finally {
    // Remove container
    if (container) {
      try {
        await container.remove({ force: true });
      } catch (removeError) {
        // Container may already be removed
      }
    }
  }
}

/**
 * Demux Docker logs (separate stdout/stderr)
 */
function demuxDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  let offset = 0;

  while (offset < buffer.length) {
    // Docker log format: [stream_type(1)][0(3)][size(4)][payload]
    const streamType = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    const payload = buffer.slice(offset + 8, offset + 8 + size).toString('utf-8');

    if (streamType === 1) {
      stdout += payload;
    } else if (streamType === 2) {
      stderr += payload;
    }

    offset += 8 + size;
  }

  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Calculate score based on test results
 */
function calculateScore(result: ExecutionResult): number {
  if (!result.testResults || result.testResults.length === 0) {
    return result.success ? 100 : 0;
  }

  const passed = result.testResults.filter(t => t.passed).length;
  const total = result.testResults.length;
  
  return Math.round((passed / total) * 100);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Schedule a retry with exponential backoff.
 */
async function scheduleRetry(job: ExecutionJob, nextAttempt: number): Promise<void> {
  const backoff = Math.min(
    CONFIG.RETRY_BACKOFF_BASE_MS * Math.pow(2, nextAttempt - 1),
    CONFIG.RETRY_BACKOFF_MAX_MS
  );

  setTimeout(async () => {
    try {
      await pushJob({
        ...job,
        attempts: nextAttempt,
        createdAt: job.createdAt || new Date().toISOString(),
      });
      logEvent('job_requeued', {
        submissionId: job.submissionId,
        attempt: nextAttempt,
        backoffMs: backoff,
      });
    } catch (err) {
      logEvent('job_requeue_failed', {
        submissionId: job.submissionId,
        attempt: nextAttempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, backoff);
}

/**
 * Basic config validation to fail fast on missing critical envs.
 */
function validateConfig(): void {
  const missing: string[] = [];
  if (!process.env.REDIS_URL) missing.push('REDIS_URL');
  if (!process.env.POSTGRES_PASSWORD) missing.push('POSTGRES_PASSWORD');
  if (!process.env.S3_BUCKET_NAME) missing.push('S3_BUCKET_NAME');
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!existsSync(process.env.DOCKER_SOCKET || '/var/run/docker.sock')) missing.push('DOCKER_SOCKET');

  if (!CONFIG.RUNNER_IMAGE) missing.push('RUNNER_IMAGE');

  if (missing.length > 0) {
    const allowIncomplete = process.env.ALLOW_INCOMPLETE_CONFIG === 'true' || process.env.NODE_ENV === 'development';
    const message = `Missing required configuration: ${missing.join(', ')}`;
    if (allowIncomplete) {
      console.warn(`[config] ${message} (continuing because ALLOW_INCOMPLETE_CONFIG/NODE_ENV=development)`);
    } else {
      throw new Error(message);
    }
  }
}

/**
 * Verify required DB schema exists.
 */
async function verifyDbSchema(): Promise<void> {
  try {
    await query('SELECT 1 FROM submissions LIMIT 1');
  } catch (err) {
    throw new Error(`Database schema check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Simple health/readiness server.
 */
function startHealthServer(): void {
  const server = http.createServer(async (req, res) => {
    const path = req.url || '';
    if (path.startsWith(CONFIG.HEALTH_PATH) || path.startsWith(CONFIG.READY_PATH)) {
      const status = await getHealthStatus(path.startsWith(CONFIG.READY_PATH));
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = status.ok ? 200 : 503;
      res.end(JSON.stringify(status));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  server.listen(CONFIG.HEALTH_PORT, () => {
    logEvent('health_server_started', {
      port: CONFIG.HEALTH_PORT,
      healthPath: CONFIG.HEALTH_PATH,
      readyPath: CONFIG.READY_PATH,
    });
  });
}

async function getHealthStatus(includeReadiness: boolean) {
  const details: Record<string, string> = {};
  let ok = true;

  // Redis
  try {
    const redis = await getRedisClient();
    await redis.ping();
    details.redis = 'ok';
  } catch (err: any) {
    ok = false;
    details.redis = err.message || 'error';
  }

  // Docker
  try {
    await docker.ping();
    details.docker = 'ok';
  } catch (err: any) {
    ok = false;
    details.docker = err.message || 'error';
  }

  // Database
  try {
    await query('SELECT 1');
    details.db = 'ok';
  } catch (err: any) {
    ok = false;
    details.db = err.message || 'error';
  }

  // S3 (only for readiness)
  if (includeReadiness) {
    try {
      const s3 = getS3Client();
      // Accessing config triggers validation; a simple call to get config values
      await s3.config.credentials();
      details.s3 = 'ok';
    } catch (err: any) {
      ok = false;
      details.s3 = err.message || 'error';
    }
  }

  return { ok, details };
}

/**
 * Structured log helper.
 */
function logEvent(event: string, data: Record<string, any> = {}): void {
  const payload = {
    event,
    ts: new Date().toISOString(),
    worker: CONFIG.WORKER_NAME,
    ...data,
  };
  console.log(JSON.stringify(payload));
}

/**
 * Graceful shutdown handler
 */
function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
    isShuttingDown = true;

    // Wait for active jobs to complete (with timeout)
    const shutdownTimeout = setTimeout(() => {
      console.log('Shutdown timeout, forcing exit...');
      process.exit(1);
    }, 30000);

    while (activeJobs > 0) {
      console.log(`Waiting for ${activeJobs} active job(s)...`);
      await sleep(1000);
    }

    clearTimeout(shutdownTimeout);
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Main entry point
setupShutdownHandlers();
startWorker().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});

export { startWorker, processJob, executeInContainer };
