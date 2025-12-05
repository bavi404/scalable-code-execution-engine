#!/usr/bin/env python3
"""
JSON Helper for Execution Harness

Handles JSON file generation, test case parsing, and result aggregation.
"""

import json
import sys
import os
import subprocess
import tempfile
import time
import resource
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class TestCase:
    """Single test case definition"""
    id: str
    input: str
    expected_output: str
    time_limit_ms: Optional[int] = None
    memory_limit_kb: Optional[int] = None
    hidden: bool = False
    weight: float = 1.0


@dataclass
class TestResult:
    """Result of a single test case execution"""
    test_id: str
    passed: bool
    input: str
    expected_output: str
    actual_output: str
    execution_time_ms: int
    memory_used_kb: int
    status: str  # 'passed', 'failed', 'timeout', 'runtime_error', 'memory_limit'
    error: Optional[str] = None
    stderr: Optional[str] = None


@dataclass
class ExecutionSummary:
    """Summary of all test executions"""
    success: bool
    total_tests: int
    passed_tests: int
    failed_tests: int
    total_time_ms: int
    max_memory_kb: int
    score: float
    test_results: List[Dict]
    compile_result: Optional[Dict] = None


def write_json_file(filepath: str, **kwargs) -> None:
    """Write a JSON file with the given key-value pairs"""
    # Convert string 'true'/'false' to booleans
    data = {}
    for key, value in kwargs.items():
        if value == 'true':
            data[key] = True
        elif value == 'false':
            data[key] = False
        elif isinstance(value, str) and value.isdigit():
            data[key] = int(value)
        else:
            data[key] = value
    
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)


def load_test_cases(test_file: str) -> List[TestCase]:
    """Load test cases from JSON file"""
    with open(test_file, 'r') as f:
        data = json.load(f)
    
    tests = []
    if isinstance(data, list):
        # Array of test cases
        for i, tc in enumerate(data):
            tests.append(TestCase(
                id=tc.get('id', f'test-{i+1}'),
                input=tc.get('input', ''),
                expected_output=tc.get('expected_output', tc.get('expectedOutput', '')),
                time_limit_ms=tc.get('time_limit_ms', tc.get('timeLimitMs')),
                memory_limit_kb=tc.get('memory_limit_kb', tc.get('memoryLimitKb')),
                hidden=tc.get('hidden', False),
                weight=tc.get('weight', 1.0),
            ))
    elif isinstance(data, dict) and 'test_cases' in data:
        # Object with test_cases array
        return load_test_cases_from_list(data['test_cases'])
    
    return tests


def load_test_cases_from_list(test_list: List[Dict]) -> List[TestCase]:
    """Load test cases from a list of dictionaries"""
    tests = []
    for i, tc in enumerate(test_list):
        tests.append(TestCase(
            id=tc.get('id', f'test-{i+1}'),
            input=tc.get('input', ''),
            expected_output=tc.get('expected_output', tc.get('expectedOutput', '')),
            time_limit_ms=tc.get('time_limit_ms'),
            memory_limit_kb=tc.get('memory_limit_kb'),
            hidden=tc.get('hidden', False),
            weight=tc.get('weight', 1.0),
        ))
    return tests


def run_single_test(
    exec_cmd: str,
    test_case: TestCase,
    timeout_sec: int,
    memory_limit_kb: int,
    workspace: str = '/workspace'
) -> TestResult:
    """Run a single test case and return the result"""
    
    # Use test-specific limits if provided
    actual_timeout = test_case.time_limit_ms / 1000 if test_case.time_limit_ms else timeout_sec
    actual_memory = test_case.memory_limit_kb or memory_limit_kb
    
    # Create temporary file for input
    input_file = None
    if test_case.input:
        input_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt')
        input_file.write(test_case.input)
        input_file.close()
    
    # Construct command with limits
    time_output_file = tempfile.mktemp(suffix='.time')
    
    # Build command with timeout and resource limits
    cmd_parts = [
        '/usr/bin/time', '-v', '-o', time_output_file,
        'timeout', '--signal=KILL', f'{actual_timeout}s',
        'prlimit', f'--as={actual_memory * 1024}', f'--cpu={int(actual_timeout) + 1}',
    ]
    cmd_parts.extend(exec_cmd.split())
    
    start_time = time.time()
    
    try:
        # Run the command
        process = subprocess.Popen(
            cmd_parts,
            stdin=open(input_file.name, 'r') if input_file else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workspace,
            preexec_fn=os.setsid,
        )
        
        stdout, stderr = process.communicate(timeout=actual_timeout + 5)
        exit_code = process.returncode
        
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate()
        exit_code = 124  # Timeout exit code
        
    except Exception as e:
        return TestResult(
            test_id=test_case.id,
            passed=False,
            input=test_case.input[:1000],  # Truncate for result
            expected_output=test_case.expected_output[:1000],
            actual_output='',
            execution_time_ms=int((time.time() - start_time) * 1000),
            memory_used_kb=0,
            status='runtime_error',
            error=str(e),
        )
    
    finally:
        # Cleanup input file
        if input_file:
            try:
                os.unlink(input_file.name)
            except:
                pass
    
    execution_time_ms = int((time.time() - start_time) * 1000)
    
    # Parse time output for memory usage
    memory_used_kb = 0
    try:
        with open(time_output_file, 'r') as f:
            time_output = f.read()
            for line in time_output.split('\n'):
                if 'Maximum resident set size' in line:
                    memory_used_kb = int(line.split()[-1])
                    break
    except:
        pass
    finally:
        try:
            os.unlink(time_output_file)
        except:
            pass
    
    # Decode output
    actual_output = stdout.decode('utf-8', errors='replace').strip()
    stderr_output = stderr.decode('utf-8', errors='replace').strip()
    
    # Determine status
    status = 'passed'
    error = None
    
    if exit_code == 124 or exit_code == 137:
        status = 'timeout'
        error = f'Execution timeout ({actual_timeout}s exceeded)'
    elif exit_code == 139:
        status = 'memory_limit'
        error = f'Memory limit exceeded ({actual_memory}KB)'
    elif exit_code != 0:
        status = 'runtime_error'
        error = f'Runtime error (exit code: {exit_code})'
        if stderr_output:
            error += f': {stderr_output[:500]}'
    
    # Compare output
    expected = test_case.expected_output.strip()
    actual = actual_output.strip()
    passed = (status == 'passed' or status == 'runtime_error') and actual == expected
    
    if status == 'passed' and not passed:
        status = 'wrong_answer'
    elif passed:
        status = 'passed'
    
    return TestResult(
        test_id=test_case.id,
        passed=passed,
        input=test_case.input[:1000] if not test_case.hidden else '[hidden]',
        expected_output=test_case.expected_output[:1000] if not test_case.hidden else '[hidden]',
        actual_output=actual_output[:1000] if not test_case.hidden else '[hidden]',
        execution_time_ms=execution_time_ms,
        memory_used_kb=memory_used_kb,
        status=status,
        error=error,
        stderr=stderr_output[:1000] if stderr_output else None,
    )


def run_all_tests(
    exec_cmd: str,
    test_cases: List[TestCase],
    output_dir: str,
    timeout_sec: int,
    memory_limit_kb: int,
) -> ExecutionSummary:
    """Run all test cases and generate summary"""
    
    results: List[TestResult] = []
    total_time = 0
    max_memory = 0
    
    for i, test_case in enumerate(test_cases):
        print(f'[harness] Running test {i+1}/{len(test_cases)}: {test_case.id}', file=sys.stderr)
        
        result = run_single_test(exec_cmd, test_case, timeout_sec, memory_limit_kb)
        results.append(result)
        
        total_time += result.execution_time_ms
        max_memory = max(max_memory, result.memory_used_kb)
        
        # Stop on first non-timeout failure if test case specifies
        # (You could add a 'stop_on_failure' field to TestCase)
    
    passed_count = sum(1 for r in results if r.passed)
    failed_count = len(results) - passed_count
    
    # Calculate score based on weights
    total_weight = sum(tc.weight for tc in test_cases)
    earned_weight = sum(
        tc.weight for tc, r in zip(test_cases, results) if r.passed
    )
    score = (earned_weight / total_weight * 100) if total_weight > 0 else 0
    
    summary = ExecutionSummary(
        success=failed_count == 0,
        total_tests=len(test_cases),
        passed_tests=passed_count,
        failed_tests=failed_count,
        total_time_ms=total_time,
        max_memory_kb=max_memory,
        score=round(score, 2),
        test_results=[asdict(r) for r in results],
    )
    
    return summary


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print('Usage: json_helper.py <command> [args...]', file=sys.stderr)
        print('Commands:', file=sys.stderr)
        print('  write <filepath> key1=value1 key2=value2 ...', file=sys.stderr)
        print('  run_tests <exec_cmd> <test_file> <output_dir> <timeout> <memory>', file=sys.stderr)
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'write':
        # Write JSON file
        filepath = sys.argv[2]
        kwargs = {}
        for arg in sys.argv[3:]:
            if '=' in arg:
                key, value = arg.split('=', 1)
                kwargs[key] = value
        write_json_file(filepath, **kwargs)
        
    elif command == 'run_tests':
        # Run test cases
        exec_cmd = sys.argv[2]
        test_file = sys.argv[3]
        output_dir = sys.argv[4]
        timeout_sec = int(sys.argv[5])
        memory_limit_kb = int(sys.argv[6])
        
        # Load test cases
        test_cases = load_test_cases(test_file)
        print(f'[harness] Loaded {len(test_cases)} test cases', file=sys.stderr)
        
        # Run tests
        summary = run_all_tests(exec_cmd, test_cases, output_dir, timeout_sec, memory_limit_kb)
        
        # Write results
        result_file = os.path.join(output_dir, 'result.json')
        with open(result_file, 'w') as f:
            json.dump(asdict(summary), f, indent=2)
        
        # Output summary to stdout for container to capture
        print(json.dumps(asdict(summary)))
        
    else:
        print(f'Unknown command: {command}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

