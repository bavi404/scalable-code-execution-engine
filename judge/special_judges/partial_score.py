#!/usr/bin/env python3
"""
Partial Score Special Judge

Awards partial credit based on the percentage of correct answers.
Useful for problems with multiple independent sub-answers.
"""

import sys
import json


def main():
    if len(sys.argv) < 4:
        print(json.dumps({
            "verdict": "IE",
            "score": 0,
            "message": "Usage: partial_score.py <input> <expected> <actual> [test_id]"
        }))
        sys.exit(1)
    
    input_file, expected_file, actual_file = sys.argv[1:4]
    test_id = sys.argv[4] if len(sys.argv) > 4 else "unknown"
    
    try:
        with open(expected_file, 'r') as f:
            expected_lines = [line.strip() for line in f if line.strip()]
        
        with open(actual_file, 'r') as f:
            actual_lines = [line.strip() for line in f if line.strip()]
        
        if len(expected_lines) == 0:
            if len(actual_lines) == 0:
                print(json.dumps({
                    "verdict": "AC",
                    "score": 1.0,
                    "message": "Both empty (correct)"
                }))
            else:
                print(json.dumps({
                    "verdict": "WA",
                    "score": 0,
                    "message": f"Expected empty output, got {len(actual_lines)} lines"
                }))
            return
        
        # Pad actual if shorter
        while len(actual_lines) < len(expected_lines):
            actual_lines.append("")
        
        # Count correct answers
        correct_count = 0
        wrong_indices = []
        
        for i, (exp, act) in enumerate(zip(expected_lines, actual_lines)):
            if exp == act:
                correct_count += 1
            else:
                wrong_indices.append(i + 1)
        
        total = len(expected_lines)
        score = correct_count / total
        
        # Also penalize extra lines
        extra_lines = len(actual_lines) - len(expected_lines)
        if extra_lines > 0:
            score = max(0, score - 0.1 * extra_lines)
        
        # Determine verdict
        if correct_count == total and extra_lines == 0:
            verdict = "AC"
            message = f"All {total} answers correct"
        elif score > 0:
            verdict = "WA"
            if len(wrong_indices) <= 5:
                message = f"{correct_count}/{total} correct. Wrong at: {wrong_indices}"
            else:
                message = f"{correct_count}/{total} correct ({score*100:.1f}%)"
        else:
            verdict = "WA"
            message = "No correct answers"
        
        print(json.dumps({
            "verdict": verdict,
            "passed": verdict == "AC",
            "score": round(score, 4),
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

