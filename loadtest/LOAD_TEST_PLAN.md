# Load Test Plan for Code Execution Engine

## Overview

This document outlines the load testing strategy for the code execution engine, covering burst tests, sustained load tests, and compilation-heavy stress tests.

## Test Scenarios

### Scenario 1: Burst Test (1000 submissions in 1 minute)

**Objective:** Test system behavior under sudden traffic spikes.

**Configuration:**
- Total requests: 1000
- Duration: 60 seconds
- Target RPS: ~16.7 (peak may be higher)
- Language distribution: Python (40%), JavaScript (25%), C++ (20%), Java (10%), Others (5%)

**k6 Command:**
```bash
k6 run loadtest/k6/burst-only.js
```

**Locust Command:**
```bash
locust -f loadtest/locust/locustfile.py \
  --host=http://localhost:3000 \
  --headless \
  -u 50 -r 50 \
  --run-time 1m \
  -T burst
```

**Success Criteria:**
| Metric | Target |
|--------|--------|
| Success Rate | > 95% |
| P95 Latency | < 3 seconds |
| P99 Latency | < 5 seconds |
| Error Rate | < 5% |

---

### Scenario 2: Sustained Load (100 RPS for 10 minutes)

**Objective:** Verify system stability under continuous load.

**Configuration:**
- Target RPS: 100
- Duration: 10 minutes
- Total requests: ~60,000
- Language distribution: Python (35%), JavaScript (30%), C++ (15%), Java (15%), Others (5%)

**k6 Command:**
```bash
k6 run loadtest/k6/sustained-100rps.js
```

**Locust Command:**
```bash
locust -f loadtest/locust/locustfile.py \
  --host=http://localhost:3000 \
  --headless \
  -u 50 -r 10 \
  --run-time 10m \
  -T mixed
```

**Success Criteria:**
| Metric | Target |
|--------|--------|
| Achieved RPS | >= 95 |
| Success Rate | > 95% |
| P95 Latency | < 5 seconds |
| P99 Latency | < 10 seconds |
| Queue Depth | Stable (not growing) |

---

### Scenario 3: Compilation Stress Test

**Objective:** Stress test the compilation pipeline with complex compiled language submissions.

**Configuration:**
- Duration: 8 minutes
- Ramping profile: 10 → 40 → 60 → 80 → 100 → 60 → 20 RPS
- Language distribution: C++ (40%), C (25%), Java (20%), Rust (10%), Go (5%)
- Code complexity: Simple (30%), Medium (50%), Complex (20%)

**k6 Command:**
```bash
k6 run loadtest/k6/compilation-stress.js
```

**Locust Command:**
```bash
locust -f loadtest/locust/locustfile.py \
  --host=http://localhost:3000 \
  --headless \
  -u 100 -r 10 \
  --run-time 8m \
  -T compilation
```

**Success Criteria:**
| Metric | Target |
|--------|--------|
| Success Rate | > 90% |
| P95 Latency (Simple) | < 5 seconds |
| P95 Latency (Medium) | < 8 seconds |
| P95 Latency (Complex) | < 15 seconds |
| Compilation Errors | < 5% of requests |

---

## Complete Test Suite

Run all scenarios sequentially:

```bash
# k6 - All scenarios
k6 run loadtest/k6/scenarios.js

# Or run individually with custom environment
BASE_URL=https://api.example.com k6 run loadtest/k6/scenarios.js
```

### Timeline for Full Test Suite

```
Time (minutes)  | Scenario
----------------|---------------------------
0-1             | Burst Test (1000 in 1m)
2-12            | Sustained Load (100 RPS)
13-21           | Compilation Stress
22-52           | Soak Test (50 RPS, 30m)
```

---

## Pre-Test Checklist

### Environment Setup

- [ ] Target API is accessible
- [ ] Redis is running and healthy
- [ ] PostgreSQL is running and healthy
- [ ] Worker fleet is scaled appropriately
- [ ] Prometheus/Grafana monitoring is active

### Configuration Verification

```bash
# Verify API health
curl http://localhost:3000/health

# Check Redis connection
redis-cli ping

# Verify worker count
kubectl get pods -l app=code-execution-worker

# Check queue depth (should be ~0 before test)
redis-cli XLEN code-execution-jobs:container
```

### Scaling Recommendations

| Scenario | Min Workers | Recommended |
|----------|-------------|-------------|
| Burst | 10 | 20 |
| Sustained 100 RPS | 20 | 30 |
| Compilation Stress | 15 | 25 |
| Soak Test | 15 | 20 |

---

## Metrics to Monitor

### During Tests

1. **API Metrics**
   - `http_req_duration` - Response time percentiles
   - `http_req_failed` - Error rate
   - `http_reqs` - Request rate

2. **Queue Metrics**
   - `code_execution_queue_depth` - Jobs waiting
   - `code_execution_queue_wait_seconds` - Time in queue

3. **Worker Metrics**
   - `code_execution_active_jobs` - Currently processing
   - `code_execution_workers` - Available workers
   - `code_execution_job_duration_seconds` - Execution time

4. **System Metrics**
   - CPU utilization (workers, API servers)
   - Memory usage
   - Network I/O

### Grafana Dashboard Panels

1. Request rate vs. target rate
2. Response time percentiles (P50, P90, P95, P99)
3. Error rate over time
4. Queue depth over time
5. Worker utilization
6. Language distribution

---

## Interpreting Results

### Success Indicators

✅ **Healthy System:**
- P95 latency stable and within targets
- Error rate < 5%
- Queue depth remains stable (not growing)
- Worker utilization 60-80%

### Warning Signs

⚠️ **Potential Issues:**
- P95 latency increasing over time
- Error rate > 5%
- Queue depth growing continuously
- Worker utilization > 90%

### Failure Indicators

❌ **System Problems:**
- P95 latency > 10x target
- Error rate > 20%
- Queue depth growing exponentially
- Workers crashing/restarting

---

## Post-Test Analysis

### Generate Reports

```bash
# k6 - Generate HTML report
k6 run --out json=results.json loadtest/k6/scenarios.js
# Use k6-reporter to convert JSON to HTML

# Locust - CSV reports are generated automatically
locust -f locustfile.py --csv=results --headless
```

### Key Questions to Answer

1. **Did we meet SLOs?**
   - P95 latency within targets?
   - Success rate above thresholds?

2. **Where are the bottlenecks?**
   - API layer (high response times)?
   - Queue (growing depth)?
   - Workers (high utilization)?
   - Database (slow queries)?

3. **Scaling recommendations?**
   - How many workers needed for target RPS?
   - What's the optimal concurrency per worker?

---

## Appendix: Quick Reference Commands

### k6

```bash
# Basic run
k6 run script.js

# With custom options
k6 run --vus 50 --duration 5m script.js

# With environment variables
BASE_URL=https://api.example.com k6 run script.js

# Output to multiple formats
k6 run --out json=results.json --out csv=results.csv script.js

# Cloud run (k6 Cloud)
k6 cloud script.js
```

### Locust

```bash
# Web UI mode
locust -f locustfile.py --host=http://localhost:3000

# Headless mode
locust -f locustfile.py --headless -u 100 -r 10 --run-time 10m

# Distributed mode (master)
locust -f locustfile.py --master

# Distributed mode (worker)
locust -f locustfile.py --worker --master-host=192.168.1.100

# With specific tags
locust -f locustfile.py -T compilation
```

### Result Analysis

```bash
# Parse k6 JSON results
cat results.json | jq '.metrics.http_req_duration.values'

# View Locust CSV
head -20 results_stats.csv
```

