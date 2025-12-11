# 🚀 Simplest Deployment (Free Forever)

## Use Supabase (Free) + Fly.io (Free)

### Step 1: Setup Supabase (Free Database + Storage)

1. Go to https://supabase.com
2. Sign up (free)
3. Create new project
4. Wait ~2 minutes for setup

**Get your credentials:**
- Go to Settings → Database
- Copy: Host, Database name, User, Password
- Go to Settings → API
- Copy: anon/public key (for storage)

**Setup Storage:**
- Go to Storage → Create bucket: `code-submissions`
- Make it public (or use API keys)

**Run Database Schema:**
- Go to SQL Editor
- Copy contents of `db/schema.sql`
- Paste and run

### Step 2: Deploy to Fly.io

```bash
# Login (already done)
fly auth login

# Create app
fly launch --no-deploy --name code-exec-demo

# Set secrets (replace with your Supabase values)
fly secrets set \
  POSTGRES_HOST=db.xxxxx.supabase.co \
  POSTGRES_PORT=5432 \
  POSTGRES_DB=postgres \
  POSTGRES_USER=postgres \
  POSTGRES_PASSWORD=your-supabase-password \
  REDIS_URL=redis://default:password@redis.upstash.io:6379 \
  S3_ENDPOINT=https://xxxxx.supabase.co \
  AWS_ACCESS_KEY_ID=your-supabase-anon-key \
  AWS_SECRET_ACCESS_KEY=your-supabase-anon-key \
  S3_BUCKET_NAME=code-submissions \
  AWS_REGION=us-east-1 \
  NODE_ENV=production

# Deploy
fly deploy
```

### Step 3: Get Free Redis (Upstash)

1. Go to https://upstash.com
2. Sign up (free: 10K commands/day)
3. Create Redis database
4. Copy Redis URL
5. Update Fly secrets with Redis URL

### Step 4: Done!

Your app: `https://code-exec-demo.fly.dev`

**Total Cost: $0/month forever!**


