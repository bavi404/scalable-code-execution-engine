# 🚀 Quick Deploy to Fly.io (Free Forever)

## Step 1: Login to Fly.io

```bash
fly auth login
```

If you don't have an account, run:
```bash
fly auth signup
```

## Step 2: Create Database & Redis

```bash
# Create PostgreSQL (takes ~2 minutes)
fly postgres create --name code-exec-db --region iad --vm-size shared-cpu-1x --volume-size 3

# Create Redis
fly redis create --name code-exec-redis --region iad --plan free
```

## Step 3: Get Connection Details

```bash
# Get database connection
fly postgres connect --app code-exec-db

# Get Redis URL
fly redis status --app code-exec-redis
```

Save these - you'll need them!

## Step 4: Deploy Web App

```bash
# Initialize app (if not done)
fly launch --no-deploy --name code-exec-web

# Set secrets (you'll need to provide S3 credentials)
fly secrets set \
  POSTGRES_HOST=your-db-host \
  POSTGRES_PASSWORD=your-db-password \
  REDIS_URL=your-redis-url \
  S3_ENDPOINT=https://your-s3-endpoint \
  AWS_ACCESS_KEY_ID=your-key \
  AWS_SECRET_ACCESS_KEY=your-secret \
  S3_BUCKET_NAME=code-submissions \
  NODE_ENV=production

# Deploy
fly deploy
```

## Step 5: Setup Database Schema

```bash
fly postgres connect --app code-exec-db
# Then run: \i db/schema.sql
```

## Step 6: Your App is Live!

Visit: `https://code-exec-web.fly.dev`

---

**Note**: For S3 storage, use:
- **Supabase Storage** (free, 500MB): https://supabase.com
- **AWS S3 Free Tier** (5GB for 12 months): https://aws.amazon.com/s3


