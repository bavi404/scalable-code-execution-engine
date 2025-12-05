# eBPF Syscall Anomaly Detector Design

## Overview

This document describes the design of an eBPF-based syscall anomaly detector that monitors code execution processes for disallowed system calls, providing an additional layer of security beyond container/VM isolation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              User Space                                  │
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │   Detector UI     │◄──│   Alert Manager   │◄──│   Log Aggregator │  │
│  │   (Grafana)       │    │   (Prometheus)    │    │   (Loki)         │  │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘  │
│                                    ▲                        ▲           │
│                                    │                        │           │
│  ┌─────────────────────────────────┴────────────────────────┴─────────┐ │
│  │                        Detector Service                             │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐  │ │
│  │  │ Policy Engine │  │ Event Handler │  │ Metrics Exporter      │  │ │
│  │  │ (Allowlist)   │  │ (Ring Buffer) │  │ (Prometheus)          │  │ │
│  │  └───────────────┘  └───────────────┘  └───────────────────────┘  │ │
│  └──────────────────────────────────▲──────────────────────────────────┘ │
│                                     │                                    │
├─────────────────────────────────────┼────────────────────────────────────┤
│                              Kernel Space                                │
│                                     │                                    │
│  ┌──────────────────────────────────┴──────────────────────────────────┐ │
│  │                    eBPF Programs                                     │ │
│  │                                                                      │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │ │
│  │  │ sys_enter hook  │  │ sys_exit hook   │  │ sched_process_exec  │  │ │
│  │  │ (tracepoint)    │  │ (tracepoint)    │  │ (tracepoint)        │  │ │
│  │  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │ │
│  │           │                    │                      │              │ │
│  │           └────────────────────┴──────────────────────┘              │ │
│  │                                │                                     │ │
│  │                    ┌───────────▼────────────┐                        │ │
│  │                    │   eBPF Maps            │                        │ │
│  │                    │  ┌──────────────────┐  │                        │ │
│  │                    │  │ Allowlist Map    │  │                        │ │
│  │                    │  │ Events Ring Buf  │  │                        │ │
│  │                    │  │ Process State    │  │                        │ │
│  │                    │  │ Stats Map        │  │                        │ │
│  │                    │  └──────────────────┘  │                        │ │
│  │                    └────────────────────────┘                        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                   Monitored Processes                                 │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │ │
│  │  │ python  │  │  node   │  │  java   │  │   gcc   │                 │ │
│  │  │ (exec)  │  │ (exec)  │  │ (exec)  │  │ (exec)  │                 │ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘                 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Syscall Allowlist Policy

### Language-Specific Allowlists

Different languages need different syscalls. The detector maintains per-language allowlists:

```yaml
# syscall_policy.yaml

default:
  # Basic I/O
  - read
  - write
  - close
  - fstat
  - lseek
  - mmap
  - mprotect
  - munmap
  - brk
  # Process
  - exit_group
  - exit
  - rt_sigreturn
  - rt_sigaction
  - rt_sigprocmask
  # Memory
  - futex
  - set_robust_list
  - get_robust_list
  
python:
  inherit: default
  allow:
    - openat
    - newfstatat
    - getdents64
    - fcntl
    - dup
    - dup2
    - pipe2
    - eventfd2
    - timerfd_create
    - timerfd_settime
    - clock_gettime
    - clock_getres
    - gettimeofday
    - nanosleep
    - getrandom
    # Python-specific
    - sysinfo
    - uname
    - getuid
    - getgid
    - geteuid
    - getegid
    - getpid
    - getppid
    - arch_prctl
    - set_tid_address
    - prlimit64
    - sigaltstack
    
javascript:
  inherit: default
  allow:
    - openat
    - newfstatat
    - epoll_create1
    - epoll_ctl
    - epoll_wait
    - epoll_pwait
    - eventfd2
    - pipe2
    - dup3
    - fcntl
    - ioctl  # Terminal operations
    - clock_gettime
    - clock_getres
    - gettimeofday
    - nanosleep
    - getrandom
    - getpid
    - gettid
    - uname
    - prlimit64
    - sigaltstack
    - arch_prctl
    - set_tid_address
    # V8/Node.js specific
    - prctl
    - sched_getaffinity
    - sched_yield
    
compiled:  # C, C++, Rust, Go
  inherit: default
  allow:
    - openat
    - newfstatat
    - execve  # For compilation
    - clone
    - clone3
    - vfork
    - wait4
    - getdents64
    - pipe2
    - dup2
    - fcntl
    - ioctl
    - access
    - faccessat
    - readlink
    - readlinkat
    - getcwd
    - chdir
    - fchdir
    - mkdir
    - mkdirat
    - unlink
    - unlinkat
    - rename
    - renameat
    - symlink
    - link
    - chmod
    - fchmod
    - chown
    - fchown
    - utime
    - utimes
    - truncate
    - ftruncate
    - statfs
    - fstatfs
    - getuid
    - geteuid
    - getgid
    - getegid
    - getpid
    - getppid
    - getpgrp
    - getpgid
    - getsid
    - clock_gettime
    - gettimeofday
    - nanosleep
    - kill  # For process management during compilation
    - prctl
    - arch_prctl
    - prlimit64
    - getrandom
    - uname
    
# Explicitly denied syscalls (never allowed)
denied:
  - socket
  - connect
  - accept
  - accept4
  - bind
  - listen
  - sendto
  - recvfrom
  - sendmsg
  - recvmsg
  - setsockopt
  - getsockopt
  - getpeername
  - getsockname
  - socketpair
  - shutdown
  # Dangerous syscalls
  - ptrace
  - process_vm_readv
  - process_vm_writev
  - init_module
  - finit_module
  - delete_module
  - kexec_load
  - kexec_file_load
  - reboot
  - sethostname
  - setdomainname
  - iopl
  - ioperm
  - mount
  - umount
  - umount2
  - pivot_root
  - swapon
  - swapoff
  - acct
  - settimeofday
  - adjtimex
  - clock_adjtime
  - clock_settime
  - nfsservctl
  - quotactl
  - add_key
  - request_key
  - keyctl
  - bpf
  - userfaultfd
  - perf_event_open
```

## eBPF Program Pseudocode

### 1. Main Syscall Hook (sys_enter)

```c
// syscall_detector.bpf.c (pseudocode)

#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

// Map: Process tracking (pid -> metadata)
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, u32);       // pid
    __type(value, struct proc_info);
} process_map SEC(".maps");

// Map: Syscall allowlist (syscall_nr -> allowed bitmap)
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 512);  // Max syscall number
    __type(key, u32);
    __type(value, struct allowlist_entry);
} allowlist SEC(".maps");

// Map: Events ring buffer
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);  // 256KB
} events SEC(".maps");

// Map: Statistics
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, struct stats);
} stats_map SEC(".maps");

// Process info structure
struct proc_info {
    u32 pid;
    u32 tgid;
    u32 uid;
    u64 start_time;
    char comm[16];
    u8 language_id;    // 0=unknown, 1=python, 2=js, 3=compiled
    u8 monitored;      // Is this a code execution process?
    u8 violation_count;
};

// Allowlist entry
struct allowlist_entry {
    u64 language_bitmap;  // Bit per language type
    u8 is_critical;       // Log even if allowed
};

// Event structure
struct syscall_event {
    u64 timestamp;
    u32 pid;
    u32 tgid;
    u32 uid;
    u32 syscall_nr;
    char comm[16];
    u8 language_id;
    u8 action;  // 0=allowed, 1=denied, 2=violation
    s64 arg0;
    s64 arg1;
    s64 arg2;
};

// Statistics
struct stats {
    u64 total_syscalls;
    u64 allowed_syscalls;
    u64 denied_syscalls;
    u64 violations;
};

// Check if process should be monitored
static __always_inline bool is_monitored_process(u32 pid) {
    struct proc_info *info = bpf_map_lookup_elem(&process_map, &pid);
    return info != NULL && info->monitored;
}

// Get language ID from process
static __always_inline u8 get_language_id(u32 pid) {
    struct proc_info *info = bpf_map_lookup_elem(&process_map, &pid);
    if (info)
        return info->language_id;
    return 0;  // Unknown
}

// Check if syscall is allowed for language
static __always_inline bool is_syscall_allowed(u32 syscall_nr, u8 language_id) {
    struct allowlist_entry *entry = bpf_map_lookup_elem(&allowlist, &syscall_nr);
    if (!entry)
        return false;  // Unknown syscall = denied
    
    // Check language-specific bit
    return (entry->language_bitmap & (1ULL << language_id)) != 0;
}

// Emit event to userspace
static __always_inline void emit_event(
    struct trace_event_raw_sys_enter *ctx,
    u32 pid,
    u32 syscall_nr,
    u8 language_id,
    u8 action
) {
    struct syscall_event *event;
    
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event)
        return;
    
    event->timestamp = bpf_ktime_get_ns();
    event->pid = pid;
    event->tgid = bpf_get_current_pid_tgid() >> 32;
    event->uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event->syscall_nr = syscall_nr;
    event->language_id = language_id;
    event->action = action;
    event->arg0 = ctx->args[0];
    event->arg1 = ctx->args[1];
    event->arg2 = ctx->args[2];
    
    bpf_get_current_comm(&event->comm, sizeof(event->comm));
    
    bpf_ringbuf_submit(event, 0);
}

// Update statistics
static __always_inline void update_stats(u8 action) {
    u32 key = 0;
    struct stats *stats = bpf_map_lookup_elem(&stats_map, &key);
    if (!stats)
        return;
    
    __sync_fetch_and_add(&stats->total_syscalls, 1);
    
    switch (action) {
        case 0:  // Allowed
            __sync_fetch_and_add(&stats->allowed_syscalls, 1);
            break;
        case 1:  // Denied
            __sync_fetch_and_add(&stats->denied_syscalls, 1);
            break;
        case 2:  // Violation
            __sync_fetch_and_add(&stats->violations, 1);
            break;
    }
}

// Main syscall entry hook
SEC("tracepoint/raw_syscalls/sys_enter")
int tracepoint__sys_enter(struct trace_event_raw_sys_enter *ctx) {
    u32 pid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    u32 syscall_nr = ctx->id;
    
    // Skip if not a monitored process
    if (!is_monitored_process(pid))
        return 0;
    
    u8 language_id = get_language_id(pid);
    u8 action = 0;
    
    // Check allowlist
    if (is_syscall_allowed(syscall_nr, language_id)) {
        action = 0;  // Allowed
        
        // Check if critical syscall (log anyway)
        struct allowlist_entry *entry = bpf_map_lookup_elem(&allowlist, &syscall_nr);
        if (entry && entry->is_critical) {
            emit_event(ctx, pid, syscall_nr, language_id, action);
        }
    } else {
        // Check if explicitly denied (violation) or just not in allowlist
        // Denied syscalls should trigger immediate alert
        action = 2;  // Violation
        
        // Emit event for violation
        emit_event(ctx, pid, syscall_nr, language_id, action);
        
        // Optionally: kill the process
        // bpf_send_signal(SIGKILL);
    }
    
    update_stats(action);
    
    return 0;
}

// Process exec hook - detect new code execution processes
SEC("tracepoint/sched/sched_process_exec")
int tracepoint__sched_process_exec(struct trace_event_raw_sched_process_exec *ctx) {
    u32 pid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    
    // Get comm name
    char comm[16];
    bpf_get_current_comm(&comm, sizeof(comm));
    
    // Check if this is a code execution process
    // (Would normally check parent PID or cgroup)
    u8 language_id = 0;
    bool monitored = false;
    
    // Simple command detection (real implementation would use cgroup)
    if (__builtin_memcmp(comm, "python", 6) == 0) {
        language_id = 1;
        monitored = true;
    } else if (__builtin_memcmp(comm, "node", 4) == 0) {
        language_id = 2;
        monitored = true;
    } else if (__builtin_memcmp(comm, "java", 4) == 0) {
        language_id = 3;
        monitored = true;
    } else if (__builtin_memcmp(comm, "gcc", 3) == 0 ||
               __builtin_memcmp(comm, "g++", 3) == 0 ||
               __builtin_memcmp(comm, "rustc", 5) == 0 ||
               __builtin_memcmp(comm, "go", 2) == 0) {
        language_id = 4;  // Compiled
        monitored = true;
    }
    
    if (monitored) {
        struct proc_info info = {
            .pid = pid,
            .tgid = bpf_get_current_pid_tgid() >> 32,
            .uid = bpf_get_current_uid_gid() & 0xFFFFFFFF,
            .start_time = bpf_ktime_get_ns(),
            .language_id = language_id,
            .monitored = 1,
            .violation_count = 0,
        };
        __builtin_memcpy(info.comm, comm, 16);
        
        bpf_map_update_elem(&process_map, &pid, &info, BPF_ANY);
    }
    
    return 0;
}

// Process exit hook - cleanup
SEC("tracepoint/sched/sched_process_exit")
int tracepoint__sched_process_exit(void *ctx) {
    u32 pid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    
    // Remove from process map
    bpf_map_delete_elem(&process_map, &pid);
    
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
```

### 2. User-Space Detector Service (Python)

```python
#!/usr/bin/env python3
"""
eBPF Syscall Detector Service

Loads eBPF programs, processes events, and exports metrics.
"""

import os
import sys
import json
import signal
import ctypes
from dataclasses import dataclass
from typing import Dict, Set, Optional
from collections import defaultdict
import threading
import time

# BCC for eBPF (or libbpf)
from bcc import BPF
from prometheus_client import Counter, Gauge, start_http_server


@dataclass
class SyscallEvent:
    """Event from eBPF ring buffer"""
    timestamp: int
    pid: int
    tgid: int
    uid: int
    syscall_nr: int
    comm: str
    language_id: int
    action: int  # 0=allowed, 1=denied, 2=violation
    arg0: int
    arg1: int
    arg2: int


@dataclass
class PolicyConfig:
    """Syscall policy configuration"""
    allowlist: Dict[int, Set[int]]  # syscall_nr -> set of language_ids
    denylist: Set[int]              # Always denied syscalls
    critical: Set[int]              # Log even when allowed


class SyscallDetector:
    """Main detector class"""
    
    # Prometheus metrics
    syscalls_total = Counter(
        'ebpf_syscalls_total',
        'Total syscalls observed',
        ['language', 'action']
    )
    
    violations_total = Counter(
        'ebpf_syscall_violations_total',
        'Syscall violations detected',
        ['language', 'syscall']
    )
    
    monitored_processes = Gauge(
        'ebpf_monitored_processes',
        'Number of monitored processes',
        ['language']
    )
    
    def __init__(self, policy_path: str):
        self.policy = self._load_policy(policy_path)
        self.bpf: Optional[BPF] = None
        self.running = False
        self._process_counts: Dict[int, int] = defaultdict(int)
        
    def _load_policy(self, path: str) -> PolicyConfig:
        """Load syscall policy from YAML"""
        import yaml
        
        with open(path) as f:
            config = yaml.safe_load(f)
        
        # Build allowlist
        allowlist = {}
        syscall_names = self._get_syscall_map()
        
        for lang_name, lang_config in config.items():
            if lang_name in ('default', 'denied'):
                continue
                
            lang_id = self._get_language_id(lang_name)
            allowed_syscalls = set()
            
            # Inherit from parent
            if 'inherit' in lang_config:
                parent = config.get(lang_config['inherit'], {})
                allowed_syscalls.update(
                    syscall_names.get(s, -1) 
                    for s in parent.get('allow', [])
                )
            
            # Add language-specific
            allowed_syscalls.update(
                syscall_names.get(s, -1) 
                for s in lang_config.get('allow', [])
            )
            
            # Add to allowlist
            for syscall_nr in allowed_syscalls:
                if syscall_nr < 0:
                    continue
                if syscall_nr not in allowlist:
                    allowlist[syscall_nr] = set()
                allowlist[syscall_nr].add(lang_id)
        
        # Build denylist
        denylist = set(
            syscall_names.get(s, -1)
            for s in config.get('denied', [])
        )
        denylist.discard(-1)
        
        return PolicyConfig(
            allowlist=allowlist,
            denylist=denylist,
            critical=set()
        )
    
    def _get_syscall_map(self) -> Dict[str, int]:
        """Get syscall name -> number mapping"""
        import subprocess
        
        # Use ausyscall or parse unistd.h
        result = subprocess.run(
            ['ausyscall', '--dump'],
            capture_output=True,
            text=True
        )
        
        syscalls = {}
        for line in result.stdout.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 2:
                try:
                    syscalls[parts[1]] = int(parts[0])
                except ValueError:
                    pass
        
        return syscalls
    
    def _get_language_id(self, name: str) -> int:
        """Map language name to ID"""
        mapping = {
            'default': 0,
            'python': 1,
            'javascript': 2,
            'java': 3,
            'compiled': 4,
            'c': 4,
            'cpp': 4,
            'rust': 4,
            'go': 4,
        }
        return mapping.get(name.lower(), 0)
    
    def _get_language_name(self, lang_id: int) -> str:
        """Map language ID to name"""
        mapping = {
            0: 'unknown',
            1: 'python',
            2: 'javascript',
            3: 'java',
            4: 'compiled',
        }
        return mapping.get(lang_id, 'unknown')
    
    def _get_syscall_name(self, nr: int) -> str:
        """Get syscall name from number"""
        import subprocess
        
        result = subprocess.run(
            ['ausyscall', str(nr)],
            capture_output=True,
            text=True
        )
        return result.stdout.strip() or f'syscall_{nr}'
    
    def _handle_event(self, cpu: int, data: ctypes.c_void_p, size: int):
        """Handle event from ring buffer"""
        event = ctypes.cast(data, ctypes.POINTER(SyscallEventStruct)).contents
        
        syscall_event = SyscallEvent(
            timestamp=event.timestamp,
            pid=event.pid,
            tgid=event.tgid,
            uid=event.uid,
            syscall_nr=event.syscall_nr,
            comm=event.comm.decode('utf-8', errors='ignore'),
            language_id=event.language_id,
            action=event.action,
            arg0=event.arg0,
            arg1=event.arg1,
            arg2=event.arg2,
        )
        
        language = self._get_language_name(syscall_event.language_id)
        action_name = ['allowed', 'denied', 'violation'][syscall_event.action]
        
        # Update metrics
        self.syscalls_total.labels(
            language=language,
            action=action_name
        ).inc()
        
        if syscall_event.action == 2:  # Violation
            syscall_name = self._get_syscall_name(syscall_event.syscall_nr)
            self.violations_total.labels(
                language=language,
                syscall=syscall_name
            ).inc()
            
            # Log violation
            self._log_violation(syscall_event)
    
    def _log_violation(self, event: SyscallEvent):
        """Log syscall violation"""
        syscall_name = self._get_syscall_name(event.syscall_nr)
        language = self._get_language_name(event.language_id)
        
        log_entry = {
            'timestamp': event.timestamp,
            'level': 'warning',
            'type': 'syscall_violation',
            'pid': event.pid,
            'uid': event.uid,
            'comm': event.comm,
            'language': language,
            'syscall': syscall_name,
            'syscall_nr': event.syscall_nr,
            'args': [event.arg0, event.arg1, event.arg2],
        }
        
        print(json.dumps(log_entry), flush=True)
    
    def load_bpf(self):
        """Load eBPF programs"""
        bpf_source = self._generate_bpf_source()
        self.bpf = BPF(text=bpf_source)
        
        # Populate allowlist map
        allowlist_map = self.bpf["allowlist"]
        for syscall_nr, lang_ids in self.policy.allowlist.items():
            bitmap = 0
            for lang_id in lang_ids:
                bitmap |= (1 << lang_id)
            allowlist_map[ctypes.c_uint32(syscall_nr)] = AllowlistEntry(
                language_bitmap=bitmap,
                is_critical=1 if syscall_nr in self.policy.critical else 0
            )
        
        # Open ring buffer
        self.bpf["events"].open_ring_buffer(self._handle_event)
    
    def run(self):
        """Main run loop"""
        self.running = True
        print("eBPF syscall detector started")
        
        try:
            while self.running:
                self.bpf.ring_buffer_poll(timeout=100)
        except KeyboardInterrupt:
            pass
        finally:
            self.running = False
            print("eBPF syscall detector stopped")
    
    def stop(self):
        """Stop the detector"""
        self.running = False


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='eBPF Syscall Detector')
    parser.add_argument('--policy', default='syscall_policy.yaml',
                       help='Path to syscall policy file')
    parser.add_argument('--metrics-port', type=int, default=9100,
                       help='Prometheus metrics port')
    args = parser.parse_args()
    
    # Start Prometheus metrics server
    start_http_server(args.metrics_port)
    print(f"Metrics server started on port {args.metrics_port}")
    
    # Create and run detector
    detector = SyscallDetector(args.policy)
    detector.load_bpf()
    
    # Handle signals
    def signal_handler(sig, frame):
        detector.stop()
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    detector.run()


if __name__ == '__main__':
    main()
```

## Integration with Code Execution Engine

### 1. Worker Integration

```typescript
// workers/executor-with-ebpf.ts

import { execSync } from 'child_process';

interface EbpfConfig {
  enabled: boolean;
  policyPath: string;
  killOnViolation: boolean;
}

export async function registerProcessWithEbpf(
  pid: number,
  language: string,
  containerId: string
): Promise<void> {
  // Write to eBPF map via bpftool or sysfs
  const languageId = getLanguageId(language);
  
  execSync(`bpftool map update name process_map key ${pid} value ${JSON.stringify({
    pid,
    language_id: languageId,
    monitored: 1,
    container_id: containerId,
  })}`);
}

export async function unregisterProcess(pid: number): Promise<void> {
  execSync(`bpftool map delete name process_map key ${pid}`);
}
```

### 2. Alert Integration

```yaml
# alertmanager_ebpf_rules.yml

groups:
  - name: ebpf_alerts
    rules:
      - alert: SyscallViolationDetected
        expr: increase(ebpf_syscall_violations_total[5m]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Syscall violation detected"
          description: "Process attempted disallowed syscall {{ $labels.syscall }}"

      - alert: HighViolationRate
        expr: rate(ebpf_syscall_violations_total[5m]) > 1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High syscall violation rate"
          description: "{{ $value }} violations per second"
```

## Deployment

### Prerequisites

- Linux kernel 5.10+ (for ring buffer support)
- BCC or libbpf installed
- CAP_BPF, CAP_PERFMON capabilities

### Container Deployment

```dockerfile
# Dockerfile.ebpf-detector
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    bpfcc-tools \
    libbpf-dev \
    python3-bpfcc \
    python3-prometheus-client \
    auditd \
    && rm -rf /var/lib/apt/lists/*

COPY syscall_detector.py /app/
COPY syscall_policy.yaml /app/

WORKDIR /app

# Requires privileged mode or specific capabilities
CMD ["python3", "syscall_detector.py"]
```

### Kubernetes DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ebpf-syscall-detector
  namespace: code-execution
spec:
  selector:
    matchLabels:
      app: ebpf-detector
  template:
    metadata:
      labels:
        app: ebpf-detector
    spec:
      hostPID: true
      hostNetwork: true
      containers:
        - name: detector
          image: ebpf-syscall-detector:latest
          securityContext:
            privileged: true
          volumeMounts:
            - name: sys
              mountPath: /sys
            - name: debugfs
              mountPath: /sys/kernel/debug
      volumes:
        - name: sys
          hostPath:
            path: /sys
        - name: debugfs
          hostPath:
            path: /sys/kernel/debug
```

## Limitations

1. **Performance overhead**: ~1-5% CPU overhead for syscall tracing
2. **Kernel version**: Requires kernel 5.x+ for all features
3. **Privileged access**: Needs root or specific capabilities
4. **Policy complexity**: Maintaining per-language allowlists requires effort

## Alternatives

1. **seccomp-bpf**: Simpler but less flexible (no per-process policies)
2. **AppArmor/SELinux**: Profile-based, harder to make dynamic
3. **Sysdig Falco**: Higher-level rules engine (uses eBPF)
4. **Tracee**: Aqua's eBPF-based runtime security

