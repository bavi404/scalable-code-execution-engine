/**
 * Prometheus Metrics Exporter
 * 
 * Exposes metrics for:
 * - Job durations (histogram)
 * - Queue depth (gauge)
 * - Per-language error rates (counter)
 * - Worker status (gauge)
 * - Rate limiting (counter)
 * - Resource usage (gauge)
 */

import { Registry, Counter, Histogram, Gauge, Summary, collectDefaultMetrics } from 'prom-client';
import { createClient, RedisClientType } from 'redis';
import * as http from 'http';

// =============================================================================
// Metrics Registry
// =============================================================================

const register = new Registry();

// Add default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register, prefix: 'code_execution_' });

// =============================================================================
// Job Execution Metrics
// =============================================================================

/**
 * Histogram: Job execution duration
 */
export const jobDurationHistogram = new Histogram({
  name: 'code_execution_job_duration_seconds',
  help: 'Duration of code execution jobs in seconds',
  labelNames: ['pool', 'language', 'status', 'verdict'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

/**
 * Counter: Total jobs processed
 */
export const jobsProcessedCounter = new Counter({
  name: 'code_execution_jobs_total',
  help: 'Total number of jobs processed',
  labelNames: ['pool', 'language', 'status', 'verdict'],
  registers: [register],
});

/**
 * Counter: Job errors by language
 */
export const jobErrorsCounter = new Counter({
  name: 'code_execution_errors_total',
  help: 'Total number of job errors',
  labelNames: ['pool', 'language', 'error_type'],
  registers: [register],
});

/**
 * Gauge: Currently running jobs
 */
export const activeJobsGauge = new Gauge({
  name: 'code_execution_active_jobs',
  help: 'Number of currently running jobs',
  labelNames: ['pool', 'worker'],
  registers: [register],
});

/**
 * Summary: Job execution time (for percentiles)
 */
export const jobDurationSummary = new Summary({
  name: 'code_execution_job_duration_summary_seconds',
  help: 'Job execution duration summary',
  labelNames: ['pool', 'language'],
  percentiles: [0.5, 0.9, 0.95, 0.99],
  registers: [register],
});

// =============================================================================
// Queue Metrics
// =============================================================================

/**
 * Gauge: Queue depth per pool
 */
export const queueDepthGauge = new Gauge({
  name: 'code_execution_queue_depth',
  help: 'Number of jobs waiting in queue',
  labelNames: ['pool', 'priority'],
  registers: [register],
});

/**
 * Gauge: Queue processing rate
 */
export const queueProcessingRateGauge = new Gauge({
  name: 'code_execution_queue_processing_rate',
  help: 'Jobs processed per second',
  labelNames: ['pool'],
  registers: [register],
});

/**
 * Histogram: Time in queue before processing
 */
export const queueWaitTimeHistogram = new Histogram({
  name: 'code_execution_queue_wait_seconds',
  help: 'Time jobs spend waiting in queue',
  labelNames: ['pool', 'priority'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [register],
});

// =============================================================================
// Worker Metrics
// =============================================================================

/**
 * Gauge: Worker count per pool
 */
export const workerCountGauge = new Gauge({
  name: 'code_execution_workers',
  help: 'Number of active workers',
  labelNames: ['pool', 'status'],
  registers: [register],
});

/**
 * Gauge: Worker resource usage
 */
export const workerResourceGauge = new Gauge({
  name: 'code_execution_worker_resource_usage',
  help: 'Worker resource usage (CPU/Memory)',
  labelNames: ['pool', 'worker', 'resource'],
  registers: [register],
});

/**
 * Counter: Worker restarts
 */
export const workerRestartsCounter = new Counter({
  name: 'code_execution_worker_restarts_total',
  help: 'Total worker restarts',
  labelNames: ['pool', 'reason'],
  registers: [register],
});

// =============================================================================
// Submission Metrics
// =============================================================================

/**
 * Counter: Submissions received
 */
export const submissionsCounter = new Counter({
  name: 'code_execution_submissions_total',
  help: 'Total submissions received',
  labelNames: ['language', 'problem_id'],
  registers: [register],
});

/**
 * Histogram: Submission size
 */
export const submissionSizeHistogram = new Histogram({
  name: 'code_execution_submission_size_bytes',
  help: 'Size of submitted code in bytes',
  labelNames: ['language'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register],
});

// =============================================================================
// Rate Limiting Metrics
// =============================================================================

/**
 * Counter: Rate limit rejections
 */
export const rateLimitRejectionsCounter = new Counter({
  name: 'code_execution_rate_limit_rejections_total',
  help: 'Requests rejected by rate limiter',
  labelNames: ['limit_type', 'key'],
  registers: [register],
});

/**
 * Gauge: Token bucket tokens remaining
 */
export const tokenBucketGauge = new Gauge({
  name: 'code_execution_token_bucket_tokens',
  help: 'Tokens remaining in rate limit bucket',
  labelNames: ['bucket_type'],
  registers: [register],
});

// =============================================================================
// Circuit Breaker Metrics
// =============================================================================

/**
 * Gauge: Circuit breaker state
 * 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN
 */
export const circuitBreakerStateGauge = new Gauge({
  name: 'code_execution_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['service'],
  registers: [register],
});

/**
 * Counter: Circuit breaker state changes
 */
export const circuitBreakerTransitionsCounter = new Counter({
  name: 'code_execution_circuit_breaker_transitions_total',
  help: 'Circuit breaker state transitions',
  labelNames: ['service', 'from_state', 'to_state'],
  registers: [register],
});

// =============================================================================
// Verdict Metrics
// =============================================================================

/**
 * Counter: Verdicts by type
 */
export const verdictsCounter = new Counter({
  name: 'code_execution_verdicts_total',
  help: 'Total verdicts by type',
  labelNames: ['pool', 'language', 'verdict'],
  registers: [register],
});

/**
 * Histogram: Score distribution
 */
export const scoreHistogram = new Histogram({
  name: 'code_execution_score',
  help: 'Score distribution',
  labelNames: ['language', 'problem_id'],
  buckets: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  registers: [register],
});

// =============================================================================
// Memory/Resource Metrics
// =============================================================================

/**
 * Histogram: Peak memory usage per job
 */
export const memoryUsageHistogram = new Histogram({
  name: 'code_execution_memory_usage_kb',
  help: 'Peak memory usage per job in KB',
  labelNames: ['pool', 'language'],
  buckets: [1024, 4096, 16384, 65536, 131072, 262144, 524288, 1048576],
  registers: [register],
});

// =============================================================================
// Metrics Collection Functions
// =============================================================================

/**
 * Record job completion
 */
export function recordJobCompletion(
  pool: string,
  language: string,
  durationSec: number,
  verdict: string,
  memoryKb: number,
  success: boolean
): void {
  const status = success ? 'success' : 'failure';
  
  jobDurationHistogram.observe({ pool, language, status, verdict }, durationSec);
  jobDurationSummary.observe({ pool, language }, durationSec);
  jobsProcessedCounter.inc({ pool, language, status, verdict });
  verdictsCounter.inc({ pool, language, verdict });
  memoryUsageHistogram.observe({ pool, language }, memoryKb);
  
  if (!success) {
    jobErrorsCounter.inc({ pool, language, error_type: verdict });
  }
}

/**
 * Record job start
 */
export function recordJobStart(pool: string, worker: string): void {
  activeJobsGauge.inc({ pool, worker });
}

/**
 * Record job end
 */
export function recordJobEnd(pool: string, worker: string): void {
  activeJobsGauge.dec({ pool, worker });
}

/**
 * Update queue depth from Redis
 */
export async function updateQueueMetrics(redis: RedisClientType): Promise<void> {
  const pools = ['container', 'microvm', 'trusted'];
  
  for (const pool of pools) {
    const streamKey = `code-execution-jobs:${pool}`;
    
    try {
      // Get stream length
      const length = await redis.xLen(streamKey);
      queueDepthGauge.set({ pool, priority: 'all' }, length);
      
      // Get pending count per consumer group
      try {
        const info = await redis.xInfoGroups(streamKey);
        for (const group of info) {
          queueDepthGauge.set({ pool, priority: 'pending' }, group.pending);
        }
      } catch (e) {
        // Group may not exist yet
      }
    } catch (e) {
      // Stream may not exist yet
    }
  }
}

// =============================================================================
// Metrics HTTP Server
// =============================================================================

export interface MetricsServerConfig {
  port: number;
  path: string;
  redis?: RedisClientType;
  collectInterval?: number;
}

/**
 * Start metrics HTTP server
 */
export function startMetricsServer(config: MetricsServerConfig): http.Server {
  const { port, path, redis, collectInterval = 15000 } = config;
  
  // Periodically collect queue metrics
  if (redis) {
    setInterval(() => {
      updateQueueMetrics(redis).catch(console.error);
    }, collectInterval);
  }
  
  const server = http.createServer(async (req, res) => {
    if (req.url === path) {
      try {
        res.setHeader('Content-Type', register.contentType);
        res.end(await register.metrics());
      } catch (err) {
        res.statusCode = 500;
        res.end(`Error collecting metrics: ${err}`);
      }
    } else if (req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'healthy' }));
    } else if (req.url === '/ready') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ready' }));
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  
  server.listen(port, () => {
    console.log(`Metrics server listening on port ${port}${path}`);
  });
  
  return server;
}

// =============================================================================
// Express Middleware
// =============================================================================

import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware for request metrics
 */
export function metricsMiddleware() {
  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
  });
  
  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });
  
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = req.route?.path || req.path || 'unknown';
      const labels = {
        method: req.method,
        route,
        status_code: res.statusCode.toString(),
      };
      
      httpRequestDuration.observe(labels, duration);
      httpRequestsTotal.inc(labels);
    });
    
    next();
  };
}

// =============================================================================
// Exports
// =============================================================================

export { register };

export default {
  register,
  jobDurationHistogram,
  jobsProcessedCounter,
  jobErrorsCounter,
  activeJobsGauge,
  queueDepthGauge,
  workerCountGauge,
  submissionsCounter,
  rateLimitRejectionsCounter,
  circuitBreakerStateGauge,
  verdictsCounter,
  scoreHistogram,
  memoryUsageHistogram,
  recordJobCompletion,
  recordJobStart,
  recordJobEnd,
  updateQueueMetrics,
  startMetricsServer,
  metricsMiddleware,
};

