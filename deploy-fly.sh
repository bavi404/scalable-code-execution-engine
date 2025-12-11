#!/bin/bash

# Fly.io Deployment Script
# This script helps you deploy to Fly.io step by step

set -e

echo "🚀 Fly.io Deployment Script"
echo "============================"
echo ""
echo "This script will guide you through deploying to Fly.io"
echo ""

# Check if Fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo "❌ Fly CLI is not installed."
    echo ""
    echo "Install it with:"
    echo "  macOS: brew install flyctl"
    echo "  Linux/Windows: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo "⚠️  Not logged in to Fly.io"
    echo "Run: fly auth login"
    exit 1
fi

echo "✅ Fly CLI installed and logged in"
echo ""

# Step 1: Create PostgreSQL
echo "📦 Step 1: Creating PostgreSQL database..."
echo "This may take a few minutes..."
fly postgres create --name code-exec-db --region iad --vm-size shared-cpu-1x --volume-size 3 || {
    echo "⚠️  Database might already exist, continuing..."
}

# Step 2: Create Redis
echo ""
echo "📦 Step 2: Creating Redis database..."
fly redis create --name code-exec-redis --region iad --plan free || {
    echo "⚠️  Redis might already exist, continuing..."
}

# Step 3: Get connection details
echo ""
echo "📋 Step 3: Getting connection details..."
DB_HOST=$(fly postgres list | grep code-exec-db | awk '{print $NF}' || echo "")
REDIS_URL=$(fly redis status --app code-exec-redis 2>/dev/null | grep "Redis URL" | awk '{print $3}' || echo "")

if [ -z "$DB_HOST" ]; then
    echo "❌ Could not get database host. Please check: fly postgres list"
    exit 1
fi

echo "Database Host: $DB_HOST"
echo "Redis URL: $REDIS_URL"
echo ""

# Step 4: Deploy Web App
echo "🌐 Step 4: Deploying web application..."
echo ""
read -p "Enter your web app name (or press Enter for 'code-exec-web'): " WEB_APP_NAME
WEB_APP_NAME=${WEB_APP_NAME:-code-exec-web}

# Initialize if not already done
if [ ! -f "fly.toml" ]; then
    fly launch --no-deploy --name "$WEB_APP_NAME" || true
fi

echo ""
echo "Setting secrets for web app..."
echo "You'll need to provide S3 credentials:"
read -p "S3 Endpoint (or Supabase URL): " S3_ENDPOINT
read -p "AWS Access Key ID: " AWS_ACCESS_KEY_ID
read -s -p "AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
echo ""
read -p "S3 Bucket Name: " S3_BUCKET_NAME
read -p "AWS Region (default: us-east-1): " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

# Get DB password (this is tricky - user needs to provide it)
echo ""
read -s -p "PostgreSQL Password (from fly postgres connect): " DB_PASSWORD
echo ""

fly secrets set \
    POSTGRES_HOST="$DB_HOST" \
    POSTGRES_PORT=5432 \
    POSTGRES_DB=postgres \
    POSTGRES_USER=postgres \
    POSTGRES_PASSWORD="$DB_PASSWORD" \
    REDIS_URL="$REDIS_URL" \
    S3_ENDPOINT="$S3_ENDPOINT" \
    AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    S3_BUCKET_NAME="$S3_BUCKET_NAME" \
    AWS_REGION="$AWS_REGION" \
    NODE_ENV=production \
    PORT=3000 \
    --app "$WEB_APP_NAME"

echo ""
echo "Deploying web app..."
fly deploy --app "$WEB_APP_NAME"

echo ""
echo "✅ Web app deployed!"
echo "🌐 URL: https://$WEB_APP_NAME.fly.dev"
echo ""

# Step 5: Setup Database Schema
echo "📊 Step 5: Setting up database schema..."
echo "You'll need to run the schema manually:"
echo "  fly postgres connect --app code-exec-db"
echo "  Then run: \\i db/schema.sql"
echo ""

# Step 6: Deploy Worker
echo "⚙️  Step 6: Deploying worker service..."
read -p "Enter worker app name (or press Enter for 'code-exec-worker'): " WORKER_APP_NAME
WORKER_APP_NAME=${WORKER_APP_NAME:-code-exec-worker}

if [ ! -f "fly.worker.toml" ]; then
    echo "⚠️  fly.worker.toml not found. Creating..."
    fly launch --config fly.worker.toml --no-deploy --name "$WORKER_APP_NAME" || true
fi

echo ""
echo "Setting secrets for worker..."
fly secrets set \
    POSTGRES_HOST="$DB_HOST" \
    POSTGRES_PORT=5432 \
    POSTGRES_DB=postgres \
    POSTGRES_USER=postgres \
    POSTGRES_PASSWORD="$DB_PASSWORD" \
    REDIS_URL="$REDIS_URL" \
    S3_ENDPOINT="$S3_ENDPOINT" \
    AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    S3_BUCKET_NAME="$S3_BUCKET_NAME" \
    AWS_REGION="$AWS_REGION" \
    WORKER_NAME=fly-worker-1 \
    MAX_CONCURRENT_JOBS=2 \
    RUNNER_IMAGE=code-runner:latest \
    HEALTH_PORT=8080 \
    NODE_ENV=production \
    --app "$WORKER_APP_NAME"

echo ""
echo "⚠️  Note: Worker needs Docker socket access."
echo "Fly.io doesn't support Docker-in-Docker easily."
echo "You may need to use Fly Machines API or external Docker host."
echo ""

read -p "Deploy worker anyway? (y/n): " DEPLOY_WORKER
if [ "$DEPLOY_WORKER" = "y" ]; then
    fly deploy --config fly.worker.toml --app "$WORKER_APP_NAME"
    echo "✅ Worker deployed!"
else
    echo "⏭️  Skipping worker deployment"
fi

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Setup database schema: fly postgres connect --app code-exec-db"
echo "2. Test your app: https://$WEB_APP_NAME.fly.dev"
echo "3. View logs: fly logs --app $WEB_APP_NAME"
echo ""
echo "📖 Full guide: See DEPLOY_FLY.md"



