#!/bin/bash
#
# gVisor (runsc) Execution Examples
#
# gVisor provides an application kernel that implements a substantial portion
# of the Linux kernel API in user-space, providing stronger isolation than
# traditional containers.
#
# Installation: https://gvisor.dev/docs/user_guide/install/
#

set -euo pipefail

# ============================================================================
# gVisor with Docker
# ============================================================================

run_with_docker_gvisor() {
    local workspace="$1"
    local language="$2"
    local code_file="$3"
    local timeout_sec="${4:-5}"
    local memory_kb="${5:-262144}"
    
    echo "Running with gVisor (Docker runtime: runsc)"
    
    docker run \
        --runtime=runsc \
        --rm \
        --network none \
        --memory="${memory_kb}k" \
        --memory-swap="${memory_kb}k" \
        --cpus="0.5" \
        --pids-limit=50 \
        --cap-drop=ALL \
        --security-opt="no-new-privileges" \
        --read-only \
        --tmpfs /tmp:size=64m,noexec \
        -v "$workspace:/workspace:ro" \
        -e "LANGUAGE=$language" \
        -e "CODE_FILE=$code_file" \
        -e "TIMEOUT_SEC=$timeout_sec" \
        -e "MEMORY_LIMIT_KB=$memory_kb" \
        code-runner:latest
}

# ============================================================================
# gVisor with runsc directly (without Docker)
# ============================================================================

run_with_runsc_direct() {
    local workspace="$1"
    local language="$2"
    local code_file="$3"
    local timeout_sec="${4:-5}"
    local memory_kb="${5:-262144}"
    
    local container_id="code-exec-$$"
    local bundle_dir="/tmp/runsc-bundle-$$"
    
    echo "Running with runsc directly"
    
    # Create OCI bundle
    mkdir -p "$bundle_dir/rootfs"
    
    # Create config.json for OCI spec
    cat > "$bundle_dir/config.json" <<EOF
{
  "ociVersion": "1.0.0",
  "process": {
    "terminal": false,
    "user": { "uid": 1000, "gid": 1000 },
    "args": ["/runner/harness/run.sh", "$language", "$code_file", "/output"],
    "env": [
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "LANGUAGE=$language",
      "CODE_FILE=$code_file",
      "TIMEOUT_SEC=$timeout_sec",
      "MEMORY_LIMIT_KB=$memory_kb"
    ],
    "cwd": "/workspace",
    "rlimits": [
      { "type": "RLIMIT_AS", "hard": $((memory_kb * 1024)), "soft": $((memory_kb * 1024)) },
      { "type": "RLIMIT_CPU", "hard": $timeout_sec, "soft": $timeout_sec },
      { "type": "RLIMIT_NPROC", "hard": 50, "soft": 50 }
    ]
  },
  "root": {
    "path": "rootfs",
    "readonly": true
  },
  "mounts": [
    {
      "destination": "/workspace",
      "type": "bind",
      "source": "$workspace",
      "options": ["rbind", "ro"]
    },
    {
      "destination": "/tmp",
      "type": "tmpfs",
      "options": ["nosuid", "noexec", "size=67108864"]
    }
  ],
  "linux": {
    "namespaces": [
      { "type": "pid" },
      { "type": "network" },
      { "type": "ipc" },
      { "type": "uts" },
      { "type": "mount" }
    ],
    "resources": {
      "memory": {
        "limit": $((memory_kb * 1024))
      },
      "cpu": {
        "quota": 50000,
        "period": 100000
      },
      "pids": {
        "limit": 50
      }
    }
  }
}
EOF
    
    # Extract container rootfs (simplified - in practice, use the Docker image)
    # docker export $(docker create code-runner:latest) | tar -C "$bundle_dir/rootfs" -xf -
    
    # Run with runsc
    runsc \
        --platform=ptrace \
        --network=none \
        --rootless \
        run \
        --bundle "$bundle_dir" \
        "$container_id"
    
    # Cleanup
    rm -rf "$bundle_dir"
}

# ============================================================================
# Docker daemon configuration for gVisor
# ============================================================================

print_docker_daemon_config() {
    cat <<'EOF'
# /etc/docker/daemon.json - Add gVisor runtime

{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": [
        "--platform=ptrace",
        "--network=none"
      ]
    },
    "runsc-kvm": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": [
        "--platform=kvm"
      ]
    }
  }
}

# Restart Docker after adding:
# sudo systemctl restart docker

# Verify:
# docker info | grep -i runtime
EOF
}

# ============================================================================
# gVisor installation
# ============================================================================

print_gvisor_install() {
    cat <<'EOF'
# Install gVisor (runsc)

# Download and install (Ubuntu/Debian)
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
sudo apt-get update && sudo apt-get install -y runsc

# Or download directly
curl -fsSL https://storage.googleapis.com/gvisor/releases/release/latest/x86_64/runsc -o runsc
chmod +x runsc
sudo mv runsc /usr/local/bin/

# Verify installation
runsc --version

# Install containerd shim (optional, for Kubernetes)
curl -fsSL https://storage.googleapis.com/gvisor/releases/release/latest/x86_64/containerd-shim-runsc-v1 -o containerd-shim-runsc-v1
chmod +x containerd-shim-runsc-v1
sudo mv containerd-shim-runsc-v1 /usr/local/bin/
EOF
}

# ============================================================================
# Main
# ============================================================================

case "${1:-help}" in
    run)
        shift
        run_with_docker_gvisor "$@"
        ;;
    direct)
        shift
        run_with_runsc_direct "$@"
        ;;
    docker-config)
        print_docker_daemon_config
        ;;
    install)
        print_gvisor_install
        ;;
    *)
        cat <<EOF
gVisor (runsc) Execution Examples

Usage: $0 <command> [options]

Commands:
  run <workspace> <language> <code_file> [timeout] [memory_kb]
      Run code using Docker with gVisor runtime

  direct <workspace> <language> <code_file> [timeout] [memory_kb]
      Run code using runsc directly (without Docker)

  docker-config
      Print Docker daemon configuration for gVisor

  install
      Print gVisor installation instructions

Examples:
  # Run JavaScript code with gVisor
  $0 run /tmp/workspace javascript solution.js 5 262144

  # Show Docker daemon configuration
  $0 docker-config

Benefits of gVisor:
  - Stronger isolation than traditional containers
  - Application kernel intercepts syscalls
  - No direct access to host kernel
  - Defense in depth for code execution
EOF
        ;;
esac

