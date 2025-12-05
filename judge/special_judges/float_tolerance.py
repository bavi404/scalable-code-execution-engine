#!/usr/bin/env python3
"""
Floating-Point Tolerance Special Judge

Compares floating-point values with configurable tolerance.
Supports both absolute and relative tolerance.
"""

import sys
import json
import math
import os

# Tolerance settings (can be overridden by environment)
ABSOLUTE_TOLERANCE = float(os.environ.get('FLOAT_ABS_TOL', '1e-9'))
RELATIVE_TOLERANCE = float(os.environ.get('FLOAT_REL_TOL', '1e-6'))


def is_close(expected: float, actual: float) -> bool:
    """Check if two floats are close enough using both tolerances"""
    # Handle special cases
    if math.isnan(expected) and math.isnan(actual):
        return True
    if math.isnan(expected) or math.isnan(actual):
        return False
    if math.isinf(expected) and math.isinf(actual):
        return (expected > 0) == (actual > 0)  # Same sign infinity
    if math.isinf(expected) or math.isinf(actual):
        return False
    
    diff = abs(expected - actual)
    
    # Check absolute tolerance first
    if diff <= ABSOLUTE_TOLERANCE:
        return True
    
    # Check relative tolerance
    if expected != 0:
        return diff <= RELATIVE_TOLERANCE * abs(expected)
    
    return False


def parse_floats(text: str) -> list:
    """Parse text into list of floats"""
    tokens = text.split()
    return [float(t) for t in tokens]


def main():
    if len(sys.argv) < 4:
        print(json.dumps({
            "verdict": "IE",
            "score": 0,
            "message": "Usage: float_tolerance.py <input> <expected> <actual> [test_id]"
        }))
        sys.exit(1)
    
    input_file, expected_file, actual_file = sys.argv[1:4]
    test_id = sys.argv[4] if len(sys.argv) > 4 else "unknown"
    
    try:
        with open(expected_file, 'r') as f:
            expected_text = f.read().strip()
        
        with open(actual_file, 'r') as f:
            actual_text = f.read().strip()
        
        # Parse values
        try:
            expected_values = parse_floats(expected_text)
        except ValueError as e:
            print(json.dumps({
                "verdict": "IE",
                "score": 0,
                "message": f"Cannot parse expected output: {e}"
            }))
            return
        
        try:
            actual_values = parse_floats(actual_text)
        except ValueError as e:
            print(json.dumps({
                "verdict": "WA",
                "score": 0,
                "message": f"Cannot parse contestant output as float: {e}"
            }))
            return
        
        # Check count
        if len(expected_values) != len(actual_values):
            print(json.dumps({
                "verdict": "WA",
                "score": 0,
                "message": f"Expected {len(expected_values)} values, got {len(actual_values)}"
            }))
            return
        
        # Compare values
        for i, (exp, act) in enumerate(zip(expected_values, actual_values)):
            if not is_close(exp, act):
                print(json.dumps({
                    "verdict": "WA",
                    "score": 0,
                    "message": f"Value {i+1}: expected {exp}, got {act} (diff: {abs(exp-act):.2e})"
                }))
                return
        
        print(json.dumps({
            "verdict": "AC",
            "passed": True,
            "score": 1.0,
            "message": f"All {len(expected_values)} value(s) within tolerance"
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

