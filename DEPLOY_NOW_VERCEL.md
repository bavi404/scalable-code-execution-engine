# 🚀 Deploy Now - Vercel (No Credit Card Needed!)

## Step 1: Push to GitHub (if not already)

```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

## Step 2: Deploy to Vercel

1. **Go to**: https://vercel.com
2. **Sign up** with GitHub (free, no credit card!)
3. **Click "Add New Project"**
4. **Import your repo**: `bavi404/scalable-code-execution-engine`
5. **Configure**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./` (leave default)
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)

6. **Add Environment Variables** (click "Environment Variables"):
   
   Add these one by one:
   
   ```
   POSTGRES_HOST = db.wjoosfdttllcyikqnvsp.supabase.co
   POSTGRES_PORT = 5432
   POSTGRES_DB = postgres
   POSTGRES_USER = postgres
   POSTGRES_PASSWORD = Rolypoly67
   REDIS_URL = redis://default:ASAbAAImcDFlZDc4MWVjYzExZGU0NWIwOTJkNWY3MTczYjM5ZWFlYnAxODIxOQ@full-kingfish-8219.upstash.io:6379
   S3_ENDPOINT = https://wjoosfdttllcyikqnvsp.supabase.co
   AWS_ACCESS_KEY_ID = sb_publishable_TYD6znk4M-sWps36HvKVBg_AGODffzA
   AWS_SECRET_ACCESS_KEY = sb_publishable_TYD6znk4M-sWps36HvKVBg_AGODffzA
   S3_BUCKET_NAME = code-submissions
   AWS_REGION = us-east-1
   NODE_ENV = production
   ```

7. **Click "Deploy"**
8. **Wait 2-3 minutes** for build to complete
9. **Done!** Your app is live!

## Step 3: Setup Database

1. Go to Supabase → SQL Editor
2. Open `db/schema.sql` from this project
3. Copy all SQL
4. Paste in Supabase SQL Editor
5. Click "Run"

## Step 4: Setup Storage

1. Go to Supabase → Storage
2. Click "New bucket"
3. Name: `code-submissions`
4. Make it **Public**
5. Click "Create"

## Your Live URL:

After deployment, Vercel will give you a URL like:
`https://scalable-code-execution-engine.vercel.app`

**Send this to your recruiter!** 🎉

---

**Note**: The worker service (code execution) needs Docker and runs separately. For the demo, the web app will accept submissions and queue them. The worker can be deployed later if needed.

