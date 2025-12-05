# Infrastructure Architecture

## Overview

This document describes the deployment architecture for the scalable code execution engine, including worker fleet autoscaling, execution pool selection, and backpressure patterns.

## Architecture Diagram

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                    Load Balancer (ALB)                       │
                                    └──────────────────────────┬──────────────────────────────────┘
                                                               │
                                    ┌──────────────────────────▼──────────────────────────────────┐
                                    │                     API Gateway                              │
                                    │  • Rate Limiting (Token Bucket)                              │
                                    │  • Request Validation                                        │
                                    │  • Authentication                                            │
                                    └──────────────────────────┬──────────────────────────────────┘
                                                               │
                    ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
                    │                                          │                                          │
          ┌─────────▼─────────┐                    ┌───────────▼───────────┐                    ┌─────────▼─────────┐
          │   Web Frontend    │                    │     Submit API        │                    │   Results API     │
          │   (Next.js)       │                    │   (Next.js/Express)   │                    │                   │
          └───────────────────┘                    └───────────┬───────────┘                    └─────────▲─────────┘
                                                               │                                          │
                                                               │ POST /api/submit                         │
                                                               ▼                                          │
                                    ┌──────────────────────────────────────────────────────────┐          │
                                    │                     PostgreSQL                            │──────────┤
                                    │  • Submission records                                     │          │
                                    │  • User/Problem metadata                                  │          │
                                    └──────────────────────────────────────────────────────────┘          │
                                                               │                                          │
                         Upload code                           │ Insert record                            │
                              │                                │                                          │
                              ▼                                ▼                                          │
          ┌───────────────────────────────────┐    ┌───────────────────────────────────┐                  │
          │              S3                    │    │         Redis Cluster              │                  │
          │  • Code storage                    │    │  • Job queue (Streams)             │                  │
          │  • Test case storage               │    │  • Rate limiting                   │                  │
          │  • Result artifacts                │    │  • Submission token bucket         │                  │
          └───────────────────────────────────┘    └─────────────────┬─────────────────┘                  │
                              │                                      │                                     │
                              │                    ┌─────────────────┴─────────────────┐                   │
                              │                    │           Job Router               │                   │
                              │                    │  • Language-based routing          │                   │
                              │                    │  • Resource-based pool selection   │                   │
                              │                    └─────────────────┬─────────────────┘                   │
                              │                                      │                                     │
                              │           ┌──────────────────────────┼──────────────────────────┐          │
                              │           │                          │                          │          │
                              │  ┌────────▼────────┐      ┌──────────▼──────────┐    ┌─────────▼─────────┐│
                              │  │ Container Pool  │      │    MicroVM Pool     │    │  Trusted Pool     ││
                              │  │ (Docker/gVisor) │      │   (Firecracker)     │    │  (No sandbox)     ││
                              │  │                 │      │                     │    │                   ││
                              │  │ Languages:      │      │ Languages:          │    │ Languages:        ││
                              │  │ • JavaScript    │      │ • C/C++             │    │ • Internal only   ││
                              │  │ • Python        │      │ • Java (untrusted)  │    │                   ││
                              │  │ • Ruby          │      │ • Rust (untrusted)  │    │                   ││
                              │  │ • PHP           │      │ • Go (untrusted)    │    │                   ││
                              │  │                 │      │                     │    │                   ││
                              │  │ Max: 256MB RAM  │      │ Max: 1GB RAM        │    │ Max: 2GB RAM      ││
                              │  │ Timeout: 10s    │      │ Timeout: 30s        │    │ Timeout: 60s      ││
                              │  └────────┬────────┘      └──────────┬──────────┘    └─────────┬─────────┘│
                              │           │                          │                          │          │
                              │           └──────────────────────────┴──────────────────────────┘          │
                              │                                      │                                     │
                              │                          ┌───────────▼───────────┐                         │
                              └─────────────────────────▶│      Judge Module     │─────────────────────────┘
                                                         │  • Output comparison  │
                                                         │  • Score calculation  │
                                                         └───────────────────────┘
```

## Execution Pool Selection

### Decision Matrix

| Criteria | Container Pool | MicroVM Pool | Trusted Pool |
|----------|---------------|--------------|--------------|
| **Languages** | JS, Python, Ruby, PHP | C, C++, Java, Rust, Go | Internal/admin |
| **Memory Request** | ≤256MB | >256MB or ≤1GB | >1GB |
| **CPU Request** | ≤0.5 vCPU | >0.5 vCPU | Any |
| **Trust Level** | Standard | Untrusted/compiled | Verified only |
| **Network Access** | None | None | Optional |
| **Isolation** | Namespace + cgroups | Hardware VM | Process |
| **Cold Start** | ~100ms | ~150ms (snapshot) | ~50ms |
| **Cost** | $ | $$ | $$$ |

### Pool Selection Algorithm

```python
def select_pool(submission):
    language = submission.language
    memory_mb = submission.memory_limit_kb / 1024
    cpu_cores = submission.cpu_limit or 0.5
    trust_level = get_user_trust_level(submission.user_id)
    
    # Trusted users with verified code
    if trust_level == 'verified' and memory_mb > 1024:
        return 'trusted'
    
    # Compiled languages need stronger isolation
    compiled_languages = ['c', 'cpp', 'java', 'rust', 'go']
    if language in compiled_languages:
        return 'microvm'
    
    # High resource requests
    if memory_mb > 256 or cpu_cores > 0.5:
        return 'microvm'
    
    # Default: container pool
    return 'container'
```

## Autoscaling Strategy

### Metrics for Scaling

1. **Queue Depth**: Number of pending jobs in Redis Stream
2. **Processing Latency**: P95 job processing time
3. **Worker Utilization**: CPU/Memory usage per worker
4. **Error Rate**: Failed executions percentage

### Scaling Rules

```yaml
# Container Pool
container_pool:
  min_replicas: 2
  max_replicas: 100
  scale_up:
    - metric: queue_depth
      threshold: 10
      action: +2 replicas
      cooldown: 30s
    - metric: p95_latency_ms
      threshold: 5000
      action: +5 replicas
      cooldown: 60s
  scale_down:
    - metric: queue_depth
      threshold: 2
      action: -1 replica
      cooldown: 300s
    - metric: worker_idle_time
      threshold: 300s
      action: -1 replica
      cooldown: 120s

# MicroVM Pool
microvm_pool:
  min_replicas: 1
  max_replicas: 50
  scale_up:
    - metric: queue_depth
      threshold: 5
      action: +1 replica
      cooldown: 60s
  scale_down:
    - metric: queue_depth
      threshold: 0
      action: -1 replica
      cooldown: 600s
```

## Concurrency Limits

### Per-Worker Limits

| Pool Type | Max Concurrent Jobs | Reason |
|-----------|---------------------|--------|
| Container | 4-8 | Shared resources, fast jobs |
| MicroVM | 1-2 | VM overhead, isolation |
| Trusted | 2-4 | Higher resource allocation |

### Implementation

```typescript
const CONCURRENCY_CONFIG = {
  container: {
    maxConcurrent: 8,
    memoryPerJob: 256,      // MB
    cpuPerJob: 0.25,        // vCPU
    timeoutMs: 10000,
  },
  microvm: {
    maxConcurrent: 2,
    memoryPerJob: 512,      // MB
    cpuPerJob: 0.5,         // vCPU
    timeoutMs: 30000,
  },
  trusted: {
    maxConcurrent: 4,
    memoryPerJob: 1024,     // MB
    cpuPerJob: 1.0,         // vCPU
    timeoutMs: 60000,
  },
};
```

## Backpressure Patterns

### 1. Token Bucket for Submissions

Limits submission rate per user/IP:

```
Bucket Size: 10 tokens
Refill Rate: 2 tokens/second
Cost per Submission: 1 token

Result: Max 10 burst, sustained 2/sec
```

### 2. Rate-Limited Queue Reads

Workers read from queue with backpressure:

```
Read Batch Size: 5 jobs
Read Interval: 100ms (when busy)
Backoff on Error: Exponential (100ms → 30s)
```

### 3. Circuit Breaker

Stop processing when downstream is unhealthy:

```
Failure Threshold: 5 consecutive failures
Recovery Time: 30 seconds
Half-Open Requests: 1
```

### 4. Load Shedding

Drop low-priority jobs when overloaded:

```
Queue Depth Threshold: 1000
Shed Priority: low → normal (keep high)
Recovery: Resume when queue < 500
```

## Cost Optimization

### Spot/Preemptible Instances

- **Container Pool**: 80% Spot, 20% On-Demand
- **MicroVM Pool**: 60% Spot, 40% On-Demand
- **Trusted Pool**: 100% On-Demand

### Right-Sizing

| Instance Type | Pool | Workers/Instance |
|---------------|------|------------------|
| c6i.large (2 vCPU, 4GB) | Container | 8 |
| c6i.xlarge (4 vCPU, 8GB) | Container | 16 |
| m6i.large (2 vCPU, 8GB) | MicroVM | 4 |
| m6i.xlarge (4 vCPU, 16GB) | MicroVM | 8 |

## Monitoring & Alerting

### Key Metrics

1. **queue_depth** - Jobs waiting in Redis
2. **processing_time_p95** - 95th percentile execution time
3. **worker_utilization** - CPU/Memory per worker
4. **error_rate** - Failed executions / total
5. **cold_start_time** - Time to start new worker

### Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Queue Depth | >100 for 5min | Warning |
| Very High Queue Depth | >500 for 5min | Critical |
| High Error Rate | >5% for 10min | Warning |
| Worker OOM | Memory >90% | Critical |
| Scaling Failure | Scale event failed | Critical |

