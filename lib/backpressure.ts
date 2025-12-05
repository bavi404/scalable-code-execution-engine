/**
 * Backpressure and Rate Limiting Module
 * 
 * Implements:
 * - Token Bucket for submission rate limiting
 * - Rate-limited queue reads
 * - Circuit breaker for downstream protection
 * - Load shedding for overload protection
 */

import { createClient, RedisClientType } from 'redis';

// =============================================================================
// Token Bucket Rate Limiter
// =============================================================================

export interface TokenBucketConfig {
  /** Maximum tokens in bucket */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
  /** Redis key prefix */
  keyPrefix: string;
  /** Token cost per operation (default: 1) */
  defaultCost?: number;
}

export class TokenBucket {
  private redis: RedisClientType;
  private config: TokenBucketConfig;

  constructor(redis: RedisClientType, config: TokenBucketConfig) {
    this.redis = redis;
    this.config = {
      defaultCost: 1,
      ...config,
    };
  }

  /**
   * Try to consume tokens
   * @returns Object with allowed status, remaining tokens, and retry-after
   */
  async consume(
    key: string,
    cost: number = this.config.defaultCost!
  ): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
  }> {
    const bucketKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();

    // Lua script for atomic token bucket operation
    const script = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local refill_rate = tonumber(ARGV[2])
      local cost = tonumber(ARGV[3])
      local now = tonumber(ARGV[4])
      
      -- Get current state
      local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
      local tokens = tonumber(bucket[1]) or capacity
      local last_refill = tonumber(bucket[2]) or now
      
      -- Calculate tokens to add based on time elapsed
      local elapsed = (now - last_refill) / 1000
      local refill = elapsed * refill_rate
      tokens = math.min(capacity, tokens + refill)
      
      -- Try to consume
      local allowed = 0
      local retry_after = 0
      
      if tokens >= cost then
        tokens = tokens - cost
        allowed = 1
      else
        -- Calculate time until enough tokens
        local needed = cost - tokens
        retry_after = math.ceil(needed / refill_rate * 1000)
      end
      
      -- Update bucket
      redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
      redis.call('PEXPIRE', key, 86400000) -- 24 hour TTL
      
      return {allowed, tokens, retry_after}
    `;

    const result = await this.redis.eval(script, {
      keys: [bucketKey],
      arguments: [
        this.config.capacity.toString(),
        this.config.refillRate.toString(),
        cost.toString(),
        now.toString(),
      ],
    }) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: Math.floor(result[1]),
      retryAfterMs: result[2],
    };
  }

  /**
   * Get current bucket status
   */
  async getStatus(key: string): Promise<{
    tokens: number;
    capacity: number;
    refillRate: number;
  }> {
    const bucketKey = `${this.config.keyPrefix}:${key}`;
    const bucket = await this.redis.hGetAll(bucketKey);
    
    return {
      tokens: parseFloat(bucket.tokens) || this.config.capacity,
      capacity: this.config.capacity,
      refillRate: this.config.refillRate,
    };
  }

  /**
   * Reset bucket (for admin use)
   */
  async reset(key: string): Promise<void> {
    const bucketKey = `${this.config.keyPrefix}:${key}`;
    await this.redis.del(bucketKey);
  }
}

// =============================================================================
// Sliding Window Rate Limiter
// =============================================================================

export interface SlidingWindowConfig {
  /** Window size in milliseconds */
  windowMs: number;
  /** Maximum requests per window */
  maxRequests: number;
  /** Redis key prefix */
  keyPrefix: string;
}

export class SlidingWindowRateLimiter {
  private redis: RedisClientType;
  private config: SlidingWindowConfig;

  constructor(redis: RedisClientType, config: SlidingWindowConfig) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Check if request is allowed
   */
  async isAllowed(key: string): Promise<{
    allowed: boolean;
    current: number;
    remaining: number;
    resetMs: number;
  }> {
    const windowKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Lua script for sliding window
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local window_ms = tonumber(ARGV[4])
      
      -- Remove old entries
      redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
      
      -- Count current requests
      local current = redis.call('ZCARD', key)
      
      -- Check if allowed
      local allowed = 0
      if current < max_requests then
        redis.call('ZADD', key, now, now .. '-' .. math.random())
        allowed = 1
        current = current + 1
      end
      
      -- Set expiry
      redis.call('PEXPIRE', key, window_ms)
      
      -- Get oldest entry for reset time
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local reset_ms = 0
      if #oldest > 0 then
        reset_ms = tonumber(oldest[2]) + window_ms - now
      end
      
      return {allowed, current, reset_ms}
    `;

    const result = await this.redis.eval(script, {
      keys: [windowKey],
      arguments: [
        now.toString(),
        windowStart.toString(),
        this.config.maxRequests.toString(),
        this.config.windowMs.toString(),
      ],
    }) as [number, number, number];

    return {
      allowed: result[0] === 1,
      current: result[1],
      remaining: Math.max(0, this.config.maxRequests - result[1]),
      resetMs: Math.max(0, result[2]),
    };
  }
}

// =============================================================================
// Circuit Breaker
// =============================================================================

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  recoveryTimeMs: number;
  /** Number of successes needed to close circuit */
  successThreshold: number;
  /** Time window for counting failures */
  failureWindowMs: number;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Check if circuit allows requests
   */
  canExecute(): boolean {
    this.updateState();
    return this.state !== CircuitState.OPEN;
  }

  /**
   * Record successful execution
   */
  recordSuccess(): void {
    this.updateState();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failures = 0;
    }
  }

  /**
   * Record failed execution
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successes = 0;
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Get current state
   */
  getState(): { state: CircuitState; failures: number; successes: number } {
    this.updateState();
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };
  }

  private updateState(): void {
    const now = Date.now();
    
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (now - this.lastFailureTime >= this.config.recoveryTimeMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successes = 0;
      }
    }
    
    // Reset failures if outside window
    if (this.state === CircuitState.CLOSED) {
      if (now - this.lastFailureTime >= this.config.failureWindowMs) {
        this.failures = 0;
      }
    }
  }
}

// =============================================================================
// Rate-Limited Queue Reader
// =============================================================================

export interface QueueReaderConfig {
  /** Base interval between reads (ms) */
  baseIntervalMs: number;
  /** Maximum interval when backing off (ms) */
  maxIntervalMs: number;
  /** Batch size for reading */
  batchSize: number;
  /** Backoff multiplier on error */
  backoffMultiplier: number;
}

export class RateLimitedQueueReader {
  private config: QueueReaderConfig;
  private currentInterval: number;
  private consecutiveErrors: number = 0;
  private circuitBreaker: CircuitBreaker;

  constructor(config: QueueReaderConfig) {
    this.config = config;
    this.currentInterval = config.baseIntervalMs;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeMs: 30000,
      successThreshold: 3,
      failureWindowMs: 60000,
    });
  }

  /**
   * Get current read configuration
   */
  getReadConfig(): {
    batchSize: number;
    intervalMs: number;
    canRead: boolean;
  } {
    return {
      batchSize: this.config.batchSize,
      intervalMs: this.currentInterval,
      canRead: this.circuitBreaker.canExecute(),
    };
  }

  /**
   * Record successful read
   */
  recordSuccess(jobsRead: number): void {
    this.consecutiveErrors = 0;
    this.circuitBreaker.recordSuccess();
    
    // Adjust interval based on jobs read
    if (jobsRead === this.config.batchSize) {
      // Queue is busy, decrease interval
      this.currentInterval = Math.max(
        this.config.baseIntervalMs / 2,
        this.currentInterval / 1.5
      );
    } else if (jobsRead === 0) {
      // Queue is empty, increase interval
      this.currentInterval = Math.min(
        this.config.maxIntervalMs,
        this.currentInterval * 1.5
      );
    } else {
      // Normal load, return to base
      this.currentInterval = this.config.baseIntervalMs;
    }
  }

  /**
   * Record read error
   */
  recordError(): void {
    this.consecutiveErrors++;
    this.circuitBreaker.recordFailure();
    
    // Exponential backoff
    this.currentInterval = Math.min(
      this.config.maxIntervalMs,
      this.config.baseIntervalMs * Math.pow(this.config.backoffMultiplier, this.consecutiveErrors)
    );
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState().state;
  }
}

// =============================================================================
// Load Shedder
// =============================================================================

export interface LoadShedderConfig {
  /** Queue depth threshold for shedding */
  queueDepthThreshold: number;
  /** Recovery threshold (resume normal operation) */
  recoveryThreshold: number;
  /** Priorities to shed (in order) */
  shedOrder: string[];
  /** Metrics callback for monitoring */
  onShed?: (priority: string, count: number) => void;
}

export class LoadShedder {
  private config: LoadShedderConfig;
  private isShedding: boolean = false;
  private currentShedLevel: number = 0;
  private sheddedCount: Map<string, number> = new Map();

  constructor(config: LoadShedderConfig) {
    this.config = config;
  }

  /**
   * Check if a job should be accepted
   */
  shouldAccept(priority: string, queueDepth: number): boolean {
    // Update shedding state
    if (queueDepth >= this.config.queueDepthThreshold) {
      this.isShedding = true;
      // Increase shed level based on how much over threshold
      const excess = queueDepth - this.config.queueDepthThreshold;
      const increment = this.config.queueDepthThreshold / this.config.shedOrder.length;
      this.currentShedLevel = Math.min(
        this.config.shedOrder.length - 1,
        Math.floor(excess / increment)
      );
    } else if (queueDepth <= this.config.recoveryThreshold) {
      this.isShedding = false;
      this.currentShedLevel = 0;
    }

    // Check if this priority should be shed
    if (this.isShedding) {
      const shedPriorities = this.config.shedOrder.slice(0, this.currentShedLevel + 1);
      if (shedPriorities.includes(priority)) {
        // Track shedded jobs
        this.sheddedCount.set(priority, (this.sheddedCount.get(priority) || 0) + 1);
        this.config.onShed?.(priority, this.sheddedCount.get(priority)!);
        return false;
      }
    }

    return true;
  }

  /**
   * Get current shedding status
   */
  getStatus(): {
    isShedding: boolean;
    shedLevel: number;
    sheddedPriorities: string[];
    sheddedCounts: Record<string, number>;
  } {
    return {
      isShedding: this.isShedding,
      shedLevel: this.currentShedLevel,
      sheddedPriorities: this.isShedding
        ? this.config.shedOrder.slice(0, this.currentShedLevel + 1)
        : [],
      sheddedCounts: Object.fromEntries(this.sheddedCount),
    };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.sheddedCount.clear();
  }
}

// =============================================================================
// Submission Rate Limiter (combined)
// =============================================================================

export interface SubmissionRateLimiterConfig {
  /** Per-user rate limit */
  perUser: {
    capacity: number;
    refillRate: number;
  };
  /** Per-IP rate limit */
  perIp: {
    capacity: number;
    refillRate: number;
  };
  /** Global rate limit */
  global: {
    capacity: number;
    refillRate: number;
  };
}

export class SubmissionRateLimiter {
  private userBucket: TokenBucket;
  private ipBucket: TokenBucket;
  private globalBucket: TokenBucket;

  constructor(redis: RedisClientType, config: SubmissionRateLimiterConfig) {
    this.userBucket = new TokenBucket(redis, {
      ...config.perUser,
      keyPrefix: 'ratelimit:user',
    });

    this.ipBucket = new TokenBucket(redis, {
      ...config.perIp,
      keyPrefix: 'ratelimit:ip',
    });

    this.globalBucket = new TokenBucket(redis, {
      ...config.global,
      keyPrefix: 'ratelimit:global',
    });
  }

  /**
   * Check if submission is allowed
   */
  async checkSubmission(
    userId: string,
    ipAddress: string
  ): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfterMs: number;
    limits: {
      user: { remaining: number; retryAfterMs: number };
      ip: { remaining: number; retryAfterMs: number };
      global: { remaining: number; retryAfterMs: number };
    };
  }> {
    // Check all limits in parallel
    const [userResult, ipResult, globalResult] = await Promise.all([
      this.userBucket.consume(userId),
      this.ipBucket.consume(ipAddress),
      this.globalBucket.consume('global'),
    ]);

    const limits = {
      user: { remaining: userResult.remaining, retryAfterMs: userResult.retryAfterMs },
      ip: { remaining: ipResult.remaining, retryAfterMs: ipResult.retryAfterMs },
      global: { remaining: globalResult.remaining, retryAfterMs: globalResult.retryAfterMs },
    };

    // Determine if allowed and why not
    if (!globalResult.allowed) {
      return {
        allowed: false,
        reason: 'Global rate limit exceeded',
        retryAfterMs: globalResult.retryAfterMs,
        limits,
      };
    }

    if (!ipResult.allowed) {
      return {
        allowed: false,
        reason: 'IP rate limit exceeded',
        retryAfterMs: ipResult.retryAfterMs,
        limits,
      };
    }

    if (!userResult.allowed) {
      return {
        allowed: false,
        reason: 'User rate limit exceeded',
        retryAfterMs: userResult.retryAfterMs,
        limits,
      };
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      limits,
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export default {
  TokenBucket,
  SlidingWindowRateLimiter,
  CircuitBreaker,
  RateLimitedQueueReader,
  LoadShedder,
  SubmissionRateLimiter,
};

