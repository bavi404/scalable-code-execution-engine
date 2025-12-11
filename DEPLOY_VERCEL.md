# 🚀 Deploy to Vercel (100% Free, No Credit Card!)

Vercel is perfect for Next.js apps and doesn't require a credit card!

## Quick Deploy:

1. **Go to**: https://vercel.com
2. **Sign up** with GitHub (free)
3. **Click "Add New Project"**
4. **Import your GitHub repo** (push this code to GitHub first if you haven't)
5. **Configure**:
   - Framework: Next.js (auto-detected)
   - Root Directory: `./`
6. **Add Environment Variables**:
   Click "Environment Variables" and add:

   ```
   POSTGRES_HOST=db.wjoosfdttllcyikqnvsp.supabase.co
   POSTGRES_PORT=5432
   POSTGRES_DB=postgres
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=Rolypoly67
   REDIS_URL=redis://default:ASAbAAImcDFlZDc4MWVjYzExZGU0NWIwOTJkNWY3MTczYjM5ZWFlYnAxODIxOQ@full-kingfish-8219.upstash.io:6379
   S3_ENDPOINT=https://wjoosfdttllcyikqnvsp.supabase.co
   AWS_ACCESS_KEY_ID=sb_publishable_TYD6znk4M-sWps36HvKVBg_AGODffzA
   AWS_SECRET_ACCESS_KEY=sb_publishable_TYD6znk4M-sWps36HvKVBg_AGODffzA
   S3_BUCKET_NAME=code-submissions
   AWS_REGION=us-east-1
   NODE_ENV=production
   ```

7. **Click "Deploy"**
8. **Done!** Your app will be live at: `https://your-project.vercel.app`

## Setup Database Schema:

1. Go to Supabase SQL Editor
2. Copy contents of `db/schema.sql`
3. Paste and run

## Setup Storage Bucket:

1. Go to Supabase → Storage
2. Create bucket: `code-submissions`
3. Make it public or use API keys

---

**That's it! No credit card needed, free forever!** 🎉

