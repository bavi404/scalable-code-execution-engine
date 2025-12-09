/**
 * Redis Client for job queue using Redis Streams
 */

import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

/**
 * Get or create Redis client
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            return new Error('Redis connection failed after 10 retries');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis client connected');
    });

    await redisClient.connect();
  }

  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

const STREAM_KEY = process.env.REDIS_STREAM_KEY || 'code-execution-jobs';
const MAX_STREAM_LENGTH = 10000; // Keep last 10k jobs in stream

/**
 * Job payload interface
 */
export interface ExecutionJob {
  submissionId: string;
  userId: string;
  problemId: string;
  language: string;
  s3Key: string;
  codeSizeBytes: number;
  timeLimit?: number;
  memoryLimit?: number;
  priority?: 'low' | 'normal' | 'high';
  createdAt: string;
  attempts?: number;
  testCases?: string; // JSON string of test cases, optional
}

/**
 * Push a job to Redis Stream
 */
export async function pushJob(job: ExecutionJob): Promise<string> {
  const client = await getRedisClient();
  const attempts = job.attempts ?? 1;

  try {
    // Add job to stream with automatic ID generation (*)
    const jobId = await client.xAdd(
      STREAM_KEY,
      '*', // Auto-generate ID (timestamp-sequence)
      {
        submissionId: job.submissionId,
        userId: job.userId,
        problemId: job.problemId,
        language: job.language,
        s3Key: job.s3Key,
        codeSizeBytes: job.codeSizeBytes.toString(),
        timeLimit: (job.timeLimit || 5000).toString(),
        memoryLimit: (job.memoryLimit || 262144).toString(),
        priority: job.priority || 'normal',
        createdAt: job.createdAt,
        attempts: attempts.toString(),
        ...(job.testCases ? { testCases: job.testCases } : {}),
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~', // Approximate trimming for better performance
          threshold: MAX_STREAM_LENGTH,
        },
      }
    );

    // Optionally: Add to a priority queue using sorted set
    if (job.priority === 'high') {
      await client.zAdd(`${STREAM_KEY}:priority`, {
        score: Date.now(),
        value: jobId,
      });
    }

    return jobId;
  } catch (error) {
    console.error('Redis push job error:', error);
    throw new Error('Failed to queue job');
  }
}

/**
 * Read jobs from stream (for workers)
 */
export async function readJobs(
  consumerGroup: string = 'execution-workers',
  consumerName: string = 'worker-1',
  count: number = 10,
  blockMs: number = 5000
): Promise<ExecutionJob[]> {
  const client = await getRedisClient();

  try {
    // Create consumer group if it doesn't exist
    try {
      await client.xGroupCreate(STREAM_KEY, consumerGroup, '$', {
        MKSTREAM: true,
      });
    } catch (error: any) {
      // Group already exists
      if (!error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }

    // Read from stream
    const messages = await client.xReadGroup(
      consumerGroup,
      consumerName,
      [
        {
          key: STREAM_KEY,
          id: '>', // Read only new messages
        },
      ],
      {
        COUNT: count,
        BLOCK: blockMs,
      }
    );

    if (!messages || messages.length === 0) {
      return [];
    }

    const jobs: ExecutionJob[] = [];
    
    for (const stream of messages) {
      for (const message of stream.messages) {
        const data = message.message as any;
        jobs.push({
          submissionId: data.submissionId,
          userId: data.userId,
          problemId: data.problemId,
          language: data.language,
          s3Key: data.s3Key,
          codeSizeBytes: parseInt(data.codeSizeBytes),
          timeLimit: parseInt(data.timeLimit),
          memoryLimit: parseInt(data.memoryLimit),
          priority: data.priority as 'low' | 'normal' | 'high',
          createdAt: data.createdAt,
          attempts: parseInt(data.attempts || '1'),
          testCases: data.testCases,
        });
      }
    }

    return jobs;
  } catch (error) {
    console.error('Redis read jobs error:', error);
    throw error;
  }
}

/**
 * Acknowledge job completion
 */
export async function ackJob(
  jobId: string,
  consumerGroup: string = 'execution-workers'
): Promise<void> {
  const client = await getRedisClient();
  await client.xAck(STREAM_KEY, consumerGroup, jobId);
}

/**
 * Push job to dead-letter stream with reason.
 */
export async function pushDeadLetter(job: ExecutionJob, reason: string): Promise<string> {
  const client = await getRedisClient();
  const dlqKey = `${STREAM_KEY}:dlq`;
  return await client.xAdd(dlqKey, '*', {
    submissionId: job.submissionId,
    userId: job.userId,
    problemId: job.problemId,
    language: job.language,
    s3Key: job.s3Key,
    codeSizeBytes: job.codeSizeBytes.toString(),
    timeLimit: (job.timeLimit || 5000).toString(),
    memoryLimit: (job.memoryLimit || 262144).toString(),
    priority: job.priority || 'normal',
    createdAt: job.createdAt,
    attempts: (job.attempts || 1).toString(),
    reason,
    ...(job.testCases ? { testCases: job.testCases } : {}),
  });
}

/**
 * Simple token bucket style rate limiter.
 * Returns whether a request is allowed for the given key.
 */
export async function consumeRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = await getRedisClient();
  const now = Math.floor(Date.now() / 1000);
  const bucketKey = `rate:${key}:${windowSeconds}`;

  // Use INCR with expiry to approximate a fixed window counter.
  const current = await client.incr(bucketKey);
  if (current === 1) {
    await client.expire(bucketKey, windowSeconds);
  }

  const allowed = current <= maxRequests;
  const ttl = await client.ttl(bucketKey);
  const resetAt = now + (ttl > 0 ? ttl : windowSeconds);
  const remaining = Math.max(0, maxRequests - current);

  return { allowed, remaining, resetAt };
}

/**
 * Get stream info (for monitoring)
 */
export async function getStreamInfo(): Promise<any> {
  const client = await getRedisClient();
  return await client.xInfoStream(STREAM_KEY);
}

/**
 * Validate Redis configuration
 */
export function validateRedisConfig(): { valid: boolean; error?: string } {
  const url = process.env.REDIS_URL;
  if (!url) {
    return { valid: false, error: 'REDIS_URL not configured' };
  }
  return { valid: true };
}


