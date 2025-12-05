"""
Locust Load Test for Code Execution Engine

Run with:
    locust -f loadtest/locust/locustfile.py --host=http://localhost:3000

For headless mode:
    locust -f loadtest/locust/locustfile.py --host=http://localhost:3000 \
           --headless -u 100 -r 10 --run-time 10m
"""

import random
import json
import time
from locust import HttpUser, task, between, events, tag
from locust.runners import MasterRunner, WorkerRunner

# =============================================================================
# Code Samples
# =============================================================================

CODE_SAMPLES = {
    "python": [
        "a, b = map(int, input().split())\nprint(a + b)",
        "n = int(input())\narr = list(map(int, input().split()))\nprint(max(arr))",
        "def fib(n):\n    if n <= 1: return n\n    a, b = 0, 1\n    for _ in range(2, n + 1): a, b = b, a + b\n    return b\nprint(fib(int(input())))",
    ],
    "javascript": [
        "const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nrl.on('line', (line) => { const [a, b] = line.split(' ').map(Number); console.log(a + b); rl.close(); });",
        "const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nlet lines = [];\nrl.on('line', l => lines.push(l));\nrl.on('close', () => console.log(Math.max(...lines[1].split(' ').map(Number))));",
    ],
    "cpp": [
        "#include <iostream>\nusing namespace std;\nint main() { int a, b; cin >> a >> b; cout << a + b << endl; return 0; }",
        "#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\nint main() { int n; cin >> n; vector<int> a(n); for(int i=0;i<n;i++) cin>>a[i]; cout << *max_element(a.begin(),a.end()) << endl; return 0; }",
    ],
    "java": [
        "import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner sc = new Scanner(System.in); System.out.println(sc.nextInt() + sc.nextInt()); }}",
    ],
    "c": [
        "#include <stdio.h>\nint main() { int a, b; scanf(\"%d %d\", &a, &b); printf(\"%d\\n\", a + b); return 0; }",
    ],
    "rust": [
        "use std::io::{self, BufRead};\n\nfn main() {\n    let stdin = io::stdin();\n    let line = stdin.lock().lines().next().unwrap().unwrap();\n    let nums: Vec<i32> = line.split_whitespace().map(|x| x.parse().unwrap()).collect();\n    println!(\"{}\", nums[0] + nums[1]);\n}",
    ],
    "go": [
        "package main\n\nimport \"fmt\"\n\nfunc main() {\n    var a, b int\n    fmt.Scan(&a, &b)\n    fmt.Println(a + b)\n}",
    ],
}

PROBLEM_IDS = ["prob_001", "prob_002", "prob_003", "prob_004", "prob_005"]

# Language weights for different scenarios
MIXED_WEIGHTS = {"python": 35, "javascript": 30, "cpp": 15, "java": 15, "c": 3, "rust": 1, "go": 1}
COMPILATION_WEIGHTS = {"cpp": 40, "c": 25, "java": 20, "rust": 10, "go": 5}


def select_language(weights):
    """Select a random language based on weights."""
    total = sum(weights.values())
    r = random.uniform(0, total)
    cumulative = 0
    for lang, weight in weights.items():
        cumulative += weight
        if r <= cumulative:
            return lang
    return list(weights.keys())[0]


# =============================================================================
# Statistics Tracking
# =============================================================================

class Stats:
    """Global statistics tracker."""
    submissions = 0
    successes = 0
    failures = 0
    by_language = {}
    by_verdict = {}


@events.request.add_listener
def on_request(request_type, name, response_time, response_length, exception, **kwargs):
    """Track request statistics."""
    if name == "/api/submit":
        Stats.submissions += 1
        if exception is None:
            Stats.successes += 1
        else:
            Stats.failures += 1


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Print final statistics."""
    print("\n" + "=" * 80)
    print("FINAL STATISTICS")
    print("=" * 80)
    print(f"Total Submissions: {Stats.submissions}")
    print(f"Successes: {Stats.successes}")
    print(f"Failures: {Stats.failures}")
    print(f"Success Rate: {Stats.successes / max(Stats.submissions, 1) * 100:.2f}%")
    print("=" * 80)


# =============================================================================
# User Classes
# =============================================================================

class MixedLanguageUser(HttpUser):
    """
    User that submits code in various languages.
    Used for burst and sustained load tests.
    """
    
    wait_time = between(0.1, 0.5)
    weight = 3  # Higher weight means more of these users
    
    @task(10)
    @tag("mixed", "python")
    def submit_python(self):
        """Submit Python code."""
        self._submit("python")
    
    @task(8)
    @tag("mixed", "javascript")
    def submit_javascript(self):
        """Submit JavaScript code."""
        self._submit("javascript")
    
    @task(4)
    @tag("mixed", "cpp")
    def submit_cpp(self):
        """Submit C++ code."""
        self._submit("cpp")
    
    @task(3)
    @tag("mixed", "java")
    def submit_java(self):
        """Submit Java code."""
        self._submit("java")
    
    @task(1)
    @tag("mixed", "c")
    def submit_c(self):
        """Submit C code."""
        self._submit("c")
    
    def _submit(self, language):
        """Submit code for a given language."""
        code = random.choice(CODE_SAMPLES.get(language, CODE_SAMPLES["python"]))
        
        payload = {
            "code": code,
            "language": language,
            "problemId": random.choice(PROBLEM_IDS),
            "userId": f"user_{random.randint(1, 10000)}",
        }
        
        with self.client.post(
            "/api/submit",
            json=payload,
            catch_response=True,
            name="/api/submit"
        ) as response:
            if response.status_code in [200, 201]:
                try:
                    body = response.json()
                    if "submissionId" in body:
                        response.success()
                        Stats.by_language[language] = Stats.by_language.get(language, 0) + 1
                    else:
                        response.failure("Missing submissionId in response")
                except json.JSONDecodeError:
                    response.failure("Invalid JSON response")
            else:
                response.failure(f"Status code: {response.status_code}")


class CompilationStressUser(HttpUser):
    """
    User that only submits compiled languages (C, C++, Java, Rust, Go).
    Used for compilation stress testing.
    """
    
    wait_time = between(0.5, 1.5)
    weight = 1
    
    @task(10)
    @tag("compilation", "cpp")
    def submit_cpp(self):
        """Submit C++ code."""
        self._submit_compiled("cpp")
    
    @task(6)
    @tag("compilation", "c")
    def submit_c(self):
        """Submit C code."""
        self._submit_compiled("c")
    
    @task(5)
    @tag("compilation", "java")
    def submit_java(self):
        """Submit Java code."""
        self._submit_compiled("java")
    
    @task(2)
    @tag("compilation", "rust")
    def submit_rust(self):
        """Submit Rust code."""
        self._submit_compiled("rust")
    
    @task(1)
    @tag("compilation", "go")
    def submit_go(self):
        """Submit Go code."""
        self._submit_compiled("go")
    
    def _submit_compiled(self, language):
        """Submit compiled language code."""
        code = random.choice(CODE_SAMPLES.get(language, CODE_SAMPLES["cpp"]))
        
        payload = {
            "code": code,
            "language": language,
            "problemId": random.choice(PROBLEM_IDS),
            "userId": f"user_{random.randint(1, 10000)}",
        }
        
        with self.client.post(
            "/api/submit",
            json=payload,
            catch_response=True,
            name="/api/submit [compiled]"
        ) as response:
            if response.status_code in [200, 201]:
                try:
                    body = response.json()
                    if "submissionId" in body:
                        response.success()
                    else:
                        response.failure("Missing submissionId")
                except json.JSONDecodeError:
                    response.failure("Invalid JSON")
            else:
                response.failure(f"Status: {response.status_code}")


class BurstUser(HttpUser):
    """
    User for burst testing - minimal wait time, rapid submissions.
    """
    
    wait_time = between(0.01, 0.05)  # Very short wait
    weight = 1
    
    @task
    @tag("burst")
    def burst_submit(self):
        """Rapid-fire submission."""
        language = select_language(MIXED_WEIGHTS)
        code = random.choice(CODE_SAMPLES.get(language, CODE_SAMPLES["python"]))
        
        payload = {
            "code": code,
            "language": language,
            "problemId": random.choice(PROBLEM_IDS),
            "userId": f"burst_user_{random.randint(1, 1000)}",
        }
        
        with self.client.post(
            "/api/submit",
            json=payload,
            catch_response=True,
            name="/api/submit [burst]"
        ) as response:
            if response.status_code in [200, 201]:
                response.success()
            else:
                response.failure(f"Status: {response.status_code}")


# =============================================================================
# Custom Load Shapes
# =============================================================================

from locust import LoadTestShape


class BurstLoadShape(LoadTestShape):
    """
    Burst load shape: 1000 submissions in 1 minute.
    
    Spawns 50 users who each make ~20 requests in 1 minute.
    """
    
    time_limit = 60  # 1 minute
    spawn_rate = 50   # Spawn all users quickly
    user_count = 50
    
    def tick(self):
        run_time = self.get_run_time()
        
        if run_time < self.time_limit:
            return (self.user_count, self.spawn_rate)
        
        return None


class SustainedLoadShape(LoadTestShape):
    """
    Sustained load shape: 100 RPS for 10 minutes.
    
    Assumes each user can do ~2 requests/second.
    Need ~50 users for 100 RPS.
    """
    
    stages = [
        {"duration": 30, "users": 25, "spawn_rate": 5},    # Warm up
        {"duration": 600, "users": 50, "spawn_rate": 10},  # Sustained 100 RPS
        {"duration": 30, "users": 0, "spawn_rate": 10},    # Cool down
    ]
    
    def tick(self):
        run_time = self.get_run_time()
        
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
            run_time -= stage["duration"]
        
        return None


class CompilationStressLoadShape(LoadTestShape):
    """
    Compilation stress load shape: Ramping load targeting compiled languages.
    """
    
    stages = [
        {"duration": 30, "users": 10, "spawn_rate": 2},    # Warm up
        {"duration": 60, "users": 30, "spawn_rate": 2},    # Ramp up
        {"duration": 120, "users": 50, "spawn_rate": 2},   # Moderate
        {"duration": 120, "users": 80, "spawn_rate": 2},   # High stress
        {"duration": 60, "users": 100, "spawn_rate": 2},   # Peak
        {"duration": 60, "users": 50, "spawn_rate": 2},    # Ramp down
        {"duration": 30, "users": 10, "spawn_rate": 2},    # Cool down
    ]
    
    def tick(self):
        run_time = self.get_run_time()
        
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
            run_time -= stage["duration"]
        
        return None


# =============================================================================
# Run configurations (use with --class-picker or -T flag)
# =============================================================================

# For burst test: locust -f locustfile.py -u 50 -r 50 --run-time 1m -T burst
# For sustained: locust -f locustfile.py -u 50 -r 10 --run-time 10m -T mixed
# For compilation: locust -f locustfile.py -u 100 -r 10 --run-time 8m -T compilation

