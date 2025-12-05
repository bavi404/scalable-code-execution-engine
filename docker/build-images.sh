#!/bin/bash
#
# Build all runner Docker images
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="${SCRIPT_DIR}/runner"

# Registry prefix (change for your registry)
REGISTRY="${DOCKER_REGISTRY:-}"
TAG="${IMAGE_TAG:-latest}"

echo "Building runner images..."
echo "Registry: ${REGISTRY:-local}"
echo "Tag: ${TAG}"
echo ""

# Build function
build_image() {
    local name=$1
    local dockerfile=$2
    local full_tag="${REGISTRY}code-runner:${name}"
    
    if [ -n "${REGISTRY}" ]; then
        full_tag="${REGISTRY}/code-runner:${name}"
    fi
    
    echo "Building ${full_tag}..."
    docker build -t "${full_tag}" -f "${RUNNER_DIR}/${dockerfile}" "${RUNNER_DIR}"
    
    if [ -n "${REGISTRY}" ]; then
        echo "Pushing ${full_tag}..."
        docker push "${full_tag}"
    fi
    
    echo ""
}

# Build all images
build_image "base" "Dockerfile.base"
build_image "node" "Dockerfile.node"
build_image "python" "Dockerfile.python"
build_image "java" "Dockerfile.java"
build_image "cpp" "Dockerfile.cpp"
build_image "go" "Dockerfile.go"

echo "All images built successfully!"
echo ""
echo "Available images:"
docker images | grep "code-runner"

