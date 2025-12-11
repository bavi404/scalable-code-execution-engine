# 🔍 How to Find Supabase Credentials

## Quick Method:

### 1. Find Your Project URL
- Look at your browser address bar when you're in Supabase
- It should be: `https://xxxxx.supabase.co`
- The `xxxxx` part is your project reference ID

### 2. Database Host
- Your database host is: `db.xxxxx.supabase.co`
- Just add `db.` before your project URL

### 3. Database Password
- This is the password you set when creating the project
- If you forgot it: Settings → Database → Reset database password

### 4. API Key (Easier Way)
- In your Supabase dashboard, look at the left sidebar
- Click **Settings** (⚙️ icon)
- Click **API**
- You'll see a section called **Project API keys**
- Copy the **anon public** key (the long one, starts with `eyJ`)

## Even Simpler - Use Connection String:

1. Go to **Settings** → **Database**
2. Scroll down to **Connection string** section
3. You'll see something like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
4. From this, extract:
   - Host: `db.xxxxx.supabase.co`
   - Port: `5432`
   - Database: `postgres`
   - User: `postgres`
   - Password: `[YOUR-PASSWORD]` (the part in brackets)

## What I Need From You:

Just tell me:
1. **Your Supabase project URL**: `https://xxxxx.supabase.co`
2. **Your database password**: (the one you set)
3. **Your anon API key**: (from Settings → API)

Or if you can't find it, just share your Supabase project URL and I'll guide you to the exact spot!


