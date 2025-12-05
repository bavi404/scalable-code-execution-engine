# Worker Orchestration Guide

This document explains how the local Docker-based worker maps to production orchestration platforms like AWS ECS/Fargate, Google GKE, and Kubernetes.

## Architecture Overview

### Local Development (Docker)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Worker Node                               │
│  ┌─────────────────┐    ┌─────────────────────────────────┐     │
│  │   executor.ts   │    │     Docker Daemon                │     │
│  │   (Node.js)     │───▶│  ┌─────────────────────────┐    │     │
│  │                 │    │  │   code-runner container  │    │     │
│  │  - Redis client │    │  │  ┌─────────────────────┐│    │     │
│  │  - S3 client    │    │  │  │    runner.js        ││    │     │
│  │  - dockerode    │    │  │  │  (executes code)    ││    │     │
│  └────────┬────────┘    │  │  └─────────────────────┘│    │     │
│           │             │  │  /workspace (mounted)    │    │     │
│           │             │  └─────────────────────────┘    │     │
│           ▼             └─────────────────────────────────┘     │
│   ┌───────────────┐                                              │
│   │  tmpdir       │ ◀─── Ephemeral workspace                     │
│   │  /workspace   │                                              │
│   └───────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Production (AWS ECS/Fargate)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS ECS Cluster                                 │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           ECS Service                                   │ │
│  │                                                                         │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │ │
│  │  │   Fargate Task   │  │   Fargate Task   │  │   Fargate Task   │     │ │
│  │  │  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │     │ │
│  │  │  │  Worker    │  │  │  │  Worker    │  │  │  │  Worker    │  │     │ │
│  │  │  │ Container  │  │  │  │ Container  │  │  │  │ Container  │  │     │ │
│  │  │  └────────────┘  │  │  └────────────┘  │  │  └────────────┘  │     │ │
│  │  │  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │     │ │
│  │  │  │   Runner   │  │  │  │   Runner   │  │  │  │   Runner   │  │     │ │
│  │  │  │  (sidecar) │  │  │  │  (sidecar) │  │  │  │  (sidecar) │  │     │ │
│  │  │  └────────────┘  │  │  └────────────┘  │  │  └────────────┘  │     │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘     │ │
│  │                                                                         │ │
│  │  Auto Scaling: 2-50 tasks based on queue depth                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  ElastiCache    │  │      RDS        │  │       S3        │             │
│  │    (Redis)      │  │  (PostgreSQL)   │  │  (Code Storage) │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Local Development with Docker

### How It Works

1. **Worker Process** (`executor.ts`):
   - Runs as a Node.js process
   - Connects to Redis to claim jobs
   - Uses `dockerode` to interact with local Docker daemon
   - Creates containers from `code-runner` image

2. **Docker Integration**:
   - Uses Docker socket (`/var/run/docker.sock`)
   - Creates ephemeral containers per execution
   - Mounts workspace directory into container
   - Enforces resource limits via Docker

3. **Runner Container**:
   - Based on `code-runner:latest` image
   - Runs `runner.js` script
   - Executes code in isolated environment
   - Returns JSON result via stdout

### Local Setup

```bash
# 1. Build runner image
cd runner
docker build -t code-runner:latest .

# 2. Start worker
cd ..
npm run worker

# Or with ts-node directly
npx ts-node workers/executor.ts
```

### Environment Variables (Local)

```bash
export WORKER_NAME=worker-local-1
export CONSUMER_GROUP=execution-workers
export REDIS_URL=redis://localhost:6379
export DOCKER_SOCKET=/var/run/docker.sock
export RUNNER_IMAGE=code-runner:latest
export MAX_CONCURRENT_JOBS=2
```

---

## Production: AWS ECS/Fargate

### Architecture

In production, we replace local Docker with AWS Fargate tasks:

| Local Component | Production Equivalent |
|-----------------|----------------------|
| Worker process | ECS Task (worker container) |
| Docker container | Fargate sidecar container |
| Local tmpdir | EFS or ephemeral storage |
| Redis | ElastiCache Redis |
| Docker socket | ECS Task networking |

### ECS Task Definition

```json
{
  "family": "code-execution-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/codeExecutionTaskRole",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/code-execution-worker:latest",
      "essential": true,
      "environment": [
        { "name": "WORKER_NAME", "value": "fargate-worker" },
        { "name": "CONSUMER_GROUP", "value": "execution-workers" },
        { "name": "RUNNER_MODE", "value": "sidecar" }
      ],
      "secrets": [
        { "name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "AWS_ACCESS_KEY_ID", "valueFrom": "arn:aws:secretsmanager:..." }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/code-execution-worker",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "worker"
        }
      },
      "mountPoints": [
        {
          "sourceVolume": "workspace",
          "containerPath": "/workspace"
        }
      ]
    },
    {
      "name": "runner",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/code-runner:latest",
      "essential": false,
      "command": ["sleep", "infinity"],
      "mountPoints": [
        {
          "sourceVolume": "workspace",
          "containerPath": "/workspace"
        }
      ],
      "linuxParameters": {
        "capabilities": {
          "drop": ["ALL"]
        }
      },
      "resourceRequirements": [
        {
          "type": "MEMORY",
          "value": "512"
        }
      ]
    }
  ],
  "volumes": [
    {
      "name": "workspace",
      "host": {}
    }
  ]
}
```

### Modified Worker for ECS (Sidecar Mode)

Instead of creating Docker containers, the worker communicates with the sidecar:

```typescript
// workers/executor-ecs.ts

async function executeInSidecar(options: ExecutionOptions): Promise<ExecutionResult> {
  const { workspaceDir, language, codeFile, timeLimit, memoryLimit } = options;

  // Write code to shared volume
  await fs.writeFile(path.join(workspaceDir, codeFile), code);

  // Execute via docker exec to sidecar container
  // In ECS, use ECS Exec or a shared file-based protocol
  
  // Option 1: ECS Exec API
  const command = new ECSClient.ExecuteCommandCommand({
    cluster: process.env.ECS_CLUSTER,
    task: process.env.ECS_TASK_ARN,
    container: 'runner',
    command: `node /runner/runner.js`,
    interactive: false,
  });

  // Option 2: File-based protocol
  // Write job file to shared volume
  await fs.writeFile(path.join(workspaceDir, 'job.json'), JSON.stringify({
    language,
    codeFile,
    timeLimit,
    memoryLimit,
  }));

  // Wait for result file
  const resultPath = path.join(workspaceDir, 'result.json');
  const result = await waitForFile(resultPath, timeLimit + 5000);

  return JSON.parse(result);
}
```

### ECS Service Configuration

```yaml
# ecs-service.yaml (CloudFormation)
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  CodeExecutionService:
    Type: AWS::ECS::Service
    Properties:
      ServiceName: code-execution-workers
      Cluster: !Ref ECSCluster
      TaskDefinition: !Ref TaskDefinition
      DesiredCount: 2
      LaunchType: FARGATE
      NetworkConfiguration:
        AwsvpcConfiguration:
          Subnets:
            - !Ref PrivateSubnet1
            - !Ref PrivateSubnet2
          SecurityGroups:
            - !Ref WorkerSecurityGroup
      # Auto Scaling
      ServiceRegistries:
        - RegistryArn: !GetAtt ServiceDiscovery.Arn

  # Auto Scaling based on queue depth
  ScalableTarget:
    Type: AWS::ApplicationAutoScaling::ScalableTarget
    Properties:
      MaxCapacity: 50
      MinCapacity: 2
      ResourceId: !Sub service/${ECSCluster}/${CodeExecutionService.Name}
      ScalableDimension: ecs:service:DesiredCount
      ServiceNamespace: ecs

  ScalingPolicy:
    Type: AWS::ApplicationAutoScaling::ScalingPolicy
    Properties:
      PolicyName: QueueDepthScaling
      PolicyType: TargetTrackingScaling
      ScalingTargetId: !Ref ScalableTarget
      TargetTrackingScalingPolicyConfiguration:
        CustomizedMetricSpecification:
          MetricName: QueueDepth
          Namespace: CodeExecution
          Statistic: Average
        TargetValue: 10
        ScaleInCooldown: 60
        ScaleOutCooldown: 30
```

### Monitoring Queue Depth

```typescript
// cloudwatch-metrics.ts
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

async function publishQueueMetrics() {
  const redis = await getRedisClient();
  const streamInfo = await redis.xInfoStream('code-execution-jobs');
  
  const cloudwatch = new CloudWatch({ region: 'us-east-1' });
  
  await cloudwatch.putMetricData({
    Namespace: 'CodeExecution',
    MetricData: [
      {
        MetricName: 'QueueDepth',
        Value: streamInfo.length,
        Unit: 'Count',
      },
      {
        MetricName: 'PendingJobs',
        Value: streamInfo.groups?.[0]?.pending || 0,
        Unit: 'Count',
      },
    ],
  });
}

// Run every minute
setInterval(publishQueueMetrics, 60000);
```

---

## Production: Google GKE / Kubernetes

### Architecture

```yaml
# Kubernetes Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: code-execution-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: code-execution-worker
  template:
    metadata:
      labels:
        app: code-execution-worker
    spec:
      containers:
        # Worker container
        - name: worker
          image: gcr.io/PROJECT/code-execution-worker:latest
          env:
            - name: WORKER_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: redis-credentials
                  key: url
            - name: RUNNER_MODE
              value: "kubernetes"
          volumeMounts:
            - name: workspace
              mountPath: /workspace
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"

        # Runner sidecar
        - name: runner
          image: gcr.io/PROJECT/code-runner:latest
          command: ["sleep", "infinity"]
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: workspace
              mountPath: /workspace
          resources:
            requests:
              cpu: "500m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"

      volumes:
        - name: workspace
          emptyDir:
            medium: Memory
            sizeLimit: 100Mi

      # Security
      securityContext:
        fsGroup: 1000
      
      # Pod disruption budget
      terminationGracePeriodSeconds: 30
```

### Kubernetes HPA (Auto Scaling)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: code-execution-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: code-execution-worker
  minReplicas: 2
  maxReplicas: 50
  metrics:
    - type: External
      external:
        metric:
          name: redis_stream_length
          selector:
            matchLabels:
              stream: code-execution-jobs
        target:
          type: AverageValue
          averageValue: "10"
```

### Using Kubernetes Jobs (Alternative)

Instead of sidecar, spawn Kubernetes Jobs per execution:

```typescript
// workers/executor-k8s.ts
import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const batchApi = kc.makeApiClient(k8s.BatchV1Api);

async function executeInKubernetesJob(options: ExecutionOptions): Promise<ExecutionResult> {
  const jobName = `code-exec-${options.submissionId}`;

  const job: k8s.V1Job = {
    metadata: { name: jobName },
    spec: {
      ttlSecondsAfterFinished: 60,
      activeDeadlineSeconds: Math.ceil(options.timeLimit / 1000) + 30,
      template: {
        spec: {
          restartPolicy: 'Never',
          containers: [{
            name: 'runner',
            image: 'gcr.io/PROJECT/code-runner:latest',
            env: [
              { name: 'LANGUAGE', value: options.language },
              { name: 'CODE_FILE', value: options.codeFile },
              { name: 'TIMEOUT_MS', value: String(options.timeLimit) },
            ],
            resources: {
              limits: {
                memory: `${Math.ceil(options.memoryLimit / 1024)}Mi`,
                cpu: '500m',
              },
            },
            volumeMounts: [{
              name: 'code',
              mountPath: '/workspace',
            }],
          }],
          volumes: [{
            name: 'code',
            configMap: {
              name: `code-${options.submissionId}`,
            },
          }],
        },
      },
    },
  };

  // Create job
  await batchApi.createNamespacedJob('code-execution', job);

  // Wait for completion
  const result = await waitForJobCompletion(jobName, options.timeLimit + 30000);

  // Get logs
  const logs = await getPodLogs(jobName);

  // Cleanup
  await batchApi.deleteNamespacedJob(jobName, 'code-execution');

  return JSON.parse(logs);
}
```

---

## Security Considerations

### Container Security

| Security Feature | Local Docker | ECS/Fargate | Kubernetes |
|------------------|--------------|-------------|------------|
| Network isolation | `--network none` | Security Groups | Network Policies |
| Read-only root | `--read-only` | Task definition | SecurityContext |
| Drop capabilities | `--cap-drop ALL` | LinuxParameters | Capabilities |
| Non-root user | `--user runner` | Task definition | runAsNonRoot |
| Resource limits | `-m`, `--cpus` | Task resources | Resource limits |
| No privilege escalation | `--security-opt` | LinuxParameters | allowPrivilegeEscalation |

### Production Hardening

```yaml
# Kubernetes SecurityContext (recommended)
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
  capabilities:
    drop:
      - ALL

# Network Policy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: code-runner-isolation
spec:
  podSelector:
    matchLabels:
      app: code-runner
  policyTypes:
    - Ingress
    - Egress
  egress: []  # No egress allowed
  ingress: []  # No ingress allowed
```

---

## Comparison: Local vs Production

| Aspect | Local (Docker) | ECS/Fargate | GKE/Kubernetes |
|--------|----------------|-------------|----------------|
| **Container Creation** | dockerode API | ECS Task | K8s Job/Sidecar |
| **Workspace** | tmpdir mount | EFS/EBS | emptyDir |
| **Scaling** | Manual | ECS Auto Scaling | HPA |
| **Resource Limits** | Docker flags | Task definition | Resource specs |
| **Networking** | Bridge/None | VPC | CNI/NetworkPolicy |
| **Logs** | Docker logs | CloudWatch | Stackdriver/stdout |
| **Secrets** | Env vars | Secrets Manager | K8s Secrets |
| **Cost** | Fixed | Per-second | Per-second |

---

## Migration Path

### Step 1: Local Development
- Use `executor.ts` with dockerode
- Test with local Redis and S3

### Step 2: Docker Compose
- Run all services in containers
- Simulate production networking

### Step 3: AWS ECS
- Push images to ECR
- Deploy ECS service
- Configure ElastiCache and RDS

### Step 4: Kubernetes (Optional)
- Deploy to GKE or EKS
- Use HPA for scaling
- Implement network policies

---

## Environment Variables Reference

| Variable | Local | ECS | Kubernetes |
|----------|-------|-----|------------|
| `WORKER_NAME` | `worker-local-1` | Task ID | Pod name |
| `RUNNER_MODE` | `docker` | `sidecar` | `kubernetes` |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | N/A | N/A |
| `ECS_CLUSTER` | N/A | Cluster ARN | N/A |
| `K8S_NAMESPACE` | N/A | N/A | `code-execution` |
| `REDIS_URL` | `redis://localhost` | ElastiCache URL | Redis Service |
| `S3_ENDPOINT` | MinIO URL | AWS S3 | GCS or S3 |

---

## Recommended Production Setup

### AWS Stack
- **Compute**: ECS Fargate (serverless, auto-scaling)
- **Queue**: ElastiCache Redis Cluster
- **Database**: RDS PostgreSQL Multi-AZ
- **Storage**: S3 with lifecycle policies
- **Secrets**: AWS Secrets Manager
- **Monitoring**: CloudWatch + X-Ray

### GCP Stack
- **Compute**: GKE Autopilot
- **Queue**: Memorystore Redis
- **Database**: Cloud SQL PostgreSQL
- **Storage**: Cloud Storage
- **Secrets**: Secret Manager
- **Monitoring**: Cloud Monitoring + Trace

### Cost Optimization
1. Use Spot/Preemptible instances for workers
2. Set appropriate task sizes (don't over-provision)
3. Implement queue-based auto-scaling
4. Use S3 lifecycle rules to archive old code
5. Set TTL on Redis stream messages

