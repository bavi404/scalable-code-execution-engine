#!/bin/bash
#
# Network Isolation Script
#
# Blocks all network access for code execution using multiple methods.
# Run as root before executing user code.
#

set -euo pipefail

RUNNER_USER="${RUNNER_USER:-runner}"
RUNNER_UID=$(id -u "$RUNNER_USER" 2>/dev/null || echo "1000")

echo "[network] Setting up network isolation for user $RUNNER_USER (UID: $RUNNER_UID)"

# === Method 1: iptables (traditional) ===
setup_iptables() {
    echo "[network] Configuring iptables rules..."
    
    # Flush existing rules for runner user
    iptables -D OUTPUT -m owner --uid-owner "$RUNNER_UID" -j DROP 2>/dev/null || true
    iptables -D INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
    
    # Block all outgoing traffic from runner user
    iptables -A OUTPUT -m owner --uid-owner "$RUNNER_UID" -j DROP
    
    # Block all incoming traffic to runner user (except established)
    iptables -A INPUT -m owner --uid-owner "$RUNNER_UID" -m state --state NEW -j DROP
    
    echo "[network] iptables rules configured"
}

# === Method 2: Network Namespace (recommended) ===
setup_network_namespace() {
    echo "[network] Setting up network namespace..."
    
    # Create isolated network namespace
    ip netns add code_exec_ns 2>/dev/null || true
    
    # Only loopback in namespace (no external access)
    ip netns exec code_exec_ns ip link set lo up
    
    echo "[network] Network namespace 'code_exec_ns' created"
    echo "[network] Run commands with: ip netns exec code_exec_ns <command>"
    echo "[network] Or use: unshare -n <command>"
}

# === Method 3: Remove network tools ===
remove_network_tools() {
    echo "[network] Removing network tools..."
    
    # List of tools to remove or restrict
    local tools=(
        /bin/ping
        /usr/bin/ping
        /bin/nc
        /usr/bin/nc
        /usr/bin/netcat
        /usr/bin/wget
        /usr/bin/curl
        /usr/bin/ssh
        /usr/bin/scp
        /usr/bin/telnet
        /usr/bin/ftp
        /usr/bin/nmap
    )
    
    for tool in "${tools[@]}"; do
        if [ -f "$tool" ]; then
            chmod 700 "$tool" 2>/dev/null || true
            echo "[network] Restricted: $tool"
        fi
    done
}

# === Method 4: Seccomp (system call filtering) ===
create_seccomp_profile() {
    echo "[network] Creating seccomp profile..."
    
    cat > /etc/seccomp/code-runner.json <<'EOF'
{
    "defaultAction": "SCMP_ACT_ALLOW",
    "syscalls": [
        {
            "names": [
                "socket",
                "connect",
                "accept",
                "accept4",
                "bind",
                "listen",
                "sendto",
                "recvfrom",
                "sendmsg",
                "recvmsg",
                "shutdown",
                "setsockopt",
                "getsockopt"
            ],
            "action": "SCMP_ACT_ERRNO",
            "errnoRet": 1
        }
    ]
}
EOF
    
    echo "[network] Seccomp profile created at /etc/seccomp/code-runner.json"
    echo "[network] Use with Docker: --security-opt seccomp=/etc/seccomp/code-runner.json"
}

# === Verification ===
verify_isolation() {
    echo "[network] Verifying network isolation..."
    
    # Test as runner user
    if su -s /bin/bash "$RUNNER_USER" -c "timeout 2 ping -c1 8.8.8.8 2>&1" >/dev/null 2>&1; then
        echo "[network] WARNING: Network access still available!"
        return 1
    else
        echo "[network] OK: Network access blocked"
        return 0
    fi
}

# === Docker Network Mode ===
print_docker_instructions() {
    cat <<'EOF'

=== Docker Network Isolation ===

For Docker containers, use one of these methods:

1. No network at all (recommended):
   docker run --network none ...

2. Custom bridge with no external access:
   docker network create --internal isolated_net
   docker run --network isolated_net ...

3. With seccomp profile:
   docker run --security-opt seccomp=/etc/seccomp/code-runner.json ...

4. Full isolation:
   docker run \
     --network none \
     --cap-drop ALL \
     --security-opt no-new-privileges \
     --read-only \
     --tmpfs /tmp:rw,noexec,nosuid,size=64m \
     ...

EOF
}

# === Main ===
main() {
    local method="${1:-all}"
    
    case "$method" in
        iptables)
            setup_iptables
            ;;
        namespace)
            setup_network_namespace
            ;;
        tools)
            remove_network_tools
            ;;
        seccomp)
            mkdir -p /etc/seccomp
            create_seccomp_profile
            ;;
        verify)
            verify_isolation
            ;;
        docker)
            print_docker_instructions
            ;;
        all)
            setup_iptables || true
            setup_network_namespace || true
            remove_network_tools
            verify_isolation || true
            print_docker_instructions
            ;;
        *)
            echo "Usage: $0 [iptables|namespace|tools|seccomp|verify|docker|all]"
            exit 1
            ;;
    esac
}

main "$@"

