#!/bin/bash

# Build the code runner Docker image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-code-runner}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "🐳 Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"

cd "${SCRIPT_DIR}"

docker build \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    -f Dockerfile \
    .

echo "✅ Docker image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"

# Show image info
docker images "${IMAGE_NAME}:${IMAGE_TAG}"

echo ""
echo "📋 To test the image:"
echo "   docker run --rm -v \$(pwd)/test:/workspace -e LANGUAGE=javascript -e CODE_FILE=test.js ${IMAGE_NAME}:${IMAGE_TAG}"

