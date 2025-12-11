# 📋 Get Your Free Credentials

Follow these steps to get all the credentials needed. Then come back and I'll deploy everything for you!

## Step 1: Supabase (Database + Storage)

1. Go to: https://supabase.com
2. Click "Start your project" → Sign up (free)
3. Click "New Project"
4. Fill in:
   - Name: `code-exec-demo`
   - Database Password: (choose a strong password - save it!)
   - Region: Choose closest to you
5. Click "Create new project" (takes ~2 minutes)

### Get Database Credentials:
1. In your Supabase project dashboard, look at the left sidebar
2. Click **Settings** (gear icon at bottom)
3. Click **Database** in the settings menu
4. Scroll down to find **Connection string** or **Connection info**
5. Look for **Connection pooling** section - you'll see:
   - **Host**: `db.xxxxx.supabase.co` (or `xxxxx.supabase.co`)
   - **Port**: `5432` or `6543` (for connection pooling)
   - **Database name**: `postgres`
   - **User**: `postgres`
   - **Password**: (the one you set when creating the project - if you forgot it, you can reset it)

**Alternative way to find Host:**
- Look at your project URL: `https://xxxxx.supabase.co`
- Your database host is: `db.xxxxx.supabase.co` (add "db." prefix)
- Or check the **Connection string** - it shows: `postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres`

### Get API Key (for Storage):
1. In **Settings** → **API**
2. Look for **Project API keys** section
3. Copy the **anon public** key (the long string starting with `eyJ...`)
   - This is NOT the service_role key (keep that secret!)
   - Use the **anon** or **public** key

### Setup Database Schema:
1. Go to **SQL Editor**
2. Click "New query"
3. Open `db/schema.sql` from this project
4. Copy all the SQL
5. Paste into Supabase SQL Editor
6. Click "Run" (or press Cmd/Ctrl+Enter)

### Setup Storage:
1. Go to **Storage**
2. Click "New bucket"
3. Name: `code-submissions`
4. Make it **Public** (or we'll use API keys)
5. Click "Create bucket"

**✅ Save these Supabase values:**
- Host: `db.xxxxx.supabase.co`
- Password: `your-password`
- Anon Key: `eyJ...`

---

## Step 2: Upstash (Redis)

1. Go to: https://upstash.com
2. Click "Sign Up" (free)
3. Sign up with GitHub/Google
4. Click "Create Database"
5. Fill in:
   - Name: `code-exec-redis`
   - Type: **Regional** (free tier)
   - Region: Choose closest to you
6. Click "Create"

### Get Redis URL:
1. After creation, you'll see the database
2. Click on it
3. Copy the **Redis URL** (looks like: `redis://default:xxxxx@xxxxx.upstash.io:6379`)

**✅ Save this Upstash value:**
- Redis URL: `redis://default:xxxxx@xxxxx.upstash.io:6379`

---

## Step 3: Share Your Credentials

Once you have everything, share them with me in this format:

```
Supabase Host: db.xxxxx.supabase.co
Supabase Password: your-password
Supabase Anon Key: eyJ...
Upstash Redis URL: redis://default:xxxxx@xxxxx.upstash.io:6379
```

**I'll then deploy everything for you!** 🚀

---

**Time needed: ~5 minutes**  
**Cost: $0/month forever**

