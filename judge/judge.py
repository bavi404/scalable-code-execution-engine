#!/usr/bin/env python3
"""
Code Execution Judge Module

Reads harness output JSON, applies comparison rules,
assigns verdicts, and produces final score.

Verdicts:
  AC  - Accepted (correct answer)
  WA  - Wrong Answer
  TLE - Time Limit Exceeded
  MLE - Memory Limit Exceeded
  RE  - Runtime Error
  CE  - Compilation Error
  IE  - Internal Error (judge failure)

Usage:
  python judge.py <harness_output.json> [options]

Options:
  --expected <file>       JSON file with expected outputs
  --special-judge <path>  Path to special judge executable
  --problem-config <file> Problem configuration JSON
  --output <file>         Output verdict to file (default: stdout)
"""

import json
import sys
import os
import subprocess
import tempfile
import argparse
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path


class Verdict(Enum):
    """Judge verdict codes"""
    AC = "AC"    # Accepted
    WA = "WA"    # Wrong Answer
    TLE = "TLE"  # Time Limit Exceeded
    MLE = "MLE"  # Memory Limit Exceeded
    RE = "RE"    # Runtime Error
    CE = "CE"    # Compilation Error
    IE = "IE"    # Internal Error
    PE = "PE"    # Presentation Error (optional)
    SK = "SK"    # Skipped


@dataclass
class TestCaseVerdict:
    """Verdict for a single test case"""
    test_id: str
    verdict: str
    score: float
    max_score: float
    execution_time_ms: int
    memory_used_kb: int
    message: Optional[str] = None
    expected_output: Optional[str] = None
    actual_output: Optional[str] = None
    input_preview: Optional[str] = None


@dataclass
class JudgeResult:
    """Final judge result"""
    final_verdict: str
    total_score: float
    max_score: float
    score_percentage: float
    passed_count: int
    failed_count: int
    total_count: int
    total_time_ms: int
    max_memory_kb: int
    test_verdicts: List[Dict]
    compilation_status: Optional[str] = None
    compilation_message: Optional[str] = None
    judge_message: Optional[str] = None


@dataclass
class ProblemConfig:
    """Problem configuration"""
    time_limit_ms: int = 5000
    memory_limit_kb: int = 262144
    comparison_mode: str = "exact"  # exact, token, float, special
    float_tolerance: float = 1e-6
    special_judge_path: Optional[str] = None
    case_sensitive: bool = True
    ignore_trailing_whitespace: bool = True
    ignore_trailing_newlines: bool = True
    partial_scoring: bool = True
    test_weights: Dict[str, float] = field(default_factory=dict)


class Comparator:
    """Output comparison utilities"""
    
    @staticmethod
    def normalize(text: str, config: ProblemConfig) -> str:
        """Normalize text for comparison"""
        if text is None:
            return ""
        
        result = text
        
        # Handle trailing whitespace per line
        if config.ignore_trailing_whitespace:
            lines = result.split('\n')
            result = '\n'.join(line.rstrip() for line in lines)
        
        # Handle trailing newlines
        if config.ignore_trailing_newlines:
            result = result.rstrip('\n')
        
        # Handle case sensitivity
        if not config.case_sensitive:
            result = result.lower()
        
        return result
    
    @staticmethod
    def exact_match(expected: str, actual: str, config: ProblemConfig) -> Tuple[bool, str]:
        """Exact string comparison with normalization"""
        norm_expected = Comparator.normalize(expected, config)
        norm_actual = Comparator.normalize(actual, config)
        
        if norm_expected == norm_actual:
            return True, "Output matches expected"
        
        # Provide helpful diff info
        exp_lines = norm_expected.split('\n')
        act_lines = norm_actual.split('\n')
        
        if len(exp_lines) != len(act_lines):
            return False, f"Line count mismatch: expected {len(exp_lines)}, got {len(act_lines)}"
        
        for i, (exp_line, act_line) in enumerate(zip(exp_lines, act_lines)):
            if exp_line != act_line:
                return False, f"Difference at line {i+1}"
        
        return False, "Output differs from expected"
    
    @staticmethod
    def token_match(expected: str, actual: str, config: ProblemConfig) -> Tuple[bool, str]:
        """Token-by-token comparison (whitespace insensitive)"""
        exp_tokens = expected.split()
        act_tokens = actual.split()
        
        if not config.case_sensitive:
            exp_tokens = [t.lower() for t in exp_tokens]
            act_tokens = [t.lower() for t in act_tokens]
        
        if exp_tokens == act_tokens:
            return True, "All tokens match"
        
        if len(exp_tokens) != len(act_tokens):
            return False, f"Token count mismatch: expected {len(exp_tokens)}, got {len(act_tokens)}"
        
        for i, (exp_tok, act_tok) in enumerate(zip(exp_tokens, act_tokens)):
            if exp_tok != act_tok:
                return False, f"Token mismatch at position {i+1}: expected '{exp_tok}', got '{act_tok}'"
        
        return False, "Tokens differ"
    
    @staticmethod
    def float_match(expected: str, actual: str, config: ProblemConfig) -> Tuple[bool, str]:
        """Floating-point comparison with tolerance"""
        try:
            exp_values = [float(x) for x in expected.split()]
            act_values = [float(x) for x in actual.split()]
        except ValueError as e:
            return False, f"Cannot parse as float: {e}"
        
        if len(exp_values) != len(act_values):
            return False, f"Value count mismatch: expected {len(exp_values)}, got {len(act_values)}"
        
        tolerance = config.float_tolerance
        
        for i, (exp_val, act_val) in enumerate(zip(exp_values, act_values)):
            # Relative and absolute tolerance
            if abs(exp_val - act_val) > tolerance and abs(exp_val - act_val) > tolerance * abs(exp_val):
                return False, f"Value mismatch at position {i+1}: expected {exp_val}, got {act_val} (tolerance: {tolerance})"
        
        return True, "All values within tolerance"


class SpecialJudge:
    """Special judge executor for complex comparisons"""
    
    def __init__(self, judge_path: str):
        self.judge_path = judge_path
        
        if not os.path.exists(judge_path):
            raise FileNotFoundError(f"Special judge not found: {judge_path}")
        
        if not os.access(judge_path, os.X_OK):
            raise PermissionError(f"Special judge not executable: {judge_path}")
    
    def run(
        self,
        input_data: str,
        expected_output: str,
        actual_output: str,
        test_id: str = "",
        timeout_sec: int = 30
    ) -> Tuple[bool, float, str]:
        """
        Run special judge
        
        Special Judge Contract:
        - Receives via stdin: JSON with input, expected, actual, test_id
        - OR receives via files (paths passed as arguments)
        - Returns via stdout: JSON with verdict, score, message
        - Exit code: 0 = success, non-zero = judge error
        
        Returns: (passed: bool, score: float, message: str)
        """
        
        # Create temp files for input/expected/actual
        with tempfile.NamedTemporaryFile(mode='w', suffix='.in', delete=False) as f_in, \
             tempfile.NamedTemporaryFile(mode='w', suffix='.expected', delete=False) as f_exp, \
             tempfile.NamedTemporaryFile(mode='w', suffix='.actual', delete=False) as f_act:
            
            f_in.write(input_data)
            f_exp.write(expected_output)
            f_act.write(actual_output)
            
            input_path = f_in.name
            expected_path = f_exp.name
            actual_path = f_act.name
        
        try:
            # Run special judge with file paths as arguments
            result = subprocess.run(
                [self.judge_path, input_path, expected_path, actual_path, test_id],
                capture_output=True,
                timeout=timeout_sec,
                text=True
            )
            
            if result.returncode != 0:
                return False, 0.0, f"Special judge error: {result.stderr}"
            
            # Parse output
            try:
                output = json.loads(result.stdout.strip())
                passed = output.get('verdict', 'WA') == 'AC' or output.get('passed', False)
                score = float(output.get('score', 1.0 if passed else 0.0))
                message = output.get('message', '')
                return passed, score, message
            except json.JSONDecodeError:
                # Fallback: check exit code and simple output
                stdout = result.stdout.strip()
                if stdout in ('1', 'AC', 'ACCEPTED', 'true'):
                    return True, 1.0, "Accepted by special judge"
                elif stdout in ('0', 'WA', 'WRONG', 'false'):
                    return False, 0.0, "Rejected by special judge"
                else:
                    # Try to parse as score
                    try:
                        score = float(stdout)
                        return score > 0, score, f"Score: {score}"
                    except:
                        return False, 0.0, f"Unknown special judge output: {stdout}"
        
        except subprocess.TimeoutExpired:
            return False, 0.0, "Special judge timeout"
        except Exception as e:
            return False, 0.0, f"Special judge error: {e}"
        
        finally:
            # Cleanup temp files
            for path in [input_path, expected_path, actual_path]:
                try:
                    os.unlink(path)
                except:
                    pass


class Judge:
    """Main judge class"""
    
    def __init__(self, config: Optional[ProblemConfig] = None):
        self.config = config or ProblemConfig()
        self.special_judge: Optional[SpecialJudge] = None
        
        if self.config.special_judge_path:
            self.special_judge = SpecialJudge(self.config.special_judge_path)
    
    def judge_test_case(
        self,
        test_result: Dict,
        expected_output: Optional[str] = None
    ) -> TestCaseVerdict:
        """Judge a single test case"""
        
        test_id = test_result.get('test_id', test_result.get('testId', 'unknown'))
        status = test_result.get('status', '')
        actual_output = test_result.get('actual_output', test_result.get('actualOutput', ''))
        exec_time = test_result.get('execution_time_ms', test_result.get('executionTimeMs', 0))
        memory_kb = test_result.get('memory_used_kb', test_result.get('memoryUsedKb', 0))
        input_data = test_result.get('input', '')
        
        # Use provided expected or from test result
        if expected_output is None:
            expected_output = test_result.get('expected_output', test_result.get('expectedOutput', ''))
        
        # Get test weight
        weight = self.config.test_weights.get(test_id, 1.0)
        
        # Check for execution errors first
        if status == 'timeout' or test_result.get('timedOut', False):
            return TestCaseVerdict(
                test_id=test_id,
                verdict=Verdict.TLE.value,
                score=0.0,
                max_score=weight,
                execution_time_ms=exec_time,
                memory_used_kb=memory_kb,
                message=f"Time limit exceeded ({exec_time}ms)",
                input_preview=input_data[:100] if input_data else None
            )
        
        if status == 'memory_limit':
            return TestCaseVerdict(
                test_id=test_id,
                verdict=Verdict.MLE.value,
                score=0.0,
                max_score=weight,
                execution_time_ms=exec_time,
                memory_used_kb=memory_kb,
                message=f"Memory limit exceeded ({memory_kb}KB)",
                input_preview=input_data[:100] if input_data else None
            )
        
        if status == 'runtime_error':
            error_msg = test_result.get('error', 'Unknown runtime error')
            return TestCaseVerdict(
                test_id=test_id,
                verdict=Verdict.RE.value,
                score=0.0,
                max_score=weight,
                execution_time_ms=exec_time,
                memory_used_kb=memory_kb,
                message=error_msg,
                input_preview=input_data[:100] if input_data else None
            )
        
        # Compare outputs
        passed = False
        message = ""
        score = 0.0
        
        if self.special_judge and self.config.comparison_mode == 'special':
            # Use special judge
            passed, score, message = self.special_judge.run(
                input_data,
                expected_output,
                actual_output,
                test_id
            )
            score *= weight  # Apply weight
        else:
            # Use built-in comparator
            if self.config.comparison_mode == 'token':
                passed, message = Comparator.token_match(expected_output, actual_output, self.config)
            elif self.config.comparison_mode == 'float':
                passed, message = Comparator.float_match(expected_output, actual_output, self.config)
            else:  # exact
                passed, message = Comparator.exact_match(expected_output, actual_output, self.config)
            
            score = weight if passed else 0.0
        
        verdict = Verdict.AC if passed else Verdict.WA
        
        return TestCaseVerdict(
            test_id=test_id,
            verdict=verdict.value,
            score=score,
            max_score=weight,
            execution_time_ms=exec_time,
            memory_used_kb=memory_kb,
            message=message,
            expected_output=expected_output[:500] if expected_output else None,
            actual_output=actual_output[:500] if actual_output else None,
            input_preview=input_data[:100] if input_data else None
        )
    
    def judge_submission(
        self,
        harness_output: Dict,
        expected_outputs: Optional[Dict[str, str]] = None
    ) -> JudgeResult:
        """Judge a complete submission"""
        
        # Check compilation status
        compile_result = harness_output.get('compile_result', harness_output.get('compileResult'))
        if compile_result:
            if not compile_result.get('success', True) and not compile_result.get('skipped', False):
                return JudgeResult(
                    final_verdict=Verdict.CE.value,
                    total_score=0.0,
                    max_score=0.0,
                    score_percentage=0.0,
                    passed_count=0,
                    failed_count=0,
                    total_count=0,
                    total_time_ms=0,
                    max_memory_kb=0,
                    test_verdicts=[],
                    compilation_status="failed",
                    compilation_message=compile_result.get('stderr', compile_result.get('error', 'Compilation failed'))
                )
        
        # Get test results
        test_results = harness_output.get('test_results', harness_output.get('testResults', []))
        
        # If no test results, check for single execution result
        if not test_results and 'stdout' in harness_output:
            test_results = [{
                'test_id': 'test-1',
                'status': harness_output.get('status', 'success'),
                'actual_output': harness_output.get('stdout', harness_output.get('output', '')),
                'expected_output': expected_outputs.get('test-1', '') if expected_outputs else '',
                'execution_time_ms': harness_output.get('execution_time_ms', harness_output.get('executionTimeMs', 0)),
                'memory_used_kb': harness_output.get('memory_used_kb', harness_output.get('memoryUsedKb', 0)),
                'input': harness_output.get('input', ''),
                'error': harness_output.get('error'),
                'timedOut': harness_output.get('timedOut', False),
            }]
        
        # Judge each test case
        verdicts: List[TestCaseVerdict] = []
        
        for test_result in test_results:
            test_id = test_result.get('test_id', test_result.get('testId', f'test-{len(verdicts)+1}'))
            expected = None
            if expected_outputs:
                expected = expected_outputs.get(test_id)
            
            verdict = self.judge_test_case(test_result, expected)
            verdicts.append(verdict)
        
        # Aggregate results
        total_score = sum(v.score for v in verdicts)
        max_score = sum(v.max_score for v in verdicts)
        passed_count = sum(1 for v in verdicts if v.verdict == Verdict.AC.value)
        failed_count = len(verdicts) - passed_count
        total_time = sum(v.execution_time_ms for v in verdicts)
        max_memory = max((v.memory_used_kb for v in verdicts), default=0)
        
        # Determine final verdict
        if all(v.verdict == Verdict.AC.value for v in verdicts):
            final_verdict = Verdict.AC.value
        elif any(v.verdict == Verdict.TLE.value for v in verdicts):
            final_verdict = Verdict.TLE.value
        elif any(v.verdict == Verdict.MLE.value for v in verdicts):
            final_verdict = Verdict.MLE.value
        elif any(v.verdict == Verdict.RE.value for v in verdicts):
            final_verdict = Verdict.RE.value
        else:
            final_verdict = Verdict.WA.value
        
        # Calculate percentage
        score_percentage = (total_score / max_score * 100) if max_score > 0 else 0.0
        
        return JudgeResult(
            final_verdict=final_verdict,
            total_score=round(total_score, 2),
            max_score=round(max_score, 2),
            score_percentage=round(score_percentage, 2),
            passed_count=passed_count,
            failed_count=failed_count,
            total_count=len(verdicts),
            total_time_ms=total_time,
            max_memory_kb=max_memory,
            test_verdicts=[asdict(v) for v in verdicts],
            compilation_status="success" if compile_result else None,
            compilation_message=None
        )


def load_expected_outputs(filepath: str) -> Dict[str, str]:
    """Load expected outputs from JSON file"""
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    if isinstance(data, list):
        # Array of test cases
        return {
            tc.get('id', tc.get('test_id', f'test-{i+1}')): tc.get('expected_output', tc.get('expectedOutput', ''))
            for i, tc in enumerate(data)
        }
    elif isinstance(data, dict):
        if 'test_cases' in data:
            return load_expected_outputs_from_list(data['test_cases'])
        else:
            # Direct mapping
            return data
    
    return {}


def load_expected_outputs_from_list(test_list: List[Dict]) -> Dict[str, str]:
    """Load expected outputs from a list"""
    return {
        tc.get('id', tc.get('test_id', f'test-{i+1}')): tc.get('expected_output', tc.get('expectedOutput', ''))
        for i, tc in enumerate(test_list)
    }


def load_problem_config(filepath: str) -> ProblemConfig:
    """Load problem configuration from JSON file"""
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    return ProblemConfig(
        time_limit_ms=data.get('time_limit_ms', data.get('timeLimitMs', 5000)),
        memory_limit_kb=data.get('memory_limit_kb', data.get('memoryLimitKb', 262144)),
        comparison_mode=data.get('comparison_mode', data.get('comparisonMode', 'exact')),
        float_tolerance=data.get('float_tolerance', data.get('floatTolerance', 1e-6)),
        special_judge_path=data.get('special_judge_path', data.get('specialJudgePath')),
        case_sensitive=data.get('case_sensitive', data.get('caseSensitive', True)),
        ignore_trailing_whitespace=data.get('ignore_trailing_whitespace', True),
        ignore_trailing_newlines=data.get('ignore_trailing_newlines', True),
        partial_scoring=data.get('partial_scoring', data.get('partialScoring', True)),
        test_weights=data.get('test_weights', data.get('testWeights', {}))
    )


def main():
    parser = argparse.ArgumentParser(description='Code Execution Judge')
    parser.add_argument('harness_output', help='Path to harness output JSON')
    parser.add_argument('--expected', '-e', help='Path to expected outputs JSON')
    parser.add_argument('--special-judge', '-s', help='Path to special judge executable')
    parser.add_argument('--problem-config', '-p', help='Path to problem configuration JSON')
    parser.add_argument('--output', '-o', help='Output file path (default: stdout)')
    parser.add_argument('--comparison', '-c', choices=['exact', 'token', 'float', 'special'],
                        default='exact', help='Comparison mode')
    parser.add_argument('--tolerance', '-t', type=float, default=1e-6,
                        help='Float comparison tolerance')
    parser.add_argument('--case-insensitive', action='store_true',
                        help='Case-insensitive comparison')
    
    args = parser.parse_args()
    
    # Load harness output
    with open(args.harness_output, 'r') as f:
        harness_output = json.load(f)
    
    # Load or create config
    if args.problem_config:
        config = load_problem_config(args.problem_config)
    else:
        config = ProblemConfig(
            comparison_mode=args.comparison,
            float_tolerance=args.tolerance,
            case_sensitive=not args.case_insensitive,
            special_judge_path=args.special_judge
        )
    
    # Override with command line args
    if args.special_judge:
        config.special_judge_path = args.special_judge
        config.comparison_mode = 'special'
    
    # Load expected outputs
    expected_outputs = None
    if args.expected:
        expected_outputs = load_expected_outputs(args.expected)
    
    # Create judge and run
    judge = Judge(config)
    result = judge.judge_submission(harness_output, expected_outputs)
    
    # Output result
    output_json = json.dumps(asdict(result), indent=2)
    
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output_json)
        print(f"Result written to: {args.output}", file=sys.stderr)
    else:
        print(output_json)
    
    # Exit with appropriate code
    sys.exit(0 if result.final_verdict == Verdict.AC.value else 1)


if __name__ == '__main__':
    main()

