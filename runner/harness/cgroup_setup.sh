#!/bin/bash
#
# Cgroups v2 Setup Script
#
# Creates and configures cgroups for resource limiting during code execution.
# Supports both cgroups v1 and v2.
#
# Usage: ./cgroup_setup.sh <action> [options]
#   Actions: setup, run, cleanup, info
#

set -euo pipefail

CGROUP_NAME="${CGROUP_NAME:-code-exec}"
CGROUP_VERSION="${CGROUP_VERSION:-2}"

# Resource limits
MEMORY_LIMIT_KB="${MEMORY_LIMIT_KB:-262144}"      # 256MB
CPU_QUOTA="${CPU_QUOTA:-50000}"                    # 50% of one CPU
CPU_PERIOD="${CPU_PERIOD:-100000}"                 # 100ms period
PIDS_LIMIT="${PIDS_LIMIT:-50}"                     # Max processes
IO_WEIGHT="${IO_WEIGHT:-100}"                      # I/O weight (10-10000)

log() {
    echo "[cgroup] $(date +%Y-%m-%dT%H:%M:%S) $*" >&2
}

# ============================================================================
# Cgroups v2
# ============================================================================

get_cgroup_v2_path() {
    echo "/sys/fs/cgroup/$CGROUP_NAME"
}

setup_cgroup_v2() {
    local cgroup_path=$(get_cgroup_v2_path)
    
    log "Setting up cgroups v2 at: $cgroup_path"
    
    # Create cgroup directory
    if [[ ! -d "$cgroup_path" ]]; then
        sudo mkdir -p "$cgroup_path"
    fi
    
    # Enable controllers in parent
    local parent_path=$(dirname "$cgroup_path")
    echo "+cpu +memory +pids +io" | sudo tee "$parent_path/cgroup.subtree_control" > /dev/null 2>/dev/null || true
    
    # Set memory limit (in bytes)
    local memory_bytes=$((MEMORY_LIMIT_KB * 1024))
    echo "$memory_bytes" | sudo tee "$cgroup_path/memory.max" > /dev/null
    echo "$memory_bytes" | sudo tee "$cgroup_path/memory.swap.max" > /dev/null 2>/dev/null || true
    
    # Set CPU limit
    echo "$CPU_QUOTA $CPU_PERIOD" | sudo tee "$cgroup_path/cpu.max" > /dev/null
    
    # Set PID limit
    echo "$PIDS_LIMIT" | sudo tee "$cgroup_path/pids.max" > /dev/null
    
    # Set I/O weight
    echo "$IO_WEIGHT" | sudo tee "$cgroup_path/io.weight" > /dev/null 2>/dev/null || true
    
    log "Cgroups v2 setup complete"
    log "  Memory: ${MEMORY_LIMIT_KB}KB"
    log "  CPU: ${CPU_QUOTA}/${CPU_PERIOD} ($(echo "scale=2; $CPU_QUOTA * 100 / $CPU_PERIOD" | bc)%)"
    log "  PIDs: $PIDS_LIMIT"
}

run_in_cgroup_v2() {
    local cgroup_path=$(get_cgroup_v2_path)
    
    # Add current process to cgroup
    echo $$ | sudo tee "$cgroup_path/cgroup.procs" > /dev/null
    
    log "Process $$ added to cgroup"
    
    # Run command
    exec "$@"
}

get_cgroup_v2_stats() {
    local cgroup_path=$(get_cgroup_v2_path)
    
    echo "=== Cgroup Stats: $CGROUP_NAME ==="
    
    if [[ -f "$cgroup_path/memory.current" ]]; then
        local mem_current=$(cat "$cgroup_path/memory.current")
        local mem_max=$(cat "$cgroup_path/memory.max" 2>/dev/null || echo "max")
        echo "Memory: $(numfmt --to=iec $mem_current) / $(numfmt --to=iec $mem_max 2>/dev/null || echo $mem_max)"
    fi
    
    if [[ -f "$cgroup_path/memory.peak" ]]; then
        local mem_peak=$(cat "$cgroup_path/memory.peak")
        echo "Memory Peak: $(numfmt --to=iec $mem_peak)"
    fi
    
    if [[ -f "$cgroup_path/cpu.stat" ]]; then
        echo "CPU Stats:"
        cat "$cgroup_path/cpu.stat" | sed 's/^/  /'
    fi
    
    if [[ -f "$cgroup_path/pids.current" ]]; then
        local pids_current=$(cat "$cgroup_path/pids.current")
        local pids_max=$(cat "$cgroup_path/pids.max")
        echo "PIDs: $pids_current / $pids_max"
    fi
    
    if [[ -f "$cgroup_path/cgroup.procs" ]]; then
        local procs=$(cat "$cgroup_path/cgroup.procs" | wc -l)
        echo "Processes: $procs"
    fi
}

cleanup_cgroup_v2() {
    local cgroup_path=$(get_cgroup_v2_path)
    
    log "Cleaning up cgroup: $cgroup_path"
    
    # Kill all processes in cgroup
    if [[ -f "$cgroup_path/cgroup.procs" ]]; then
        cat "$cgroup_path/cgroup.procs" | while read pid; do
            if [[ -n "$pid" ]]; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        done
    fi
    
    # Wait for processes to die
    sleep 0.5
    
    # Remove cgroup
    sudo rmdir "$cgroup_path" 2>/dev/null || true
    
    log "Cgroup cleanup complete"
}

# ============================================================================
# Cgroups v1 (legacy)
# ============================================================================

setup_cgroup_v1() {
    local base_path="/sys/fs/cgroup"
    
    log "Setting up cgroups v1"
    
    # Memory cgroup
    local mem_path="$base_path/memory/$CGROUP_NAME"
    sudo mkdir -p "$mem_path"
    echo "$((MEMORY_LIMIT_KB * 1024))" | sudo tee "$mem_path/memory.limit_in_bytes" > /dev/null
    echo "$((MEMORY_LIMIT_KB * 1024))" | sudo tee "$mem_path/memory.memsw.limit_in_bytes" > /dev/null 2>/dev/null || true
    
    # CPU cgroup
    local cpu_path="$base_path/cpu/$CGROUP_NAME"
    sudo mkdir -p "$cpu_path"
    echo "$CPU_QUOTA" | sudo tee "$cpu_path/cpu.cfs_quota_us" > /dev/null
    echo "$CPU_PERIOD" | sudo tee "$cpu_path/cpu.cfs_period_us" > /dev/null
    
    # PIDs cgroup
    local pids_path="$base_path/pids/$CGROUP_NAME"
    sudo mkdir -p "$pids_path"
    echo "$PIDS_LIMIT" | sudo tee "$pids_path/pids.max" > /dev/null
    
    log "Cgroups v1 setup complete"
}

run_in_cgroup_v1() {
    local base_path="/sys/fs/cgroup"
    
    # Add current process to all cgroups
    echo $$ | sudo tee "$base_path/memory/$CGROUP_NAME/cgroup.procs" > /dev/null
    echo $$ | sudo tee "$base_path/cpu/$CGROUP_NAME/cgroup.procs" > /dev/null
    echo $$ | sudo tee "$base_path/pids/$CGROUP_NAME/cgroup.procs" > /dev/null
    
    log "Process $$ added to cgroup"
    
    # Run command
    exec "$@"
}

cleanup_cgroup_v1() {
    local base_path="/sys/fs/cgroup"
    
    log "Cleaning up cgroups v1"
    
    for subsys in memory cpu pids; do
        local cgroup_path="$base_path/$subsys/$CGROUP_NAME"
        if [[ -d "$cgroup_path" ]]; then
            # Kill processes
            if [[ -f "$cgroup_path/cgroup.procs" ]]; then
                cat "$cgroup_path/cgroup.procs" | while read pid; do
                    if [[ -n "$pid" ]]; then
                        kill -9 "$pid" 2>/dev/null || true
                    fi
                done
            fi
            # Remove cgroup
            sudo rmdir "$cgroup_path" 2>/dev/null || true
        fi
    done
    
    log "Cgroups v1 cleanup complete"
}

# ============================================================================
# Helper: Use cgexec (from cgroup-tools)
# ============================================================================

run_with_cgexec() {
    log "Running with cgexec"
    
    if [[ "$CGROUP_VERSION" == "2" ]]; then
        # For cgroups v2, use systemd-run or direct cgroup
        exec systemd-run --scope --unit="code-exec-$$" \
            -p MemoryMax="${MEMORY_LIMIT_KB}K" \
            -p CPUQuota="${CPU_QUOTA}%" \
            -p TasksMax="$PIDS_LIMIT" \
            "$@"
    else
        # For cgroups v1, use cgexec
        exec cgexec -g "memory,cpu,pids:$CGROUP_NAME" "$@"
    fi
}

# ============================================================================
# Detect cgroup version
# ============================================================================

detect_cgroup_version() {
    if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
        echo "2"
    elif [[ -d /sys/fs/cgroup/memory ]]; then
        echo "1"
    else
        echo "unknown"
    fi
}

# ============================================================================
# Main
# ============================================================================

ACTION="${1:-help}"
shift || true

# Auto-detect cgroup version
if [[ "$CGROUP_VERSION" == "auto" ]]; then
    CGROUP_VERSION=$(detect_cgroup_version)
    log "Detected cgroup version: $CGROUP_VERSION"
fi

case "$ACTION" in
    setup)
        if [[ "$CGROUP_VERSION" == "2" ]]; then
            setup_cgroup_v2
        else
            setup_cgroup_v1
        fi
        ;;
    
    run)
        if [[ "$CGROUP_VERSION" == "2" ]]; then
            run_in_cgroup_v2 "$@"
        else
            run_in_cgroup_v1 "$@"
        fi
        ;;
    
    cgexec)
        run_with_cgexec "$@"
        ;;
    
    cleanup)
        if [[ "$CGROUP_VERSION" == "2" ]]; then
            cleanup_cgroup_v2
        else
            cleanup_cgroup_v1
        fi
        ;;
    
    stats|info)
        if [[ "$CGROUP_VERSION" == "2" ]]; then
            get_cgroup_v2_stats
        else
            echo "Stats not implemented for cgroups v1"
        fi
        ;;
    
    detect)
        echo "Cgroup version: $(detect_cgroup_version)"
        ;;
    
    help|*)
        cat <<EOF
Usage: $0 <action> [options]

Actions:
  setup     Create and configure cgroup
  run       Run command in cgroup
  cgexec    Run using cgexec/systemd-run
  cleanup   Remove cgroup and kill processes
  stats     Show cgroup statistics
  detect    Detect cgroup version

Environment Variables:
  CGROUP_NAME       Name of the cgroup (default: code-exec)
  CGROUP_VERSION    Cgroup version: 1, 2, or auto (default: 2)
  MEMORY_LIMIT_KB   Memory limit in KB (default: 262144 = 256MB)
  CPU_QUOTA         CPU quota in microseconds (default: 50000)
  CPU_PERIOD        CPU period in microseconds (default: 100000)
  PIDS_LIMIT        Max processes (default: 50)
  IO_WEIGHT         I/O weight 10-10000 (default: 100)

Examples:
  # Setup cgroup with 128MB memory limit
  MEMORY_LIMIT_KB=131072 $0 setup

  # Run command in cgroup
  $0 run /path/to/program arg1 arg2

  # Show stats
  $0 stats

  # Cleanup
  $0 cleanup
EOF
        ;;
esac

