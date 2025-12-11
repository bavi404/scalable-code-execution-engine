# 🚀 Deploy Now - Simple Steps

## You need 3 free services:

1. **Supabase** (Database + Storage) - https://supabase.com
2. **Upstash** (Redis) - https://upstash.com  
3. **Fly.io** (Hosting) - Already logged in ✅

## Quick Setup:

### 1. Supabase (2 minutes)
- Sign up: https://supabase.com
- Create project
- Go to SQL Editor → Run `db/schema.sql`
- Go to Storage → Create bucket `code-submissions`
- Settings → Database: Copy connection details
- Settings → API: Copy anon key

### 2. Upstash (1 minute)
- Sign up: https://upstash.com
- Create Redis database
- Copy Redis URL

### 3. Deploy to Fly.io

Once you have Supabase and Upstash credentials, run:

```bash
fly secrets set \
  POSTGRES_HOST=db.YOUR_PROJECT.supabase.co \
  POSTGRES_PORT=5432 \
  POSTGRES_DB=postgres \
  POSTGRES_USER=postgres \
  POSTGRES_PASSWORD=YOUR_PASSWORD \
  REDIS_URL=YOUR_UPSTASH_REDIS_URL \
  S3_ENDPOINT=https://YOUR_PROJECT.supabase.co \
  AWS_ACCESS_KEY_ID=YOUR_SUPABASE_ANON_KEY \
  AWS_SECRET_ACCESS_KEY=YOUR_SUPABASE_ANON_KEY \
  S3_BUCKET_NAME=code-submissions \
  AWS_REGION=us-east-1 \
  NODE_ENV=production

fly deploy
```

### 4. Your App is Live!

Visit: `https://code-exec-demo.fly.dev`

**Send this URL to your recruiter!** 🎉

---

**Note**: The worker service (code execution) needs Docker. For now, the web app will accept submissions and queue them. The worker can be deployed separately if needed.


