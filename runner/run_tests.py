#!/usr/bin/env python3
"""
Test Case Runner

Runs multiple test cases against compiled/interpreted code,
measures performance, and outputs JSON results.

Usage: python3 run_tests.py <workspace> <code_file> <language> <timeout_sec> <memory_kb> <test_cases_file>
"""

import json
import os
import subprocess
import sys
import time
import tempfile
import resource
from pathlib import Path
from typing import List, Dict, Any, Optional

# Language to command mapping
LANGUAGE_COMMANDS = {
    'javascript': lambda f: ['node', f],
    'typescript': lambda f: ['npx', 'ts-node', f],
    'python': lambda f: ['python3', f],
    'c': lambda f: ['./solution'],
    'cpp': lambda f: ['./solution'],
    'java': lambda f: ['java', f.replace('.java', '')],
    'go': lambda f: ['./solution'],
    'rust': lambda f: ['./solution'],
    'ruby': lambda f: ['ruby', f],
    'php': lambda f: ['php', f],
}


def get_run_command(language: str, code_file: str) -> List[str]:
    """Get the command to run code for a given language."""
    if language in LANGUAGE_COMMANDS:
        return LANGUAGE_COMMANDS[language](code_file)
    raise ValueError(f"Unsupported language: {language}")


def run_single_test(
    workspace: str,
    command: List[str],
    input_data: str,
    expected_output: str,
    test_id: str,
    timeout_sec: int,
    memory_kb: int,
) -> Dict[str, Any]:
    """Run a single test case and return results."""
    
    result = {
        'testId': test_id,
        'passed': False,
        'exitCode': -1,
        'timeMs': 0,
        'memoryKb': 0,
        'timeoutOccurred': False,
        'memoryExceeded': False,
        'stdout': '',
        'stderr': '',
        'expectedOutput': expected_output,
    }
    
    start_time = time.perf_counter()
    
    try:
        # Build command with timeout and resource limits
        # Use unshare -n for network isolation if available
        full_command = command
        
        # Create process with resource limits
        process = subprocess.Popen(
            full_command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workspace,
            # Pre-exec function to set resource limits
            preexec_fn=lambda: set_resource_limits(timeout_sec, memory_kb),
        )
        
        # Communicate with timeout
        try:
            stdout, stderr = process.communicate(
                input=input_data.encode('utf-8') if input_data else None,
                timeout=timeout_sec + 1  # Extra second for overhead
            )
            result['exitCode'] = process.returncode
            result['stdout'] = stdout.decode('utf-8', errors='replace')[:100000]
            result['stderr'] = stderr.decode('utf-8', errors='replace')[:10000]
            
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            result['timeoutOccurred'] = True
            result['exitCode'] = 124
            stdout, stderr = process.communicate()
            result['stdout'] = stdout.decode('utf-8', errors='replace')[:100000]
            result['stderr'] = stderr.decode('utf-8', errors='replace')[:10000]
    
    except MemoryError:
        result['memoryExceeded'] = True
        result['exitCode'] = 137
    
    except Exception as e:
        result['stderr'] = str(e)
        result['exitCode'] = 1
    
    end_time = time.perf_counter()
    result['timeMs'] = int((end_time - start_time) * 1000)
    
    # Try to get memory usage from /proc (Linux only)
    try:
        with open(f'/proc/{os.getpid()}/status', 'r') as f:
            for line in f:
                if line.startswith('VmHWM:'):
                    result['memoryKb'] = int(line.split()[1])
                    break
    except:
        pass
    
    # Check if passed
    if not result['timeoutOccurred'] and not result['memoryExceeded']:
        if result['exitCode'] == 0:
            actual = result['stdout'].strip()
            expected = expected_output.strip()
            result['passed'] = (actual == expected)
    
    # Check memory limit
    if result['memoryKb'] > memory_kb:
        result['memoryExceeded'] = True
        result['passed'] = False
    
    return result


def set_resource_limits(timeout_sec: int, memory_kb: int):
    """Set resource limits for child process (Linux only)."""
    try:
        # CPU time limit
        resource.setrlimit(resource.RLIMIT_CPU, (timeout_sec, timeout_sec + 1))
        
        # Memory limit (virtual memory)
        memory_bytes = memory_kb * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        
        # Max processes
        resource.setrlimit(resource.RLIMIT_NPROC, (50, 50))
        
        # Max open files
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        
        # Core dump size (disable)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        
    except (ValueError, resource.error) as e:
        # Resource limits may not be available
        pass


def run_with_time_command(
    workspace: str,
    command: List[str],
    input_data: str,
    expected_output: str,
    test_id: str,
    timeout_sec: int,
    memory_kb: int,
) -> Dict[str, Any]:
    """Run test using /usr/bin/time -v for accurate memory measurement."""
    
    result = {
        'testId': test_id,
        'passed': False,
        'exitCode': -1,
        'timeMs': 0,
        'memoryKb': 0,
        'timeoutOccurred': False,
        'memoryExceeded': False,
        'stdout': '',
        'stderr': '',
        'expectedOutput': expected_output,
    }
    
    # Create temp file for time output
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.time') as tf:
        time_output_file = tf.name
    
    try:
        # Build command with timeout and time
        # unshare -n: no network
        # timeout: time limit
        # /usr/bin/time -v: measure resources
        full_command = [
            'timeout', '--signal=KILL', f'{timeout_sec}s',
            '/usr/bin/time', '-v', '-o', time_output_file,
        ] + command
        
        # Try to use unshare for network isolation
        try:
            subprocess.run(['unshare', '--help'], capture_output=True, check=True)
            full_command = ['unshare', '-n'] + full_command
        except:
            pass
        
        start_time = time.perf_counter()
        
        process = subprocess.Popen(
            full_command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workspace,
        )
        
        stdout, stderr = process.communicate(
            input=input_data.encode('utf-8') if input_data else None,
            timeout=timeout_sec + 5
        )
        
        end_time = time.perf_counter()
        
        result['exitCode'] = process.returncode
        result['stdout'] = stdout.decode('utf-8', errors='replace')[:100000]
        result['stderr'] = stderr.decode('utf-8', errors='replace')[:10000]
        result['timeMs'] = int((end_time - start_time) * 1000)
        
        # Check for timeout (exit code 124 or 137)
        if process.returncode in (124, 137):
            result['timeoutOccurred'] = True
        
        # Parse time output for memory
        if os.path.exists(time_output_file):
            with open(time_output_file, 'r') as f:
                for line in f:
                    if 'Maximum resident set size' in line:
                        result['memoryKb'] = int(line.split(':')[1].strip())
                        break
        
    except subprocess.TimeoutExpired:
        process.kill()
        result['timeoutOccurred'] = True
        result['exitCode'] = 124
        
    except Exception as e:
        result['stderr'] = str(e)
        result['exitCode'] = 1
        
    finally:
        # Cleanup time output file
        try:
            os.unlink(time_output_file)
        except:
            pass
    
    # Check if passed
    if not result['timeoutOccurred'] and result['exitCode'] == 0:
        actual = result['stdout'].strip()
        expected = expected_output.strip()
        result['passed'] = (actual == expected)
    
    # Check memory limit
    if result['memoryKb'] > memory_kb:
        result['memoryExceeded'] = True
        result['passed'] = False
    
    return result


def load_test_cases(test_cases_file: str) -> List[Dict[str, Any]]:
    """Load test cases from JSON file."""
    with open(test_cases_file, 'r') as f:
        data = json.load(f)
    
    # Support both array and object with 'testCases' key
    if isinstance(data, list):
        return data
    elif isinstance(data, dict) and 'testCases' in data:
        return data['testCases']
    else:
        raise ValueError("Invalid test cases format")


def main():
    if len(sys.argv) < 7:
        print("Usage: run_tests.py <workspace> <code_file> <language> <timeout_sec> <memory_kb> <test_cases_file>", file=sys.stderr)
        sys.exit(1)
    
    workspace = sys.argv[1]
    code_file = sys.argv[2]
    language = sys.argv[3]
    timeout_sec = int(sys.argv[4])
    memory_kb = int(sys.argv[5])
    test_cases_file = sys.argv[6]
    
    # Load test cases
    test_cases = load_test_cases(test_cases_file)
    
    # Get run command
    command = get_run_command(language, code_file)
    
    # Run each test case
    results = []
    for i, test_case in enumerate(test_cases):
        test_id = test_case.get('id', f'test-{i+1}')
        input_data = test_case.get('input', '')
        expected_output = test_case.get('expectedOutput', test_case.get('expected', ''))
        
        # Use /usr/bin/time if available, otherwise fall back to Python-based
        if os.path.exists('/usr/bin/time'):
            result = run_with_time_command(
                workspace, command, input_data, expected_output,
                test_id, timeout_sec, memory_kb
            )
        else:
            result = run_single_test(
                workspace, command, input_data, expected_output,
                test_id, timeout_sec, memory_kb
            )
        
        results.append(result)
        
        # Optional: stop on first failure
        if test_case.get('stopOnFailure') and not result['passed']:
            break
    
    # Output JSON results
    print(json.dumps(results))


if __name__ == '__main__':
    main()

