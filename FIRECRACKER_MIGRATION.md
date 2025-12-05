# Firecracker MicroVM Migration Guide

This document explains how to migrate from Docker-based code execution to Firecracker microVMs for stronger isolation and faster cold starts.

## What is Firecracker?

[Firecracker](https://firecracker-microvm.github.io/) is an open-source virtualization technology developed by AWS, purpose-built for creating and managing secure, multi-tenant container and function-based services. It powers AWS Lambda and AWS Fargate.

### Benefits over Containers

| Aspect | Docker Container | Firecracker microVM |
|--------|-----------------|---------------------|
| **Isolation** | Shared kernel (namespaces) | Full VM isolation (separate kernel) |
| **Security** | Container escapes possible | Hardware-level isolation |
| **Cold Start** | ~100-500ms | ~125ms (optimized) |
| **Memory Overhead** | ~5-10MB | ~5MB |
| **Resource Limits** | cgroups | VM-level limits |
| **Network** | Network namespaces | Virtual network devices |
| **Storage** | Shared filesystem | Dedicated block devices |

## Architecture Overview

### Current: Docker-based

```
┌─────────────────────────────────────────────────────────┐
│                     Host Kernel                          │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Container  │  │  Container  │  │  Container  │     │
│  │  (cgroups)  │  │  (cgroups)  │  │  (cgroups)  │     │
│  │             │  │             │  │             │     │
│  │   Code 1    │  │   Code 2    │  │   Code 3    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                     Docker Daemon                        │
└─────────────────────────────────────────────────────────┘
```

### Target: Firecracker-based

```
┌─────────────────────────────────────────────────────────┐
│                     Host Kernel                          │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  microVM 1  │  │  microVM 2  │  │  microVM 3  │     │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │     │
│  │ │ Guest   │ │  │ │ Guest   │ │  │ │ Guest   │ │     │
│  │ │ Kernel  │ │  │ │ Kernel  │ │  │ │ Kernel  │ │     │
│  │ ├─────────┤ │  │ ├─────────┤ │  │ ├─────────┤ │     │
│  │ │ Code 1  │ │  │ │ Code 2  │ │  │ │ Code 3  │ │     │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┴────────────────┘             │
│                    Firecracker VMM                       │
└─────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Linux host with KVM support
- x86_64 or aarch64 architecture
- Root access (for /dev/kvm)

```bash
# Check KVM support
lsmod | grep kvm
ls -la /dev/kvm

# Install Firecracker
FIRECRACKER_VERSION="1.5.0"
curl -L "https://github.com/firecracker-microvm/firecracker/releases/download/v${FIRECRACKER_VERSION}/firecracker-v${FIRECRACKER_VERSION}-x86_64.tgz" | tar -xz
sudo mv release-v${FIRECRACKER_VERSION}-x86_64/firecracker-v${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/firecracker
sudo mv release-v${FIRECRACKER_VERSION}-x86_64/jailer-v${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/jailer

# Verify
firecracker --version
```

## Creating a Root Filesystem

### Option 1: Build from scratch

```bash
#!/bin/bash
# build-rootfs.sh - Create minimal rootfs for code execution

ROOTFS_DIR="/tmp/rootfs"
ROOTFS_IMAGE="/var/lib/firecracker/rootfs.ext4"

# Create directory structure
mkdir -p $ROOTFS_DIR/{bin,sbin,lib,lib64,usr,dev,proc,sys,tmp,workspace,runner,output}

# Copy busybox for shell
cp /bin/busybox $ROOTFS_DIR/bin/
cd $ROOTFS_DIR/bin && ./busybox --install -s .

# Copy language runtimes
cp -r /usr/bin/python3* $ROOTFS_DIR/usr/bin/
cp -r /usr/bin/node $ROOTFS_DIR/usr/bin/
cp -r /usr/lib/python3* $ROOTFS_DIR/usr/lib/
# ... add more as needed

# Copy harness
cp -r /path/to/runner/harness/* $ROOTFS_DIR/runner/

# Create init script
cat > $ROOTFS_DIR/init <<'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev

# Read command from kernel cmdline
CMDLINE=$(cat /proc/cmdline)
LANGUAGE=$(echo "$CMDLINE" | grep -oP 'language=\K\w+')
CODE_FILE=$(echo "$CMDLINE" | grep -oP 'code_file=\K\S+')

# Execute code
exec /runner/harness/run.sh "$LANGUAGE" "$CODE_FILE" /output
EOF
chmod +x $ROOTFS_DIR/init

# Create ext4 image
dd if=/dev/zero of=$ROOTFS_IMAGE bs=1M count=512
mkfs.ext4 $ROOTFS_IMAGE
mkdir -p /mnt/rootfs
mount $ROOTFS_IMAGE /mnt/rootfs
cp -r $ROOTFS_DIR/* /mnt/rootfs/
umount /mnt/rootfs

echo "Rootfs created: $ROOTFS_IMAGE"
```

### Option 2: Convert Docker image

```bash
#!/bin/bash
# docker-to-rootfs.sh - Convert Docker image to Firecracker rootfs

IMAGE="code-runner:latest"
ROOTFS_IMAGE="/var/lib/firecracker/rootfs.ext4"

# Create container without starting
CONTAINER_ID=$(docker create $IMAGE)

# Export to tar
docker export $CONTAINER_ID | tar -C /tmp/rootfs -xf -

# Create ext4 image
dd if=/dev/zero of=$ROOTFS_IMAGE bs=1M count=1024
mkfs.ext4 $ROOTFS_IMAGE
mkdir -p /mnt/rootfs
mount $ROOTFS_IMAGE /mnt/rootfs
cp -r /tmp/rootfs/* /mnt/rootfs/

# Add init if missing
if [ ! -f /mnt/rootfs/init ]; then
    cat > /mnt/rootfs/init <<'INIT'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
exec /runner/harness/run.sh "$LANGUAGE" "$CODE_FILE" /output
INIT
    chmod +x /mnt/rootfs/init
fi

umount /mnt/rootfs
docker rm $CONTAINER_ID

echo "Rootfs created: $ROOTFS_IMAGE"
```

## Kernel Configuration

Download or build a minimal Linux kernel:

```bash
# Download pre-built kernel
KERNEL_VERSION="5.10.186"
curl -L "https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/kernels/vmlinux-${KERNEL_VERSION}" -o /var/lib/firecracker/vmlinux

# Or build from source with minimal config
git clone --depth 1 --branch v5.10 https://github.com/torvalds/linux.git
cd linux
make defconfig
make kvmconfig
# Disable unnecessary features
scripts/config --disable MODULES
scripts/config --disable SOUND
scripts/config --disable USB
scripts/config --enable VIRTIO_BLK
scripts/config --enable VIRTIO_NET
scripts/config --enable EXT4_FS
make -j$(nproc) vmlinux
cp vmlinux /var/lib/firecracker/
```

## Starting a microVM

### Method 1: API (Recommended)

```bash
#!/bin/bash
# start-microvm.sh - Start Firecracker microVM for code execution

SOCKET_PATH="/tmp/firecracker-$$.sock"
KERNEL_PATH="/var/lib/firecracker/vmlinux"
ROOTFS_PATH="/var/lib/firecracker/rootfs.ext4"

# Code execution parameters
LANGUAGE="${1:-javascript}"
CODE_FILE="${2:-solution.js}"
TIMEOUT_SEC="${3:-5}"
MEMORY_MB="${4:-256}"
VCPU_COUNT="${5:-1}"

# Start Firecracker in background
firecracker --api-sock "$SOCKET_PATH" &
FC_PID=$!
sleep 0.5

# Configure kernel
curl --unix-socket "$SOCKET_PATH" -X PUT "http://localhost/boot-source" \
    -H "Content-Type: application/json" \
    -d "{
        \"kernel_image_path\": \"$KERNEL_PATH\",
        \"boot_args\": \"console=ttyS0 reboot=k panic=1 pci=off language=$LANGUAGE code_file=$CODE_FILE timeout=$TIMEOUT_SEC\"
    }"

# Configure root drive
curl --unix-socket "$SOCKET_PATH" -X PUT "http://localhost/drives/rootfs" \
    -H "Content-Type: application/json" \
    -d "{
        \"drive_id\": \"rootfs\",
        \"path_on_host\": \"$ROOTFS_PATH\",
        \"is_root_device\": true,
        \"is_read_only\": false
    }"

# Configure machine
curl --unix-socket "$SOCKET_PATH" -X PUT "http://localhost/machine-config" \
    -H "Content-Type: application/json" \
    -d "{
        \"vcpu_count\": $VCPU_COUNT,
        \"mem_size_mib\": $MEMORY_MB
    }"

# No network interface (isolated)
# If needed:
# curl --unix-socket "$SOCKET_PATH" -X PUT "http://localhost/network-interfaces/eth0" \
#     -d '{"iface_id": "eth0", "host_dev_name": "tap0"}'

# Start the VM
curl --unix-socket "$SOCKET_PATH" -X PUT "http://localhost/actions" \
    -H "Content-Type: application/json" \
    -d '{"action_type": "InstanceStart"}'

# Wait for completion (with timeout)
timeout $((TIMEOUT_SEC + 10)) wait $FC_PID 2>/dev/null

# Cleanup
rm -f "$SOCKET_PATH"
```

### Method 2: JSON Config File

```json
{
  "boot-source": {
    "kernel_image_path": "/var/lib/firecracker/vmlinux",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off language=javascript code_file=solution.js"
  },
  "drives": [
    {
      "drive_id": "rootfs",
      "path_on_host": "/var/lib/firecracker/rootfs.ext4",
      "is_root_device": true,
      "is_read_only": false
    },
    {
      "drive_id": "workspace",
      "path_on_host": "/tmp/workspace.ext4",
      "is_root_device": false,
      "is_read_only": true
    }
  ],
  "machine-config": {
    "vcpu_count": 1,
    "mem_size_mib": 256
  }
}
```

```bash
firecracker --config-file vm-config.json --api-sock /tmp/fc.sock
```

## Worker Integration

### Modified Worker for Firecracker

```typescript
// workers/executor-firecracker.ts

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface FirecrackerConfig {
  kernelPath: string;
  rootfsPath: string;
  workspaceTemplate: string;
  vcpuCount: number;
  memoryMb: number;
}

const FC_CONFIG: FirecrackerConfig = {
  kernelPath: process.env.FC_KERNEL_PATH || '/var/lib/firecracker/vmlinux',
  rootfsPath: process.env.FC_ROOTFS_PATH || '/var/lib/firecracker/rootfs.ext4',
  workspaceTemplate: process.env.FC_WORKSPACE_TEMPLATE || '/var/lib/firecracker/workspace.ext4',
  vcpuCount: parseInt(process.env.FC_VCPU_COUNT || '1'),
  memoryMb: parseInt(process.env.FC_MEMORY_MB || '256'),
};

async function executeInFirecracker(options: {
  code: string;
  language: string;
  codeFile: string;
  timeLimit: number;
  memoryLimit: number;
}): Promise<ExecutionResult> {
  const vmId = uuidv4().slice(0, 8);
  const socketPath = `/tmp/firecracker-${vmId}.sock`;
  const workspacePath = `/tmp/workspace-${vmId}.ext4`;
  const outputPath = `/tmp/output-${vmId}`;

  try {
    // Create workspace image with code
    await createWorkspaceImage(workspacePath, options.code, options.codeFile);

    // Start Firecracker
    const fc = spawn('firecracker', ['--api-sock', socketPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await sleep(500); // Wait for socket

    // Configure VM
    await configureVM(socketPath, {
      language: options.language,
      codeFile: options.codeFile,
      timeout: options.timeLimit,
      memoryMb: Math.ceil(options.memoryLimit / 1024),
      workspacePath,
    });

    // Start VM
    await startVM(socketPath);

    // Wait for completion with timeout
    const result = await waitForCompletion(
      fc,
      outputPath,
      options.timeLimit + 5000
    );

    return result;

  } finally {
    // Cleanup
    await fs.rm(workspacePath, { force: true });
    await fs.rm(socketPath, { force: true });
    await fs.rm(outputPath, { recursive: true, force: true });
  }
}

async function createWorkspaceImage(
  imagePath: string,
  code: string,
  codeFile: string
): Promise<void> {
  // Create small ext4 image
  await exec(`dd if=/dev/zero of=${imagePath} bs=1M count=16`);
  await exec(`mkfs.ext4 -F ${imagePath}`);
  
  // Mount and write code
  const mountPoint = `/tmp/mount-${path.basename(imagePath)}`;
  await fs.mkdir(mountPoint, { recursive: true });
  await exec(`mount ${imagePath} ${mountPoint}`);
  await fs.writeFile(path.join(mountPoint, codeFile), code);
  await exec(`umount ${mountPoint}`);
  await fs.rmdir(mountPoint);
}

async function configureVM(
  socketPath: string,
  config: {
    language: string;
    codeFile: string;
    timeout: number;
    memoryMb: number;
    workspacePath: string;
  }
): Promise<void> {
  const bootArgs = [
    'console=ttyS0',
    'reboot=k',
    'panic=1',
    'pci=off',
    `language=${config.language}`,
    `code_file=${config.codeFile}`,
    `timeout=${Math.ceil(config.timeout / 1000)}`,
  ].join(' ');

  // Set kernel
  await fcApi(socketPath, 'PUT', '/boot-source', {
    kernel_image_path: FC_CONFIG.kernelPath,
    boot_args: bootArgs,
  });

  // Set root drive
  await fcApi(socketPath, 'PUT', '/drives/rootfs', {
    drive_id: 'rootfs',
    path_on_host: FC_CONFIG.rootfsPath,
    is_root_device: true,
    is_read_only: false,
  });

  // Set workspace drive
  await fcApi(socketPath, 'PUT', '/drives/workspace', {
    drive_id: 'workspace',
    path_on_host: config.workspacePath,
    is_root_device: false,
    is_read_only: true,
  });

  // Set machine config
  await fcApi(socketPath, 'PUT', '/machine-config', {
    vcpu_count: FC_CONFIG.vcpuCount,
    mem_size_mib: config.memoryMb,
  });
}

async function startVM(socketPath: string): Promise<void> {
  await fcApi(socketPath, 'PUT', '/actions', {
    action_type: 'InstanceStart',
  });
}

async function fcApi(
  socketPath: string,
  method: string,
  endpoint: string,
  body: object
): Promise<any> {
  // Use curl to communicate with Unix socket
  const result = await exec(
    `curl -s --unix-socket ${socketPath} -X ${method} ` +
    `"http://localhost${endpoint}" ` +
    `-H "Content-Type: application/json" ` +
    `-d '${JSON.stringify(body)}'`
  );
  return result ? JSON.parse(result) : null;
}
```

## Using Jailer for Production

Jailer provides additional security by running Firecracker in a chroot with minimal permissions:

```bash
#!/bin/bash
# run-with-jailer.sh

JAIL_ID="code-exec-$$"
CHROOT_BASE="/srv/jailer"

jailer \
    --id "$JAIL_ID" \
    --exec-file /usr/local/bin/firecracker \
    --uid 1000 \
    --gid 1000 \
    --chroot-base-dir "$CHROOT_BASE" \
    --daemonize \
    -- \
    --config-file /etc/firecracker/vm-config.json

# VM files will be in:
# $CHROOT_BASE/firecracker/$JAIL_ID/root/
```

## Snapshot/Restore for Fast Cold Starts

Firecracker supports VM snapshots for sub-100ms cold starts:

```bash
# Create snapshot after boot
curl --unix-socket /tmp/fc.sock -X PATCH "http://localhost/vm" \
    -d '{"state": "Paused"}'

curl --unix-socket /tmp/fc.sock -X PUT "http://localhost/snapshot/create" \
    -d '{
        "snapshot_type": "Full",
        "snapshot_path": "/var/lib/firecracker/snapshots/ready.snap",
        "mem_file_path": "/var/lib/firecracker/snapshots/ready.mem"
    }'

# Restore from snapshot (fast!)
firecracker --api-sock /tmp/fc-new.sock &
sleep 0.1

curl --unix-socket /tmp/fc-new.sock -X PUT "http://localhost/snapshot/load" \
    -d '{
        "snapshot_path": "/var/lib/firecracker/snapshots/ready.snap",
        "mem_file_path": "/var/lib/firecracker/snapshots/ready.mem"
    }'

curl --unix-socket /tmp/fc-new.sock -X PATCH "http://localhost/vm" \
    -d '{"state": "Resumed"}'
```

## Comparison: Docker vs gVisor vs Firecracker

| Feature | Docker | gVisor | Firecracker |
|---------|--------|--------|-------------|
| **Isolation** | Process-level | User-space kernel | VM-level |
| **Cold Start** | ~100ms | ~200ms | ~125ms (snapshot: <50ms) |
| **Memory Overhead** | ~5MB | ~15MB | ~5MB |
| **Syscall Overhead** | None | ~2-5x | VM exit |
| **Security** | Container escapes | Strong | Hardware isolation |
| **Compatibility** | Full Linux | ~70% syscalls | Full Linux |
| **Nested** | Yes | Limited | With KVM |
| **AWS Lambda** | ❌ | ❌ | ✅ (powers it) |

## Migration Checklist

1. [ ] Install Firecracker and jailer on worker nodes
2. [ ] Create minimal Linux kernel
3. [ ] Build rootfs with language runtimes
4. [ ] Test snapshot/restore for cold start optimization
5. [ ] Update worker service to use Firecracker API
6. [ ] Configure resource limits via VM config
7. [ ] Set up workspace drive mounting
8. [ ] Implement output collection from VM
9. [ ] Add monitoring and logging
10. [ ] Load test with concurrent VMs

## Resources

- [Firecracker GitHub](https://github.com/firecracker-microvm/firecracker)
- [Firecracker Documentation](https://github.com/firecracker-microvm/firecracker/tree/main/docs)
- [AWS Firecracker Paper](https://www.usenix.org/conference/nsdi20/presentation/agache)
- [Kata Containers](https://katacontainers.io/) - Alternative VM-based container runtime
- [gVisor](https://gvisor.dev/) - User-space kernel alternative

