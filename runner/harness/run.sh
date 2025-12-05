#!/bin/bash
#
# Code Execution Harness
# 
# Compiles (if necessary), executes code with resource limits,
# captures output, and writes JSON results.
#
# Usage: ./run.sh <language> <code_file> <output_dir> [test_cases_file]
#
# Environment:
#   TIMEOUT_SEC     - CPU time limit in seconds (default: 5)
#   MEMORY_LIMIT_KB - Memory limit in KB (default: 262144 = 256MB)
#   USE_CGROUPS     - Use cgroups for limits (default: 0)
#   CGROUP_NAME     - Cgroup name (default: code-exec)
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

LANGUAGE="${1:-javascript}"
CODE_FILE="${2:-solution.js}"
OUTPUT_DIR="${3:-/tmp/output}"
TEST_CASES_FILE="${4:-}"

TIMEOUT_SEC="${TIMEOUT_SEC:-5}"
MEMORY_LIMIT_KB="${MEMORY_LIMIT_KB:-262144}"
USE_CGROUPS="${USE_CGROUPS:-0}"
CGROUP_NAME="${CGROUP_NAME:-code-exec}"

WORKSPACE="/workspace"
HARNESS_DIR="$(dirname "$0")"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Result files
COMPILE_RESULT="$OUTPUT_DIR/compile.json"
EXECUTION_RESULT="$OUTPUT_DIR/result.json"
TEST_RESULTS="$OUTPUT_DIR/tests.json"

# Temporary files
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
TIME_FILE=$(mktemp)

# Cleanup on exit
cleanup() {
    rm -f "$STDOUT_FILE" "$STDERR_FILE" "$TIME_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# ============================================================================
# Helper Functions
# ============================================================================

log() {
    echo "[harness] $(date +%Y-%m-%dT%H:%M:%S) $*" >&2
}

write_json() {
    python3 "$HARNESS_DIR/json_helper.py" write "$@"
}

# Get compilation command based on language
get_compile_cmd() {
    local lang="$1"
    local file="$2"
    local outfile="${file%.*}"
    
    case "$lang" in
        c)
            echo "gcc -O2 -std=c17 -o '$outfile' '$file' -lm"
            ;;
        cpp|c++)
            echo "g++ -O2 -std=c++17 -o '$outfile' '$file'"
            ;;
        java)
            echo "javac '$file'"
            ;;
        rust)
            echo "rustc -O -o '${file%.*}' '$file'"
            ;;
        go)
            echo "go build -o '${file%.*}' '$file'"
            ;;
        typescript)
            echo "npx tsc --outDir /tmp '$file'"
            ;;
        *)
            echo ""  # No compilation needed
            ;;
    esac
}

# Get execution command based on language
get_exec_cmd() {
    local lang="$1"
    local file="$2"
    local outfile="${file%.*}"
    
    case "$lang" in
        c|cpp|c++|rust)
            echo "./$outfile"
            ;;
        go)
            echo "./$outfile"
            ;;
        java)
            local classname=$(basename "${file%.*}")
            echo "java -Xmx${MEMORY_LIMIT_KB}k $classname"
            ;;
        javascript|js)
            echo "node '$file'"
            ;;
        typescript|ts)
            local jsfile="/tmp/$(basename "${file%.*}").js"
            echo "node '$jsfile'"
            ;;
        python|python3|py)
            echo "python3 '$file'"
            ;;
        ruby|rb)
            echo "ruby '$file'"
            ;;
        php)
            echo "php '$file'"
            ;;
        *)
            echo "cat '$file'"  # Unknown language, just cat
            ;;
    esac
}

# ============================================================================
# Resource Limiting Functions
# ============================================================================

# Setup cgroup for resource limiting (cgroups v2)
setup_cgroup() {
    local cgroup_path="/sys/fs/cgroup/$CGROUP_NAME"
    
    if [[ "$USE_CGROUPS" != "1" ]]; then
        return 0
    fi
    
    log "Setting up cgroup: $cgroup_path"
    
    # Create cgroup if it doesn't exist
    if [[ ! -d "$cgroup_path" ]]; then
        sudo mkdir -p "$cgroup_path"
    fi
    
    # Set memory limit
    echo "$((MEMORY_LIMIT_KB * 1024))" | sudo tee "$cgroup_path/memory.max" > /dev/null
    
    # Set CPU limit (optional - 50% of one core)
    echo "50000 100000" | sudo tee "$cgroup_path/cpu.max" > /dev/null 2>/dev/null || true
    
    # Enable controllers
    echo "+memory +cpu +pids" | sudo tee "$cgroup_path/cgroup.subtree_control" > /dev/null 2>/dev/null || true
    
    # Limit number of processes
    echo "50" | sudo tee "$cgroup_path/pids.max" > /dev/null 2>/dev/null || true
    
    log "Cgroup setup complete"
}

# Run command with cgroup
run_with_cgroup() {
    local cmd="$1"
    local cgroup_path="/sys/fs/cgroup/$CGROUP_NAME"
    
    # Add current process to cgroup
    echo $$ | sudo tee "$cgroup_path/cgroup.procs" > /dev/null
    
    # Run command
    eval "$cmd"
}

# Run command with timeout and prlimit
run_with_limits() {
    local cmd="$1"
    local input_file="${2:-}"
    
    local limit_cmd=""
    
    if [[ "$USE_CGROUPS" == "1" ]]; then
        # Use cgroups (already set up)
        limit_cmd="cgexec -g memory,cpu,pids:$CGROUP_NAME"
    else
        # Use prlimit for resource limits
        limit_cmd="prlimit --as=$((MEMORY_LIMIT_KB * 1024)) --cpu=$TIMEOUT_SEC --nproc=50"
    fi
    
    # Construct the full command with /usr/bin/time for measurement
    local full_cmd="/usr/bin/time -v -o '$TIME_FILE' timeout --signal=KILL ${TIMEOUT_SEC}s $limit_cmd $cmd"
    
    log "Executing: $full_cmd"
    
    local exit_code=0
    if [[ -n "$input_file" && -f "$input_file" ]]; then
        eval "$full_cmd" < "$input_file" > "$STDOUT_FILE" 2> "$STDERR_FILE" || exit_code=$?
    else
        eval "$full_cmd" > "$STDOUT_FILE" 2> "$STDERR_FILE" || exit_code=$?
    fi
    
    return $exit_code
}

# Parse /usr/bin/time output
parse_time_output() {
    local time_file="$1"
    
    if [[ ! -f "$time_file" ]]; then
        echo '{"wall_time_ms": 0, "user_time_ms": 0, "sys_time_ms": 0, "memory_kb": 0}'
        return
    fi
    
    local wall_time=$(grep "Elapsed (wall clock)" "$time_file" | sed 's/.*: //' || echo "0:00.00")
    local user_time=$(grep "User time" "$time_file" | awk '{print $NF}' || echo "0")
    local sys_time=$(grep "System time" "$time_file" | awk '{print $NF}' || echo "0")
    local max_rss=$(grep "Maximum resident set size" "$time_file" | awk '{print $NF}' || echo "0")
    
    # Convert wall time (M:SS.ss or SS.ss) to milliseconds
    local wall_ms=0
    if [[ "$wall_time" == *:* ]]; then
        local mins=$(echo "$wall_time" | cut -d: -f1)
        local secs=$(echo "$wall_time" | cut -d: -f2)
        wall_ms=$(echo "($mins * 60 + $secs) * 1000" | bc | cut -d. -f1)
    else
        wall_ms=$(echo "$wall_time * 1000" | bc | cut -d. -f1)
    fi
    
    # Convert user/sys time to milliseconds
    local user_ms=$(echo "$user_time * 1000" | bc | cut -d. -f1)
    local sys_ms=$(echo "$sys_time * 1000" | bc | cut -d. -f1)
    
    cat <<EOF
{
  "wall_time_ms": ${wall_ms:-0},
  "user_time_ms": ${user_ms:-0},
  "sys_time_ms": ${sys_ms:-0},
  "memory_kb": ${max_rss:-0}
}
EOF
}

# ============================================================================
# Compilation
# ============================================================================

compile_code() {
    local lang="$1"
    local file="$2"
    
    local compile_cmd=$(get_compile_cmd "$lang" "$file")
    
    if [[ -z "$compile_cmd" ]]; then
        log "No compilation needed for $lang"
        write_json "$COMPILE_RESULT" \
            success=true \
            skipped=true \
            language="$lang" \
            message="No compilation required"
        return 0
    fi
    
    log "Compiling: $compile_cmd"
    
    local compile_stdout=$(mktemp)
    local compile_stderr=$(mktemp)
    local start_time=$(date +%s%3N)
    
    local exit_code=0
    cd "$WORKSPACE"
    eval "$compile_cmd" > "$compile_stdout" 2> "$compile_stderr" || exit_code=$?
    
    local end_time=$(date +%s%3N)
    local compile_time=$((end_time - start_time))
    
    local stdout_content=$(cat "$compile_stdout" | head -c 65536)
    local stderr_content=$(cat "$compile_stderr" | head -c 65536)
    
    rm -f "$compile_stdout" "$compile_stderr"
    
    if [[ $exit_code -eq 0 ]]; then
        log "Compilation successful (${compile_time}ms)"
        write_json "$COMPILE_RESULT" \
            success=true \
            skipped=false \
            language="$lang" \
            compile_time_ms="$compile_time" \
            stdout="$stdout_content" \
            stderr="$stderr_content"
        return 0
    else
        log "Compilation failed with exit code $exit_code"
        write_json "$COMPILE_RESULT" \
            success=false \
            skipped=false \
            language="$lang" \
            exit_code="$exit_code" \
            compile_time_ms="$compile_time" \
            stdout="$stdout_content" \
            stderr="$stderr_content" \
            error="Compilation failed"
        return 1
    fi
}

# ============================================================================
# Execution
# ============================================================================

run_single_execution() {
    local exec_cmd="$1"
    local input_file="${2:-}"
    
    # Clear previous output
    > "$STDOUT_FILE"
    > "$STDERR_FILE"
    > "$TIME_FILE"
    
    local start_time=$(date +%s%3N)
    local exit_code=0
    
    cd "$WORKSPACE"
    run_with_limits "$exec_cmd" "$input_file" || exit_code=$?
    
    local end_time=$(date +%s%3N)
    local wall_time=$((end_time - start_time))
    
    # Get stdout/stderr (limit size)
    local stdout_content=$(cat "$STDOUT_FILE" 2>/dev/null | head -c 1048576)
    local stderr_content=$(cat "$STDERR_FILE" 2>/dev/null | head -c 65536)
    
    # Parse timing info
    local timing=$(parse_time_output "$TIME_FILE")
    
    # Determine status
    local status="success"
    local error_msg=""
    
    if [[ $exit_code -eq 124 || $exit_code -eq 137 ]]; then
        status="timeout"
        error_msg="Execution timeout (${TIMEOUT_SEC}s exceeded)"
    elif [[ $exit_code -eq 139 ]]; then
        status="memory_limit"
        error_msg="Memory limit exceeded"
    elif [[ $exit_code -ne 0 ]]; then
        status="runtime_error"
        error_msg="Runtime error (exit code: $exit_code)"
    fi
    
    # Output result as JSON
    cat <<EOF
{
  "status": "$status",
  "exit_code": $exit_code,
  "stdout": $(echo "$stdout_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "stderr": $(echo "$stderr_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "wall_time_ms": $wall_time,
  "timing": $timing,
  "error": $(echo "$error_msg" | python3 -c 'import json,sys; s=sys.stdin.read().strip(); print(json.dumps(s) if s else "null")')
}
EOF
    
    return $exit_code
}

# Run test cases
run_test_cases() {
    local exec_cmd="$1"
    local test_file="$2"
    
    log "Running test cases from: $test_file"
    
    # Parse test cases and run each one
    python3 "$HARNESS_DIR/json_helper.py" run_tests "$exec_cmd" "$test_file" "$OUTPUT_DIR" "$TIMEOUT_SEC" "$MEMORY_LIMIT_KB"
}

# ============================================================================
# Main Execution Flow
# ============================================================================

main() {
    log "Starting execution harness"
    log "Language: $LANGUAGE"
    log "Code file: $CODE_FILE"
    log "Timeout: ${TIMEOUT_SEC}s"
    log "Memory limit: ${MEMORY_LIMIT_KB}KB"
    
    # Verify code file exists
    if [[ ! -f "$WORKSPACE/$CODE_FILE" ]]; then
        log "ERROR: Code file not found: $WORKSPACE/$CODE_FILE"
        write_json "$EXECUTION_RESULT" \
            success=false \
            error="Code file not found: $CODE_FILE"
        exit 1
    fi
    
    # Setup cgroups if enabled
    if [[ "$USE_CGROUPS" == "1" ]]; then
        setup_cgroup
    fi
    
    # Step 1: Compile (if necessary)
    if ! compile_code "$LANGUAGE" "$CODE_FILE"; then
        log "Compilation failed, aborting execution"
        write_json "$EXECUTION_RESULT" \
            success=false \
            error="Compilation failed" \
            compile_result="$(cat "$COMPILE_RESULT")"
        exit 1
    fi
    
    # Step 2: Get execution command
    local exec_cmd=$(get_exec_cmd "$LANGUAGE" "$CODE_FILE")
    log "Execution command: $exec_cmd"
    
    # Step 3: Run tests or single execution
    if [[ -n "$TEST_CASES_FILE" && -f "$TEST_CASES_FILE" ]]; then
        # Run with test cases
        run_test_cases "$exec_cmd" "$TEST_CASES_FILE"
    else
        # Single execution (no input)
        log "Running single execution (no test cases)"
        local result=$(run_single_execution "$exec_cmd")
        echo "$result" > "$EXECUTION_RESULT"
        
        # Also output to stdout for container to capture
        echo "$result"
    fi
    
    log "Execution harness complete"
}

# Run main
main "$@"

