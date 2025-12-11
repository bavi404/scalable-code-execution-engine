/**
 * Execution Pool Configuration
 * 
 * Defines rules for routing jobs to appropriate execution pools
 * based on language, resource requirements, and trust level.
 */

export interface PoolConfig {
  name: string;
  languages: string[];
  maxMemoryMb: number;
  maxCpuCores: number;
  maxTimeoutSec: number;
  maxConcurrentJobs: number;
  isolation: 'container' | 'microvm' | 'process';
  priority: number;  // Lower = preferred when multiple pools match
}

export interface WorkerConfig {
  pool: string;
  maxConcurrentJobs: number;
  memoryPerJobMb: number;
  cpuPerJobCores: number;
  defaultTimeoutMs: number;
  healthCheckIntervalMs: number;
  gracefulShutdownMs: number;
}

// =============================================================================
// Pool Definitions
// =============================================================================

export const POOLS: Record<string, PoolConfig> = {
  container: {
    name: 'container',
    languages: ['javascript', 'typescript', 'python', 'ruby', 'php'],
    maxMemoryMb: 256,
    maxCpuCores: 0.5,
    maxTimeoutSec: 10,
    maxConcurrentJobs: 8,
    isolation: 'container',
    priority: 1,
  },
  
  microvm: {
    name: 'microvm',
    languages: ['c', 'cpp', 'java', 'rust', 'go'],
    maxMemoryMb: 1024,
    maxCpuCores: 2,
    maxTimeoutSec: 30,
    maxConcurrentJobs: 2,
    isolation: 'microvm',
    priority: 2,
  },
  
  trusted: {
    name: 'trusted',
    languages: ['*'],  // All languages
    maxMemoryMb: 2048,
    maxCpuCores: 4,
    maxTimeoutSec: 60,
    maxConcurrentJobs: 4,
    isolation: 'process',
    priority: 3,
  },
};

// =============================================================================
// Worker Configurations per Pool
// =============================================================================

export const WORKER_CONFIGS: Record<string, WorkerConfig> = {
  container: {
    pool: 'container',
    maxConcurrentJobs: 8,
    memoryPerJobMb: 256,
    cpuPerJobCores: 0.125,  // 1 vCPU / 8 jobs
    defaultTimeoutMs: 5000,
    healthCheckIntervalMs: 10000,
    gracefulShutdownMs: 30000,
  },
  
  microvm: {
    pool: 'microvm',
    maxConcurrentJobs: 2,
    memoryPerJobMb: 512,
    cpuPerJobCores: 0.5,
    defaultTimeoutMs: 10000,
    healthCheckIntervalMs: 15000,
    gracefulShutdownMs: 60000,
  },
  
  trusted: {
    pool: 'trusted',
    maxConcurrentJobs: 4,
    memoryPerJobMb: 1024,
    cpuPerJobCores: 1,
    defaultTimeoutMs: 30000,
    healthCheckIntervalMs: 10000,
    gracefulShutdownMs: 45000,
  },
};

// =============================================================================
// Pool Selection Logic
// =============================================================================

export interface SubmissionRequirements {
  language: string;
  memoryMb: number;
  cpuCores: number;
  timeoutSec: number;
  userId: string;
  trustLevel?: 'standard' | 'verified' | 'admin';
}

/**
 * Select appropriate pool for a submission
 */
export function selectPool(requirements: SubmissionRequirements): string {
  const { language, memoryMb, cpuCores, timeoutSec, trustLevel } = requirements;
  
  // Admin users can use trusted pool for any language
  if (trustLevel === 'admin') {
    return 'trusted';
  }
  
  // Verified users with high resource needs use trusted pool
  if (trustLevel === 'verified' && memoryMb > 1024) {
    return 'trusted';
  }
  
  // Find matching pools
  const matchingPools = Object.values(POOLS)
    .filter(pool => {
      // Check language support
      if (!pool.languages.includes('*') && !pool.languages.includes(language.toLowerCase())) {
        return false;
      }
      
      // Check resource limits
      if (memoryMb > pool.maxMemoryMb) return false;
      if (cpuCores > pool.maxCpuCores) return false;
      if (timeoutSec > pool.maxTimeoutSec) return false;
      
      // Don't use trusted pool for standard users or undefined trust level
      if (pool.name === 'trusted') {
        if (trustLevel === undefined || trustLevel === 'standard') {
          return false;
        }
        // Only verified and admin can use trusted pool (already checked above)
      }
      
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
  
  if (matchingPools.length === 0) {
    // No pool can handle this request
    throw new Error(`No pool available for: language=${language}, memory=${memoryMb}MB, cpu=${cpuCores}, timeout=${timeoutSec}s`);
  }
  
  return matchingPools[0].name;
}

/**
 * Get Redis stream key for a pool
 */
export function getPoolStreamKey(pool: string): string {
  return `code-execution-jobs:${pool}`;
}

/**
 * Get pool configuration by name
 */
export function getPoolConfig(pool: string): PoolConfig {
  const config = POOLS[pool];
  if (!config) {
    throw new Error(`Unknown pool: ${pool}`);
  }
  return config;
}

/**
 * Get worker configuration by pool name
 */
export function getWorkerConfig(pool: string): WorkerConfig {
  const config = WORKER_CONFIGS[pool];
  if (!config) {
    throw new Error(`Unknown pool: ${pool}`);
  }
  return config;
}

// =============================================================================
// Language to Pool Mapping (quick lookup)
// =============================================================================

export const LANGUAGE_POOL_MAP: Record<string, string> = {
  // Container pool (interpreted, sandboxed)
  javascript: 'container',
  typescript: 'container',
  python: 'container',
  ruby: 'container',
  php: 'container',
  
  // MicroVM pool (compiled, stronger isolation)
  c: 'microvm',
  cpp: 'microvm',
  java: 'microvm',
  rust: 'microvm',
  go: 'microvm',
};

/**
 * Quick pool lookup by language (ignores resource requirements)
 */
export function getDefaultPoolForLanguage(language: string): string {
  return LANGUAGE_POOL_MAP[language.toLowerCase()] || 'container';
}

// =============================================================================
// Concurrency Configuration
// =============================================================================

export interface ConcurrencyConfig {
  /** Maximum concurrent jobs across all pools */
  globalMaxConcurrent: number;
  /** Per-user concurrent submission limit */
  perUserMaxConcurrent: number;
  /** Per-problem concurrent submission limit */
  perProblemMaxConcurrent: number;
  /** Queue depth before shedding low-priority jobs */
  queueDepthThreshold: number;
  /** Queue depth for recovery */
  queueRecoveryThreshold: number;
}

export const CONCURRENCY_CONFIG: ConcurrencyConfig = {
  globalMaxConcurrent: 1000,
  perUserMaxConcurrent: 5,
  perProblemMaxConcurrent: 50,
  queueDepthThreshold: 500,
  queueRecoveryThreshold: 200,
};

// =============================================================================
// Rate Limiting Configuration
// =============================================================================

export interface RateLimitConfig {
  /** Submissions per user per minute */
  userSubmissionsPerMinute: number;
  /** Submissions per IP per minute */
  ipSubmissionsPerMinute: number;
  /** Global submissions per second */
  globalSubmissionsPerSecond: number;
  /** Burst capacity multiplier */
  burstMultiplier: number;
}

export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  userSubmissionsPerMinute: 10,
  ipSubmissionsPerMinute: 20,
  globalSubmissionsPerSecond: 100,
  burstMultiplier: 2,  // Allow 2x burst
};

// =============================================================================
// Autoscaling Configuration
// =============================================================================

export interface AutoscalingConfig {
  pool: string;
  minReplicas: number;
  maxReplicas: number;
  targetQueueDepthPerWorker: number;
  targetCpuUtilization: number;
  scaleUpCooldownSec: number;
  scaleDownCooldownSec: number;
}

export const AUTOSCALING_CONFIGS: AutoscalingConfig[] = [
  {
    pool: 'container',
    minReplicas: 2,
    maxReplicas: 100,
    targetQueueDepthPerWorker: 10,
    targetCpuUtilization: 70,
    scaleUpCooldownSec: 30,
    scaleDownCooldownSec: 300,
  },
  {
    pool: 'microvm',
    minReplicas: 1,
    maxReplicas: 50,
    targetQueueDepthPerWorker: 5,
    targetCpuUtilization: 60,
    scaleUpCooldownSec: 60,
    scaleDownCooldownSec: 600,
  },
  {
    pool: 'trusted',
    minReplicas: 1,
    maxReplicas: 10,
    targetQueueDepthPerWorker: 3,
    targetCpuUtilization: 50,
    scaleUpCooldownSec: 60,
    scaleDownCooldownSec: 600,
  },
];

export default {
  POOLS,
  WORKER_CONFIGS,
  LANGUAGE_POOL_MAP,
  CONCURRENCY_CONFIG,
  RATE_LIMIT_CONFIG,
  AUTOSCALING_CONFIGS,
  selectPool,
  getPoolConfig,
  getWorkerConfig,
  getDefaultPoolForLanguage,
  getPoolStreamKey,
};

