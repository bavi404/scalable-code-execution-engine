# Deployment Guide

This guide covers setting up the code execution engine with PostgreSQL, Redis, and S3.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Redis 7+
- AWS S3 or MinIO (S3-compatible storage)

## 1. Database Setup

### Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**macOS:**
```bash
brew install postgresql@14
brew services start postgresql@14
```

**Windows:**
Download and install from [PostgreSQL Downloads](https://www.postgresql.org/download/windows/)

### Create Database

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE code_execution;
CREATE USER code_exec_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE code_execution TO code_exec_user;
\q
```

### Run Schema

```bash
# From project root
psql -U postgres -d code_execution -f db/schema.sql

# Or using npm script
npm run db:setup
```

### Verify Setup

```bash
psql -U postgres -d code_execution -c "\dt"
```

You should see tables: `submissions`, `problems`, `users`

## 2. Redis Setup

### Install Redis

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Windows:**
Download from [Redis Downloads](https://redis.io/download) or use WSL

### Verify Redis

```bash
redis-cli ping
# Should return: PONG
```

### Configure Redis (Optional)

Edit `/etc/redis/redis.conf`:

```conf
# Increase max memory
maxmemory 2gb
maxmemory-policy allkeys-lru

# Enable persistence
save 900 1
save 300 10
save 60 10000
```

Restart Redis:
```bash
sudo systemctl restart redis-server
```

## 3. S3 Setup

### Option A: AWS S3

1. **Create S3 Bucket:**
   - Go to [AWS S3 Console](https://console.aws.amazon.com/s3/)
   - Create bucket: `code-submissions`
   - Region: `us-east-1` (or your preferred region)
   - Block public access: Enable
   - Versioning: Optional
   - Encryption: Enable (AES-256)

2. **Create IAM User:**
   - Go to [IAM Console](https://console.aws.amazon.com/iam/)
   - Create user: `code-execution-s3`
   - Attach policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::code-submissions",
           "arn:aws:s3:::code-submissions/*"
         ]
       }
     ]
   }
   ```
   - Generate access keys
   - Save `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

### Option B: MinIO (Self-hosted S3-compatible)

1. **Install MinIO:**
```bash
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/
```

2. **Run MinIO:**
```bash
# Create data directory
mkdir -p ~/minio/data

# Start MinIO
minio server ~/minio/data --console-address ":9001"
```

3. **Configure:**
   - Access console: `http://localhost:9001`
   - Default credentials: `minioadmin` / `minioadmin`
   - Create bucket: `code-submissions`
   - Create access key

4. **Update `.env`:**
```bash
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=your_minio_access_key
AWS_SECRET_ACCESS_KEY=your_minio_secret_key
```

## 4. Application Setup

### Install Dependencies

```bash
npm install
```

### Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Verify Configuration

Create `scripts/verify-config.ts`:

```typescript
import { getPool } from '../lib/db';
import { getRedisClient } from '../lib/redis';
import { validateS3Config } from '../lib/s3';

async function verify() {
  console.log('Verifying configuration...\n');

  // Test PostgreSQL
  try {
    const pool = getPool();
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected:', result.rows[0].now);
  } catch (error) {
    console.error('❌ PostgreSQL failed:', error);
  }

  // Test Redis
  try {
    const redis = await getRedisClient();
    const pong = await redis.ping();
    console.log('✅ Redis connected:', pong);
  } catch (error) {
    console.error('❌ Redis failed:', error);
  }

  // Test S3
  const s3Config = validateS3Config();
  if (s3Config.valid) {
    console.log('✅ S3 configuration valid');
  } else {
    console.error('❌ S3 configuration invalid:', s3Config.error);
  }

  process.exit(0);
}

verify();
```

Run verification:
```bash
ts-node scripts/verify-config.ts
```

## 5. Run Application

### Development

```bash
npm run dev
```

Visit: `http://localhost:3000`

### Production

```bash
# Build
npm run build

# Start
npm start
```

## 6. Docker Deployment (Optional)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: code_execution
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/schema.sql:/docker-entrypoint-initdb.d/schema.sql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: code_execution
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      AWS_ACCESS_KEY_ID: minioadmin
      AWS_SECRET_ACCESS_KEY: minioadmin
      S3_BUCKET_NAME: code-submissions
    depends_on:
      - postgres
      - redis
      - minio

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

Run with Docker:
```bash
docker-compose up -d
```

## 7. Testing the API

### Test Submission

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "code": "console.log(\"Hello, World!\");",
    "language": "javascript",
    "problemId": "problem-1",
    "userId": "user-123"
  }'
```

Expected response:
```json
{
  "success": true,
  "message": "Code submitted successfully",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2025-12-01T00:00:00.000Z"
}
```

### Verify in Database

```bash
psql -U postgres -d code_execution -c "SELECT * FROM submissions;"
```

### Check Redis Stream

```bash
redis-cli XLEN code-execution-jobs
redis-cli XRANGE code-execution-jobs - +
```

### Check S3

**AWS:**
```bash
aws s3 ls s3://code-submissions/submissions/
```

**MinIO:**
```bash
mc ls minio/code-submissions/submissions/
```

## 8. Monitoring

### Database Queries

```sql
-- Total submissions
SELECT COUNT(*) FROM submissions;

-- Submissions by status
SELECT status, COUNT(*) FROM submissions GROUP BY status;

-- Recent submissions
SELECT id, user_id, problem_id, language, status, submitted_at 
FROM submissions 
ORDER BY submitted_at DESC 
LIMIT 10;
```

### Redis Monitoring

```bash
# Stream length
redis-cli XLEN code-execution-jobs

# Stream info
redis-cli XINFO STREAM code-execution-jobs

# Monitor real-time
redis-cli MONITOR
```

## 9. Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check connection
psql -U postgres -d code_execution
```

### Redis Connection Failed

```bash
# Check Redis status
sudo systemctl status redis-server

# Test connection
redis-cli ping
```

### S3 Upload Failed

- Verify credentials in `.env`
- Check bucket exists and permissions
- For MinIO: verify endpoint URL

### Large Payload Error

Increase Next.js body size limit in `pages/api/submit.ts`:

```typescript
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Adjust as needed
    },
  },
};
```

## 10. Security Recommendations

1. **Use strong passwords** for PostgreSQL and Redis
2. **Enable SSL/TLS** for all connections in production
3. **Restrict S3 bucket access** to specific IAM roles
4. **Use environment variables** for all secrets (never commit `.env`)
5. **Enable rate limiting** on API endpoints
6. **Implement authentication** for submission endpoints
7. **Regular backups** of PostgreSQL database
8. **Monitor S3 costs** and set lifecycle policies

## 11. Scaling

### Horizontal Scaling

- Run multiple Next.js instances behind load balancer
- Use managed PostgreSQL (AWS RDS, Google Cloud SQL)
- Use managed Redis (AWS ElastiCache, Redis Cloud)
- Use CDN for static assets

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX CONCURRENTLY idx_submissions_user_status 
  ON submissions(user_id, status) WHERE status IN ('pending', 'queued');

-- Partition large tables
CREATE TABLE submissions_2025_01 PARTITION OF submissions
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

### Redis Optimization

- Use Redis Cluster for high availability
- Set appropriate `maxmemory` and eviction policies
- Monitor memory usage

## Support

For issues, check:
- Application logs: `tail -f .next/server.log`
- PostgreSQL logs: `/var/log/postgresql/`
- Redis logs: `/var/log/redis/`


