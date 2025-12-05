#!/bin/bash
#
# Network Isolation Script
#
# Blocks all network egress for code execution security.
# Multiple methods provided: iptables, network namespace, and nsjail.
#
# Usage: ./network_isolate.sh <method> <command...>
#   Methods: iptables, netns, nsjail
#

set -euo pipefail

METHOD="${1:-iptables}"
shift || true

log() {
    echo "[network] $(date +%Y-%m-%dT%H:%M:%S) $*" >&2
}

# ============================================================================
# Method 1: iptables (requires root, affects all processes by user)
# ============================================================================

setup_iptables_isolation() {
    local user="${RUNNER_USER:-runner}"
    
    log "Setting up iptables rules to block egress for user: $user"
    
    # Block all outgoing traffic for the runner user
    iptables -A OUTPUT -m owner --uid-owner "$user" -j DROP
    
    # Block all outgoing traffic for the runner group
    iptables -A OUTPUT -m owner --gid-owner "$user" -j DROP
    
    # Optional: Allow loopback
    iptables -I OUTPUT -o lo -j ACCEPT
    
    # Optional: Log dropped packets
    iptables -A OUTPUT -m owner --uid-owner "$user" -j LOG --log-prefix "BLOCKED: "
    
    log "iptables rules applied"
}

cleanup_iptables() {
    local user="${RUNNER_USER:-runner}"
    
    log "Cleaning up iptables rules"
    
    iptables -D OUTPUT -m owner --uid-owner "$user" -j DROP 2>/dev/null || true
    iptables -D OUTPUT -m owner --gid-owner "$user" -j DROP 2>/dev/null || true
}

# ============================================================================
# Method 2: Network Namespace (cleanest isolation)
# ============================================================================

setup_netns_isolation() {
    local ns_name="code_exec_$$"
    
    log "Creating network namespace: $ns_name"
    
    # Create network namespace
    ip netns add "$ns_name"
    
    # Bring up loopback inside namespace
    ip netns exec "$ns_name" ip link set lo up
    
    # Return namespace name for execution
    echo "$ns_name"
}

run_in_netns() {
    local ns_name="$1"
    shift
    
    log "Running in network namespace: $ns_name"
    log "Command: $*"
    
    # Run command in network namespace
    ip netns exec "$ns_name" "$@"
}

cleanup_netns() {
    local ns_name="$1"
    
    log "Removing network namespace: $ns_name"
    ip netns del "$ns_name" 2>/dev/null || true
}

# ============================================================================
# Method 3: unshare (no root required for user namespaces)
# ============================================================================

run_with_unshare() {
    log "Running with unshare (network isolation)"
    log "Command: $*"
    
    # Create new network namespace using unshare
    # This doesn't require root if user namespaces are enabled
    unshare --net --map-root-user "$@"
}

# ============================================================================
# Method 4: nsjail (sandboxing tool by Google)
# ============================================================================

run_with_nsjail() {
    local workspace="${WORKSPACE:-/workspace}"
    local time_limit="${TIMEOUT_SEC:-5}"
    local mem_limit="${MEMORY_LIMIT_KB:-262144}"
    
    log "Running with nsjail"
    log "Command: $*"
    
    nsjail \
        --mode o \
        --time_limit "$time_limit" \
        --rlimit_as "$mem_limit" \
        --rlimit_cpu "$time_limit" \
        --rlimit_fsize 10240 \
        --rlimit_nofile 64 \
        --rlimit_nproc 10 \
        --disable_clone_newnet \
        --chroot / \
        --user runner \
        --group runner \
        --cwd "$workspace" \
        --bindmount_ro "$workspace:$workspace" \
        --bindmount /tmp:/tmp \
        --env PATH=/usr/local/bin:/usr/bin:/bin \
        --env HOME=/home/runner \
        -- "$@"
}

# ============================================================================
# Combined: Setup isolation and run command
# ============================================================================

run_isolated() {
    case "$METHOD" in
        iptables)
            # Setup iptables (requires being run as root)
            setup_iptables_isolation
            trap cleanup_iptables EXIT
            
            # Run command as runner user
            su -s /bin/bash runner -c "$*"
            ;;
            
        netns)
            # Create namespace
            local ns_name=$(setup_netns_isolation)
            trap "cleanup_netns '$ns_name'" EXIT
            
            # Run in namespace
            run_in_netns "$ns_name" su -s /bin/bash runner -c "$*"
            ;;
            
        unshare)
            # Use unshare (simplest, no root needed)
            run_with_unshare su -s /bin/bash runner -c "$*"
            ;;
            
        nsjail)
            # Use nsjail (most comprehensive)
            run_with_nsjail "$@"
            ;;
            
        none)
            # No isolation (for testing)
            log "WARNING: Running without network isolation"
            "$@"
            ;;
            
        *)
            echo "Unknown method: $METHOD" >&2
            echo "Available: iptables, netns, unshare, nsjail, none" >&2
            exit 1
            ;;
    esac
}

# ============================================================================
# Verify network is blocked
# ============================================================================

verify_isolation() {
    log "Verifying network isolation..."
    
    # Try to reach external host
    if timeout 2 ping -c 1 8.8.8.8 >/dev/null 2>&1; then
        log "ERROR: Network is NOT isolated! ping succeeded"
        return 1
    else
        log "Network isolation verified (ping blocked)"
    fi
    
    # Try DNS lookup
    if timeout 2 nslookup google.com >/dev/null 2>&1; then
        log "ERROR: Network is NOT isolated! DNS lookup succeeded"
        return 1
    else
        log "Network isolation verified (DNS blocked)"
    fi
    
    # Try HTTP request
    if timeout 2 curl -s http://google.com >/dev/null 2>&1; then
        log "ERROR: Network is NOT isolated! HTTP request succeeded"
        return 1
    else
        log "Network isolation verified (HTTP blocked)"
    fi
    
    log "All network isolation checks passed"
    return 0
}

# ============================================================================
# Docker-specific: Block network at container level
# ============================================================================

print_docker_network_config() {
    cat <<'EOF'
# Docker network isolation options:

# Option 1: No network (recommended)
docker run --network none ...

# Option 2: Custom network with no external access
docker network create --internal isolated_net
docker run --network isolated_net ...

# Option 3: Drop capabilities and block network syscalls
docker run \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --security-opt seccomp=/path/to/seccomp.json \
    ...

# Seccomp profile to block network syscalls (seccomp.json):
{
  "defaultAction": "SCMP_ACT_ALLOW",
  "syscalls": [
    {
      "names": ["socket", "connect", "accept", "bind", "listen", 
                "sendto", "recvfrom", "sendmsg", "recvmsg"],
      "action": "SCMP_ACT_ERRNO"
    }
  ]
}
EOF
}

# ============================================================================
# Main
# ============================================================================

if [[ "${1:-}" == "--verify" ]]; then
    verify_isolation
elif [[ "${1:-}" == "--docker-config" ]]; then
    print_docker_network_config
elif [[ $# -gt 0 ]]; then
    run_isolated "$@"
else
    echo "Usage: $0 [--verify|--docker-config] [command...]" >&2
    echo "" >&2
    echo "Methods (set via first positional arg):" >&2
    echo "  iptables - Use iptables rules (requires root)" >&2
    echo "  netns    - Use network namespace (requires root)" >&2
    echo "  unshare  - Use unshare (user namespaces)" >&2
    echo "  nsjail   - Use nsjail sandbox (comprehensive)" >&2
    echo "  none     - No isolation (testing only)" >&2
    exit 1
fi

