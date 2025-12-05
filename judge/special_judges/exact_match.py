#!/usr/bin/env python3
"""
Exact Match Special Judge

Compares expected and actual output with whitespace normalization.
"""

import sys
import json


def normalize(text: str) -> str:
    """Normalize text: strip trailing whitespace per line and trailing newlines"""
    lines = text.split('\n')
    lines = [line.rstrip() for line in lines]
    # Remove trailing empty lines
    while lines and not lines[-1]:
        lines.pop()
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 4:
        print(json.dumps({
            "verdict": "IE",
            "score": 0,
            "message": "Usage: exact_match.py <input> <expected> <actual> [test_id]"
        }))
        sys.exit(1)
    
    input_file, expected_file, actual_file = sys.argv[1:4]
    test_id = sys.argv[4] if len(sys.argv) > 4 else "unknown"
    
    try:
        with open(expected_file, 'r') as f:
            expected = normalize(f.read())
        
        with open(actual_file, 'r') as f:
            actual = normalize(f.read())
        
        if expected == actual:
            print(json.dumps({
                "verdict": "AC",
                "passed": True,
                "score": 1.0,
                "message": "Output matches expected"
            }))
        else:
            # Find first difference
            exp_lines = expected.split('\n')
            act_lines = actual.split('\n')
            
            if len(exp_lines) != len(act_lines):
                message = f"Line count mismatch: expected {len(exp_lines)}, got {len(act_lines)}"
            else:
                diff_line = None
                for i, (e, a) in enumerate(zip(exp_lines, act_lines)):
                    if e != a:
                        diff_line = i + 1
                        break
                message = f"Difference at line {diff_line}" if diff_line else "Output differs"
            
            print(json.dumps({
                "verdict": "WA",
                "passed": False,
                "score": 0.0,
                "message": message
            }))
    
    except Exception as e:
        print(json.dumps({
            "verdict": "IE",
            "score": 0,
            "message": f"Judge error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()

