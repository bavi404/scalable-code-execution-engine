# Special Judge Contract

This document defines the interface contract for special judges (custom checkers) used for problems with multiple valid outputs or complex validation requirements.

## Overview

A special judge is an executable program that determines if a submission's output is correct. It's used when:
- Multiple outputs are valid (e.g., "find any path")
- Output requires complex validation (e.g., graph verification)
- Partial scoring based on output quality
- Floating-point comparison with custom tolerance
- Interactive problems

## Interface Contract

### Input Methods

Special judges receive input in one of two ways:

#### Method 1: Command Line Arguments (Recommended)

```
./special_judge <input_file> <expected_file> <actual_file> [test_id]
```

| Argument | Description |
|----------|-------------|
| `input_file` | Path to test case input |
| `expected_file` | Path to expected/reference output |
| `actual_file` | Path to contestant's output |
| `test_id` | Optional test case identifier |

#### Method 2: Standard Input (JSON)

```json
{
  "input": "5 3\n1 2 3 4 5\n",
  "expected": "3\n",
  "actual": "3\n",
  "test_id": "test-1"
}
```

### Output Format

The special judge should output JSON to stdout:

```json
{
  "verdict": "AC",
  "passed": true,
  "score": 1.0,
  "message": "Output is correct"
}
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `verdict` | string | Yes | One of: AC, WA, PE |
| `passed` | boolean | No | True if accepted (default: verdict == "AC") |
| `score` | number | No | Score between 0.0 and 1.0 (default: 1.0 if AC, 0.0 otherwise) |
| `message` | string | No | Feedback message for contestant |

#### Simplified Output

For simple cases, the judge can output just:
- `1` or `AC` or `true` → Accepted (score: 1.0)
- `0` or `WA` or `false` → Wrong Answer (score: 0.0)
- A number (e.g., `0.75`) → Partial score

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Judge completed successfully |
| 1 | Judge error (output still read) |
| 2+ | Internal error (submission marked IE) |

## Example Special Judges

### 1. Permutation Validator (Python)

Validates that output is a valid permutation of 1..N:

```python
#!/usr/bin/env python3
"""
Special judge for permutation problems.
Verifies output is a valid permutation of 1 to N.
"""

import sys
import json

def main():
    input_file, expected_file, actual_file = sys.argv[1:4]
    test_id = sys.argv[4] if len(sys.argv) > 4 else ""
    
    # Read input to get N
    with open(input_file) as f:
        n = int(f.read().strip().split()[0])
    
    # Read contestant output
    with open(actual_file) as f:
        actual = f.read().strip()
    
    try:
        values = list(map(int, actual.split()))
    except ValueError:
        print(json.dumps({
            "verdict": "WA",
            "score": 0,
            "message": "Output contains non-integer values"
        }))
        return
    
    # Validate permutation
    if len(values) != n:
        print(json.dumps({
            "verdict": "WA",
            "score": 0,
            "message": f"Expected {n} values, got {len(values)}"
        }))
        return
    
    if sorted(values) != list(range(1, n + 1)):
        print(json.dumps({
            "verdict": "WA",
            "score": 0,
            "message": "Not a valid permutation of 1 to N"
        }))
        return
    
    print(json.dumps({
        "verdict": "AC",
        "score": 1.0,
        "message": "Valid permutation"
    }))

if __name__ == "__main__":
    main()
```

### 2. Floating Point with Tolerance (Python)

```python
#!/usr/bin/env python3
"""
Special judge for floating-point comparison with tolerance.
Supports both absolute and relative tolerance.
"""

import sys
import json
import math

ABSOLUTE_TOLERANCE = 1e-9
RELATIVE_TOLERANCE = 1e-6

def is_close(expected, actual):
    """Check if two floats are close enough"""
    if math.isnan(expected) and math.isnan(actual):
        return True
    if math.isinf(expected) and math.isinf(actual):
        return expected == actual  # Same sign infinity
    
    diff = abs(expected - actual)
    return diff <= ABSOLUTE_TOLERANCE or diff <= RELATIVE_TOLERANCE * abs(expected)

def main():
    input_file, expected_file, actual_file = sys.argv[1:4]
    
    with open(expected_file) as f:
        expected_values = [float(x) for x in f.read().split()]
    
    with open(actual_file) as f:
        try:
            actual_values = [float(x) for x in f.read().split()]
        except ValueError as e:
            print(json.dumps({
                "verdict": "WA",
                "score": 0,
                "message": f"Cannot parse output as float: {e}"
            }))
            return
    
    if len(expected_values) != len(actual_values):
        print(json.dumps({
            "verdict": "WA",
            "score": 0,
            "message": f"Expected {len(expected_values)} values, got {len(actual_values)}"
        }))
        return
    
    for i, (exp, act) in enumerate(zip(expected_values, actual_values)):
        if not is_close(exp, act):
            print(json.dumps({
                "verdict": "WA",
                "score": 0,
                "message": f"Value {i+1}: expected {exp}, got {act}"
            }))
            return
    
    print(json.dumps({
        "verdict": "AC",
        "score": 1.0,
        "message": "All values within tolerance"
    }))

if __name__ == "__main__":
    main()
```

### 3. Graph Path Validator (Python)

```python
#!/usr/bin/env python3
"""
Special judge for shortest path problems.
Verifies path exists and has correct length.
"""

import sys
import json
from collections import defaultdict

def main():
    input_file, expected_file, actual_file = sys.argv[1:4]
    
    # Parse graph from input
    with open(input_file) as f:
        lines = f.read().strip().split('\n')
        n, m = map(int, lines[0].split())
        source, target = map(int, lines[1].split())
        
        graph = defaultdict(list)
        for i in range(2, 2 + m):
            u, v, w = map(int, lines[i].split())
            graph[u].append((v, w))
            graph[v].append((u, w))  # Undirected
    
    # Get expected distance
    with open(expected_file) as f:
        expected_dist = int(f.read().strip().split()[0])
    
    # Parse contestant path
    with open(actual_file) as f:
        actual = f.read().strip()
    
    if actual == "-1" or actual == "IMPOSSIBLE":
        if expected_dist == -1:
            print(json.dumps({"verdict": "AC", "score": 1.0, "message": "Correctly identified no path"}))
        else:
            print(json.dumps({"verdict": "WA", "score": 0, "message": "Path exists but claimed impossible"}))
        return
    
    try:
        path = list(map(int, actual.split()))
    except ValueError:
        print(json.dumps({"verdict": "WA", "score": 0, "message": "Invalid path format"}))
        return
    
    # Validate path
    if path[0] != source:
        print(json.dumps({"verdict": "WA", "score": 0, "message": f"Path must start at {source}"}))
        return
    
    if path[-1] != target:
        print(json.dumps({"verdict": "WA", "score": 0, "message": f"Path must end at {target}"}))
        return
    
    # Calculate path length
    total_dist = 0
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge_found = False
        for neighbor, weight in graph[u]:
            if neighbor == v:
                total_dist += weight
                edge_found = True
                break
        
        if not edge_found:
            print(json.dumps({
                "verdict": "WA",
                "score": 0,
                "message": f"No edge between {u} and {v}"
            }))
            return
    
    if total_dist == expected_dist:
        print(json.dumps({
            "verdict": "AC",
            "score": 1.0,
            "message": f"Valid shortest path of length {total_dist}"
        }))
    elif total_dist > expected_dist:
        # Partial credit for valid but suboptimal path
        score = expected_dist / total_dist * 0.5
        print(json.dumps({
            "verdict": "WA",
            "score": score,
            "message": f"Valid path but not shortest: {total_dist} > {expected_dist}"
        }))
    else:
        # Found shorter path than expected (shouldn't happen)
        print(json.dumps({
            "verdict": "AC",
            "score": 1.0,
            "message": f"Found path of length {total_dist}"
        }))

if __name__ == "__main__":
    main()
```

### 4. Partial Credit Scorer (Python)

```python
#!/usr/bin/env python3
"""
Special judge that awards partial credit based on correctness percentage.
Useful for problems with multiple sub-answers.
"""

import sys
import json

def main():
    input_file, expected_file, actual_file = sys.argv[1:4]
    
    with open(expected_file) as f:
        expected_lines = [line.strip() for line in f.readlines() if line.strip()]
    
    with open(actual_file) as f:
        actual_lines = [line.strip() for line in f.readlines() if line.strip()]
    
    if len(actual_lines) != len(expected_lines):
        # Pad or truncate for comparison
        if len(actual_lines) < len(expected_lines):
            actual_lines.extend([''] * (len(expected_lines) - len(actual_lines)))
        else:
            actual_lines = actual_lines[:len(expected_lines)]
    
    correct = sum(1 for e, a in zip(expected_lines, actual_lines) if e == a)
    total = len(expected_lines)
    score = correct / total if total > 0 else 0
    
    if score == 1.0:
        verdict = "AC"
        message = "All answers correct"
    elif score > 0:
        verdict = "WA"
        message = f"{correct}/{total} correct ({score*100:.1f}%)"
    else:
        verdict = "WA"
        message = "No correct answers"
    
    print(json.dumps({
        "verdict": verdict,
        "score": score,
        "message": message
    }))

if __name__ == "__main__":
    main()
```

### 5. Simple Checker (Bash)

```bash
#!/bin/bash
# Simple exact match checker in bash

EXPECTED_FILE="$2"
ACTUAL_FILE="$3"

# Normalize and compare
EXPECTED=$(cat "$EXPECTED_FILE" | tr -d '\r' | sed 's/[[:space:]]*$//')
ACTUAL=$(cat "$ACTUAL_FILE" | tr -d '\r' | sed 's/[[:space:]]*$//')

if [ "$EXPECTED" = "$ACTUAL" ]; then
    echo '{"verdict": "AC", "score": 1.0, "message": "Correct"}'
    exit 0
else
    echo '{"verdict": "WA", "score": 0.0, "message": "Output differs"}'
    exit 0
fi
```

### 6. C++ Special Judge

```cpp
// checker.cpp - Compile with: g++ -O2 -o checker checker.cpp

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <cmath>

int main(int argc, char* argv[]) {
    if (argc < 4) {
        std::cerr << "Usage: " << argv[0] << " <input> <expected> <actual>" << std::endl;
        return 2;
    }
    
    std::ifstream input_file(argv[1]);
    std::ifstream expected_file(argv[2]);
    std::ifstream actual_file(argv[3]);
    
    if (!input_file || !expected_file || !actual_file) {
        std::cout << R"({"verdict": "IE", "score": 0, "message": "Cannot open files"})" << std::endl;
        return 1;
    }
    
    double expected, actual;
    expected_file >> expected;
    
    if (!(actual_file >> actual)) {
        std::cout << R"({"verdict": "WA", "score": 0, "message": "Invalid output format"})" << std::endl;
        return 0;
    }
    
    const double TOLERANCE = 1e-9;
    double diff = std::abs(expected - actual);
    
    if (diff <= TOLERANCE || diff <= TOLERANCE * std::abs(expected)) {
        std::cout << R"({"verdict": "AC", "score": 1.0, "message": "Correct"})" << std::endl;
    } else {
        std::cout << R"({"verdict": "WA", "score": 0, "message": "Value mismatch"})" << std::endl;
    }
    
    return 0;
}
```

## Usage with Judge Module

### Command Line

```bash
# With special judge
python judge.py harness_output.json --special-judge ./my_checker

# With problem config
python judge.py harness_output.json --problem-config problem.json
```

### Problem Configuration

```json
{
  "time_limit_ms": 2000,
  "memory_limit_kb": 262144,
  "comparison_mode": "special",
  "special_judge_path": "./checkers/permutation_checker.py",
  "partial_scoring": true,
  "test_weights": {
    "test-1": 1.0,
    "test-2": 1.0,
    "test-3": 2.0,
    "test-4": 3.0
  }
}
```

## Security Considerations

1. **Sandbox the judge**: Run special judges with resource limits
2. **Timeout**: Set a maximum execution time (default: 30s)
3. **Input validation**: Validate all inputs before processing
4. **No network**: Judges should not require network access
5. **Deterministic**: Same inputs should produce same outputs

## Testing Your Special Judge

```bash
# Create test files
echo "5" > input.txt
echo "1 2 3 4 5" > expected.txt
echo "5 4 3 2 1" > actual.txt

# Run special judge
./my_checker input.txt expected.txt actual.txt test-1

# Expected output (example):
# {"verdict": "AC", "score": 1.0, "message": "Valid permutation"}
```

## Common Patterns

### Multiple Valid Outputs
When multiple outputs are valid:
- Validate structural correctness
- Don't compare with expected
- Return AC if valid, WA otherwise

### Optimization Problems
For problems where better solutions score higher:
- Parse contestant's solution
- Calculate quality metric
- Return score = your_metric / optimal_metric

### Interactive Problems
For interactive problems:
- Use stdin/stdout for communication
- Implement game/query protocol
- Track state across interactions

## Error Handling

```python
# Always handle errors gracefully
try:
    result = validate_output(actual)
    print(json.dumps({"verdict": "AC" if result else "WA", "score": float(result)}))
except Exception as e:
    print(json.dumps({"verdict": "IE", "score": 0, "message": str(e)}))
    sys.exit(1)
```

