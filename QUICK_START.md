# Quick Start Guide

Get the code execution engine running in 5 minutes.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- AWS S3 account or MinIO

## 1. Install Dependencies

```bash
npm install
```

## 2. Setup PostgreSQL

```bash
# Create database
createdb code_execution

# Run schema
psql -d code_execution -f db/schema.sql
```

## 3. Setup Redis

```bash
# Start Redis (if not running)
redis-server

# Verify
redis-cli ping  # Should return PONG
```

## 4. Setup S3 (Choose One)

### Option A: AWS S3

1. Create bucket: `code-submissions`
2. Create IAM user with S3 access
3. Save credentials

### Option B: MinIO (Local)

```bash
# Install MinIO
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Create data directory
mkdir -p ~/minio/data

# Start MinIO
minio server ~/minio/data --console-address ":9001"

# Access console at http://localhost:9001
# Default: minioadmin / minioadmin
# Create bucket: code-submissions
```

## 5. Configure Environment

```bash
# Copy example
cp env.local.example .env.local

# Edit with your credentials
nano .env.local
```

**Minimum required:**
```bash
POSTGRES_HOST=localhost
POSTGRES_DB=code_execution
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

REDIS_URL=redis://localhost:6379

AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=code-submissions

# For MinIO:
S3_ENDPOINT=http://localhost:9000
```

## 6. Run Application

```bash
npm run dev
```

Visit: **http://localhost:3000**

## 7. Test Submission

### Via UI

1. Go to http://localhost:3000
2. Write code in editor
3. Click "Submit"

### Via API

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "code": "console.log(\"Hello, World!\");",
    "language": "javascript",
    "problemId": "test-1",
    "userId": "user-1"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Code submitted successfully",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2025-12-01T12:00:00.000Z"
}
```

## 8. Verify Data

### Check Database

```bash
psql -d code_execution -c "SELECT id, user_id, problem_id, language, status FROM submissions;"
```

### Check Redis

```bash
redis-cli XLEN code-execution-jobs
redis-cli XRANGE code-execution-jobs - + COUNT 5
```

### Check S3

**AWS:**
```bash
aws s3 ls s3://code-submissions/submissions/
```

**MinIO:**
```bash
mc alias set myminio http://localhost:9000 minioadmin minioadmin
mc ls myminio/code-submissions/submissions/
```

## Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -U postgres -d code_execution -c "SELECT NOW();"
```

### Redis Connection Failed

```bash
# Check Redis is running
redis-cli ping

# If not running:
redis-server
```

### S3 Upload Failed

- Verify credentials in `.env.local`
- Check bucket exists
- For MinIO: verify endpoint is correct

### Port Already in Use

```bash
# Use different port
npm run dev -- -p 3001
```

## File Structure

```
├── db/
│   └── schema.sql          # PostgreSQL schema
├── lib/
│   ├── db.ts              # Database client
│   ├── s3.ts              # S3 client
│   └── redis.ts           # Redis client
├── pages/
│   ├── index.tsx          # Main page
│   ├── _app.tsx           # App wrapper
│   └── api/
│       └── submit.ts      # Submit API route
├── components/
│   ├── Editor.tsx         # Monaco Editor
│   └── OutputPanel.tsx    # Output panel
├── public/
│   └── worker.js          # Web Worker
├── .env.local             # Environment config (create this)
└── package.json           # Dependencies
```

## Default Limits

- Max code size: 10 MB
- Time limit: 5000 ms (5 seconds)
- Memory limit: 256 MB
- Supported languages: JavaScript, TypeScript, Python, Java, C++, C, Go, Rust, Ruby, PHP

## Supported Languages

When submitting, use these identifiers:

- `javascript`
- `typescript`
- `python`
- `java`
- `cpp`
- `c`
- `go`
- `rust`
- `ruby`
- `php`

## Docker Quick Start (Alternative)

```bash
# Coming soon: Docker Compose setup
docker-compose up -d
```

## Further Reading

- **API_DOCUMENTATION.md** - Complete API reference
- **DEPLOYMENT.md** - Production deployment guide
- **WORKER_IMPLEMENTATION.md** - Web Worker details
- **TEST_EXAMPLES.md** - Code test examples

## Support

For issues:
1. Check logs: `tail -f .next/server.log`
2. Verify environment: All services running?
3. Check configuration: `.env.local` correct?

## What's Next?

After getting it running:

1. ✅ Submit test code via UI
2. ✅ Verify in database
3. ✅ Check Redis queue
4. ✅ Verify S3 storage
5. 🚧 Implement worker to process jobs
6. 🚧 Add test case validation
7. 🚧 Deploy to production

---

**Ready to go!** 🚀


