#!/bin/bash
#
# Code Execution Harness
#
# Compiles (if needed), runs code with resource limits,
# captures output, measures performance, and writes JSON results.
#
# Usage: ./harness.sh <language> <code_file> <timeout_sec> <memory_mb> [test_cases_file]
#
# Environment:
#   WORKSPACE_DIR  - Directory containing code (default: /workspace)
#   OUTPUT_DIR     - Directory for results (default: /output)
#   USE_CGROUPS    - Use cgroups for limits (default: false)
#   USE_SECCOMP    - Enable seccomp filtering (default: true)
#

set -euo pipefail

# === Configuration ===
LANGUAGE="${1:-javascript}"
CODE_FILE="${2:-solution.js}"
TIMEOUT_SEC="${3:-5}"
MEMORY_MB="${4:-256}"
TEST_CASES_FILE="${5:-}"

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
USE_CGROUPS="${USE_CGROUPS:-false}"
USE_SECCOMP="${USE_SECCOMP:-true}"

# Derived values
MEMORY_KB=$((MEMORY_MB * 1024))
MEMORY_BYTES=$((MEMORY_MB * 1024 * 1024))

# Result file
RESULT_FILE="${OUTPUT_DIR}/result.json"

# Temporary files
COMPILE_STDOUT=$(mktemp)
COMPILE_STDERR=$(mktemp)
RUN_STDOUT=$(mktemp)
RUN_STDERR=$(mktemp)
TIME_OUTPUT=$(mktemp)

# Cleanup on exit
cleanup() {
    rm -f "$COMPILE_STDOUT" "$COMPILE_STDERR" "$RUN_STDOUT" "$RUN_STDERR" "$TIME_OUTPUT"
}
trap cleanup EXIT

# === Logging ===
log() {
    echo "[harness] $(date '+%Y-%m-%d %H:%M:%S') $*" >&2
}

error() {
    echo "[harness] ERROR: $*" >&2
}

# === Network Isolation ===
# Block all network access (run as root before dropping privileges)
setup_network_isolation() {
    log "Setting up network isolation..."
    
    # Method 1: iptables (if available and running as root)
    if command -v iptables &>/dev/null && [ "$(id -u)" = "0" ]; then
        # Block all outgoing traffic
        iptables -A OUTPUT -m owner --uid-owner runner -j DROP 2>/dev/null || true
        # Block all incoming traffic  
        iptables -A INPUT -m owner --uid-owner runner -j DROP 2>/dev/null || true
        log "Network blocked via iptables"
    fi
    
    # Method 2: Unshare network namespace (preferred)
    # This is handled by running the command with `unshare -n`
    
    # Method 3: Remove network tools
    # Already done in Dockerfile
}

# === Cgroups Setup ===
setup_cgroups() {
    local cgroup_name="code-execution-$$"
    local cgroup_path="/sys/fs/cgroup/${cgroup_name}"
    
    log "Setting up cgroups: $cgroup_name"
    
    # Create cgroup (cgroups v2)
    if [ -d "/sys/fs/cgroup/cgroup.controllers" ]; then
        mkdir -p "$cgroup_path"
        
        # Memory limit
        echo "$MEMORY_BYTES" > "${cgroup_path}/memory.max"
        echo "$MEMORY_BYTES" > "${cgroup_path}/memory.swap.max"
        
        # CPU limit (optional - limit to 1 CPU)
        echo "100000 100000" > "${cgroup_path}/cpu.max"
        
        # PID limit
        echo "50" > "${cgroup_path}/pids.max"
        
        # Add current process to cgroup
        echo $$ > "${cgroup_path}/cgroup.procs"
        
        log "Cgroups v2 configured"
    # Cgroups v1 fallback
    elif [ -d "/sys/fs/cgroup/memory" ]; then
        mkdir -p "/sys/fs/cgroup/memory/${cgroup_name}"
        mkdir -p "/sys/fs/cgroup/cpu/${cgroup_name}"
        mkdir -p "/sys/fs/cgroup/pids/${cgroup_name}"
        
        echo "$MEMORY_BYTES" > "/sys/fs/cgroup/memory/${cgroup_name}/memory.limit_in_bytes"
        echo "50000" > "/sys/fs/cgroup/cpu/${cgroup_name}/cpu.cfs_quota_us"
        echo "100000" > "/sys/fs/cgroup/cpu/${cgroup_name}/cpu.cfs_period_us"
        echo "50" > "/sys/fs/cgroup/pids/${cgroup_name}/pids.max"
        
        echo $$ > "/sys/fs/cgroup/memory/${cgroup_name}/tasks"
        echo $$ > "/sys/fs/cgroup/cpu/${cgroup_name}/tasks"
        echo $$ > "/sys/fs/cgroup/pids/${cgroup_name}/tasks"
        
        log "Cgroups v1 configured"
    else
        log "Cgroups not available, using prlimit"
    fi
}

# === Resource Limit Command Builder ===
build_limit_cmd() {
    local cmd=""
    
    if [ "$USE_CGROUPS" = "true" ]; then
        # Cgroups handle limits
        cmd="timeout --signal=KILL ${TIMEOUT_SEC}s"
    else
        # Use timeout + prlimit
        cmd="timeout --signal=KILL ${TIMEOUT_SEC}s"
        
        # prlimit for memory and CPU
        if command -v prlimit &>/dev/null; then
            # Virtual memory limit
            cmd="prlimit --as=${MEMORY_BYTES} --cpu=${TIMEOUT_SEC} $cmd"
        fi
    fi
    
    # Unshare network namespace (no network access)
    if command -v unshare &>/dev/null; then
        cmd="unshare -n $cmd"
    fi
    
    echo "$cmd"
}

# === Language-Specific Configuration ===
get_compile_cmd() {
    case "$LANGUAGE" in
        c)
            echo "gcc -O2 -std=c17 -o solution ${CODE_FILE}"
            ;;
        cpp|c++)
            echo "g++ -O2 -std=c++17 -o solution ${CODE_FILE}"
            ;;
        java)
            echo "javac ${CODE_FILE}"
            ;;
        rust)
            echo "rustc -O -o solution ${CODE_FILE}"
            ;;
        go)
            echo "go build -o solution ${CODE_FILE}"
            ;;
        typescript)
            echo "tsc ${CODE_FILE} --outDir ."
            ;;
        *)
            echo ""  # No compilation needed
            ;;
    esac
}

get_run_cmd() {
    case "$LANGUAGE" in
        javascript)
            echo "node ${CODE_FILE}"
            ;;
        typescript)
            # Run compiled JS or use ts-node
            local js_file="${CODE_FILE%.ts}.js"
            if [ -f "$js_file" ]; then
                echo "node ${js_file}"
            else
                echo "npx ts-node ${CODE_FILE}"
            fi
            ;;
        python)
            echo "python3 ${CODE_FILE}"
            ;;
        c|cpp|c++|rust|go)
            echo "./solution"
            ;;
        java)
            local class_name="${CODE_FILE%.java}"
            echo "java ${class_name}"
            ;;
        ruby)
            echo "ruby ${CODE_FILE}"
            ;;
        php)
            echo "php ${CODE_FILE}"
            ;;
        *)
            error "Unsupported language: $LANGUAGE"
            exit 1
            ;;
    esac
}

# === Compilation ===
compile_code() {
    local compile_cmd
    compile_cmd=$(get_compile_cmd)
    
    if [ -z "$compile_cmd" ]; then
        log "No compilation needed for $LANGUAGE"
        echo '{"needed": false}'
        return 0
    fi
    
    log "Compiling: $compile_cmd"
    
    local start_time
    start_time=$(date +%s%N)
    
    # Run compilation with timeout
    local compile_exit=0
    timeout 30s bash -c "cd $WORKSPACE_DIR && $compile_cmd" \
        > "$COMPILE_STDOUT" 2> "$COMPILE_STDERR" || compile_exit=$?
    
    local end_time
    end_time=$(date +%s%N)
    local compile_time_ms=$(( (end_time - start_time) / 1000000 ))
    
    local stdout_content
    local stderr_content
    stdout_content=$(cat "$COMPILE_STDOUT" | head -c 10000)
    stderr_content=$(cat "$COMPILE_STDERR" | head -c 10000)
    
    if [ $compile_exit -ne 0 ]; then
        error "Compilation failed with exit code $compile_exit"
        cat <<EOF
{
    "needed": true,
    "success": false,
    "exitCode": $compile_exit,
    "timeMs": $compile_time_ms,
    "stdout": $(echo "$stdout_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    "stderr": $(echo "$stderr_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
}
EOF
        return 1
    fi
    
    log "Compilation successful in ${compile_time_ms}ms"
    cat <<EOF
{
    "needed": true,
    "success": true,
    "exitCode": 0,
    "timeMs": $compile_time_ms,
    "stdout": $(echo "$stdout_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    "stderr": $(echo "$stderr_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
}
EOF
    return 0
}

# === Single Execution ===
run_once() {
    local input="$1"
    local expected_output="$2"
    local test_id="$3"
    
    local run_cmd
    run_cmd=$(get_run_cmd)
    local limit_cmd
    limit_cmd=$(build_limit_cmd)
    
    log "Running test $test_id: $limit_cmd $run_cmd"
    
    local start_time
    start_time=$(date +%s%N)
    
    # Run with /usr/bin/time for memory measurement
    local run_exit=0
    if [ -n "$input" ]; then
        echo -n "$input" | \
            /usr/bin/time -v -o "$TIME_OUTPUT" \
            bash -c "cd $WORKSPACE_DIR && $limit_cmd $run_cmd" \
            > "$RUN_STDOUT" 2> "$RUN_STDERR" || run_exit=$?
    else
        /usr/bin/time -v -o "$TIME_OUTPUT" \
            bash -c "cd $WORKSPACE_DIR && $limit_cmd $run_cmd" \
            > "$RUN_STDOUT" 2> "$RUN_STDERR" || run_exit=$?
    fi
    
    local end_time
    end_time=$(date +%s%N)
    local run_time_ms=$(( (end_time - start_time) / 1000000 ))
    
    # Parse memory from time output
    local memory_kb=0
    if [ -f "$TIME_OUTPUT" ]; then
        memory_kb=$(grep "Maximum resident set size" "$TIME_OUTPUT" | awk '{print $NF}' || echo "0")
    fi
    
    # Read outputs (truncate if too large)
    local stdout_content
    local stderr_content
    stdout_content=$(cat "$RUN_STDOUT" | head -c 100000)
    stderr_content=$(cat "$RUN_STDERR" | head -c 10000)
    
    # Determine if passed
    local passed="false"
    local timeout_occurred="false"
    local memory_exceeded="false"
    
    if [ $run_exit -eq 124 ] || [ $run_exit -eq 137 ]; then
        timeout_occurred="true"
    elif [ $run_exit -eq 0 ]; then
        if [ -n "$expected_output" ]; then
            # Compare output (trim whitespace)
            local actual_trimmed
            local expected_trimmed
            actual_trimmed=$(echo "$stdout_content" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            expected_trimmed=$(echo "$expected_output" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            if [ "$actual_trimmed" = "$expected_trimmed" ]; then
                passed="true"
            fi
        else
            passed="true"
        fi
    fi
    
    # Check memory limit
    if [ "$memory_kb" -gt "$MEMORY_KB" ]; then
        memory_exceeded="true"
        passed="false"
    fi
    
    # Output JSON result
    cat <<EOF
{
    "testId": "$test_id",
    "passed": $passed,
    "exitCode": $run_exit,
    "timeMs": $run_time_ms,
    "memoryKb": $memory_kb,
    "timeoutOccurred": $timeout_occurred,
    "memoryExceeded": $memory_exceeded,
    "stdout": $(echo "$stdout_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    "stderr": $(echo "$stderr_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    "expectedOutput": $(echo "$expected_output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
}
EOF
}

# === Main Execution ===
main() {
    log "Starting harness for $LANGUAGE ($CODE_FILE)"
    log "Limits: ${TIMEOUT_SEC}s timeout, ${MEMORY_MB}MB memory"
    
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    
    # Setup cgroups if requested
    if [ "$USE_CGROUPS" = "true" ]; then
        setup_cgroups
    fi
    
    # Check code file exists
    if [ ! -f "${WORKSPACE_DIR}/${CODE_FILE}" ]; then
        error "Code file not found: ${WORKSPACE_DIR}/${CODE_FILE}"
        cat > "$RESULT_FILE" <<EOF
{
    "success": false,
    "error": "Code file not found: ${CODE_FILE}",
    "compilation": null,
    "testResults": []
}
EOF
        exit 1
    fi
    
    # Compile if needed
    local compile_result
    compile_result=$(compile_code)
    local compile_exit=$?
    
    if [ $compile_exit -ne 0 ]; then
        cat > "$RESULT_FILE" <<EOF
{
    "success": false,
    "error": "Compilation failed",
    "compilation": $compile_result,
    "testResults": []
}
EOF
        cat "$RESULT_FILE"
        exit 0
    fi
    
    # Run test cases
    local test_results="[]"
    local all_passed="true"
    local total_time=0
    local max_memory=0
    
    if [ -n "$TEST_CASES_FILE" ] && [ -f "$TEST_CASES_FILE" ]; then
        # Run with test cases
        log "Running test cases from: $TEST_CASES_FILE"
        test_results=$(python3 /runner/run_tests.py \
            "$WORKSPACE_DIR" \
            "$CODE_FILE" \
            "$LANGUAGE" \
            "$TIMEOUT_SEC" \
            "$MEMORY_KB" \
            "$TEST_CASES_FILE")
    else
        # Single run without test cases
        log "Running single execution (no test cases)"
        local result
        result=$(run_once "" "" "run-1")
        test_results="[$result]"
        
        # Check if passed
        if echo "$result" | grep -q '"passed": false'; then
            all_passed="false"
        fi
        
        # Extract metrics
        total_time=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('timeMs', 0))")
        max_memory=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('memoryKb', 0))")
    fi
    
    # Build final result
    cat > "$RESULT_FILE" <<EOF
{
    "success": $all_passed,
    "error": null,
    "compilation": $compile_result,
    "testResults": $test_results,
    "summary": {
        "totalTimeMs": $total_time,
        "maxMemoryKb": $max_memory,
        "passed": $(echo "$test_results" | python3 -c "import json,sys; r=json.load(sys.stdin); print(sum(1 for t in r if t.get('passed')))"),
        "total": $(echo "$test_results" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
    }
}
EOF
    
    # Output result to stdout
    cat "$RESULT_FILE"
}

main "$@"

