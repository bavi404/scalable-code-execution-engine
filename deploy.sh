#!/bin/bash

# Deployment script for Code Execution Engine
# This script sets up and starts all services

set -e

echo "🚀 Code Execution Engine - Deployment Script"
echo "==========================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Use docker compose (v2) if available, otherwise docker-compose (v1)
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null; then
    COMPOSE_CMD="docker-compose"
fi

echo "📦 Building runner image..."
cd runner
docker build -t code-runner:latest .
cd ..

echo ""
echo "🏗️  Building application images..."
$COMPOSE_CMD build

echo ""
echo "🚀 Starting all services..."
$COMPOSE_CMD up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check service health
echo ""
echo "📊 Service Status:"
$COMPOSE_CMD ps

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Access the application at: http://localhost:3000"
echo "📊 MinIO Console: http://localhost:9001 (minioadmin/minioadmin)"
echo ""
echo "📝 To view logs:"
echo "   $COMPOSE_CMD logs -f web"
echo "   $COMPOSE_CMD logs -f worker"
echo ""
echo "🛑 To stop all services:"
echo "   $COMPOSE_CMD down"
echo ""
echo "🗑️  To stop and remove all data:"
echo "   $COMPOSE_CMD down -v"



