/**
 * k6 Load Test Scenarios for Code Execution Engine
 * 
 * Run with: k6 run --out json=results.json loadtest/k6/scenarios.js
 * 
 * Scenarios:
 * 1. Burst: 1000 submissions in 1 minute
 * 2. Sustained: 100 RPS for 10 minutes
 * 3. Stress: Compilation-heavy workload
 * 4. Soak: Extended duration test
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/submit`;

// Custom metrics
const submissionDuration = new Trend('submission_duration', true);
const submissionErrors = new Counter('submission_errors');
const submissionSuccess = new Rate('submission_success');
const queueDepth = new Gauge('queue_depth');
const languageSubmissions = new Counter('language_submissions');

// =============================================================================
// Test Data: Code Samples by Language
// =============================================================================

const CODE_SAMPLES = {
  javascript: [
    {
      code: `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = [];
rl.on('line', line => lines.push(line));
rl.on('close', () => {
  const [a, b] = lines[0].split(' ').map(Number);
  console.log(a + b);
});`,
      name: 'sum_two_numbers',
    },
    {
      code: `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = [];
rl.on('line', line => lines.push(line));
rl.on('close', () => {
  const n = parseInt(lines[0]);
  const arr = lines[1].split(' ').map(Number);
  console.log(Math.max(...arr));
});`,
      name: 'find_max',
    },
    {
      code: `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = [];
rl.on('line', line => lines.push(line));
rl.on('close', () => {
  const n = parseInt(lines[0]);
  let fib = [0, 1];
  for (let i = 2; i <= n; i++) fib[i] = fib[i-1] + fib[i-2];
  console.log(fib[n]);
});`,
      name: 'fibonacci',
    },
  ],
  
  python: [
    {
      code: `
a, b = map(int, input().split())
print(a + b)`,
      name: 'sum_two_numbers',
    },
    {
      code: `
n = int(input())
arr = list(map(int, input().split()))
print(max(arr))`,
      name: 'find_max',
    },
    {
      code: `
def fib(n):
    if n <= 1: return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

n = int(input())
print(fib(n))`,
      name: 'fibonacci',
    },
    {
      code: `
import sys
sys.setrecursionlimit(10000)

def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

n = int(input())
arr = list(map(int, input().split()))
print(' '.join(map(str, quicksort(arr))))`,
      name: 'quicksort',
    },
  ],
  
  cpp: [
    {
      code: `
#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`,
      name: 'sum_two_numbers',
    },
    {
      code: `
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<int> arr(n);
    for (int i = 0; i < n; i++) cin >> arr[i];
    cout << *max_element(arr.begin(), arr.end()) << endl;
    return 0;
}`,
      name: 'find_max',
    },
    {
      code: `
#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> fib(n + 1);
    fib[0] = 0;
    fib[1] = 1;
    for (int i = 2; i <= n; i++) {
        fib[i] = fib[i-1] + fib[i-2];
    }
    cout << fib[n] << endl;
    return 0;
}`,
      name: 'fibonacci',
    },
    {
      code: `
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

void merge(vector<int>& arr, int l, int m, int r) {
    vector<int> left(arr.begin() + l, arr.begin() + m + 1);
    vector<int> right(arr.begin() + m + 1, arr.begin() + r + 1);
    int i = 0, j = 0, k = l;
    while (i < left.size() && j < right.size()) {
        arr[k++] = (left[i] <= right[j]) ? left[i++] : right[j++];
    }
    while (i < left.size()) arr[k++] = left[i++];
    while (j < right.size()) arr[k++] = right[j++];
}

void mergeSort(vector<int>& arr, int l, int r) {
    if (l < r) {
        int m = l + (r - l) / 2;
        mergeSort(arr, l, m);
        mergeSort(arr, m + 1, r);
        merge(arr, l, m, r);
    }
}

int main() {
    int n;
    cin >> n;
    vector<int> arr(n);
    for (int i = 0; i < n; i++) cin >> arr[i];
    mergeSort(arr, 0, n - 1);
    for (int x : arr) cout << x << " ";
    cout << endl;
    return 0;
}`,
      name: 'mergesort',
    },
  ],
  
  c: [
    {
      code: `
#include <stdio.h>

int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}`,
      name: 'sum_two_numbers',
    },
    {
      code: `
#include <stdio.h>

int main() {
    int n, max_val, temp;
    scanf("%d", &n);
    scanf("%d", &max_val);
    for (int i = 1; i < n; i++) {
        scanf("%d", &temp);
        if (temp > max_val) max_val = temp;
    }
    printf("%d\\n", max_val);
    return 0;
}`,
      name: 'find_max',
    },
  ],
  
  java: [
    {
      code: `
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}`,
      name: 'sum_two_numbers',
    },
    {
      code: `
import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int max = Integer.MIN_VALUE;
        for (int i = 0; i < n; i++) {
            int x = sc.nextInt();
            if (x > max) max = x;
        }
        System.out.println(max);
    }
}`,
      name: 'find_max',
    },
    {
      code: `
import java.util.*;

public class Main {
    static long fibonacci(int n) {
        if (n <= 1) return n;
        long a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            long c = a + b;
            a = b;
            b = c;
        }
        return b;
    }
    
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        System.out.println(fibonacci(n));
    }
}`,
      name: 'fibonacci',
    },
  ],
  
  rust: [
    {
      code: `
use std::io::{self, BufRead};

fn main() {
    let stdin = io::stdin();
    let line = stdin.lock().lines().next().unwrap().unwrap();
    let nums: Vec<i32> = line.split_whitespace()
        .map(|x| x.parse().unwrap())
        .collect();
    println!("{}", nums[0] + nums[1]);
}`,
      name: 'sum_two_numbers',
    },
  ],
  
  go: [
    {
      code: `
package main

import "fmt"

func main() {
    var a, b int
    fmt.Scan(&a, &b)
    fmt.Println(a + b)
}`,
      name: 'sum_two_numbers',
    },
  ],
};

// Language distribution weights
const LANGUAGE_WEIGHTS = {
  burst: { python: 40, javascript: 25, cpp: 20, java: 10, c: 3, rust: 1, go: 1 },
  sustained: { python: 35, javascript: 30, cpp: 15, java: 15, c: 3, rust: 1, go: 1 },
  compilation: { cpp: 40, c: 25, java: 20, rust: 10, go: 5 },
};

// Problem IDs for testing
const PROBLEM_IDS = ['prob_001', 'prob_002', 'prob_003', 'prob_004', 'prob_005'];

// =============================================================================
// Helper Functions
// =============================================================================

function selectLanguage(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  
  for (const [lang, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) return lang;
  }
  
  return Object.keys(weights)[0];
}

function getRandomSubmission(language) {
  const samples = CODE_SAMPLES[language];
  if (!samples || samples.length === 0) {
    // Fallback to Python if language not found
    return CODE_SAMPLES.python[0];
  }
  return randomItem(samples);
}

function generateUserId() {
  return `user_${randomIntBetween(1, 10000)}`;
}

// =============================================================================
// Scenario Options
// =============================================================================

export const options = {
  scenarios: {
    // Scenario 1: Burst - 1000 submissions in 1 minute
    burst: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 1000,
      maxDuration: '1m',
      exec: 'burstTest',
      startTime: '0s',
      tags: { scenario: 'burst' },
    },
    
    // Scenario 2: Sustained - 100 RPS for 10 minutes
    sustained: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 100,
      maxVUs: 200,
      exec: 'sustainedTest',
      startTime: '2m', // Start after burst completes
      tags: { scenario: 'sustained' },
    },
    
    // Scenario 3: Compilation stress - Heavy compiled language load
    compilation_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      stages: [
        { duration: '1m', target: 30 },   // Ramp up
        { duration: '3m', target: 50 },   // Stress
        { duration: '2m', target: 80 },   // Peak
        { duration: '1m', target: 30 },   // Ramp down
        { duration: '1m', target: 10 },   // Cool down
      ],
      exec: 'compilationStressTest',
      startTime: '13m', // Start after sustained
      tags: { scenario: 'compilation_stress' },
    },
    
    // Scenario 4: Soak test - Extended duration
    soak: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '30m',
      preAllocatedVUs: 60,
      maxVUs: 100,
      exec: 'soakTest',
      startTime: '22m', // Start after compilation stress
      tags: { scenario: 'soak' },
    },
  },
  
  thresholds: {
    // Overall thresholds
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed: ['rate<0.05'],
    submission_success: ['rate>0.95'],
    
    // Per-scenario thresholds
    'http_req_duration{scenario:burst}': ['p(95)<3000'],
    'http_req_duration{scenario:sustained}': ['p(95)<5000'],
    'http_req_duration{scenario:compilation_stress}': ['p(95)<8000'],
    'submission_success{scenario:burst}': ['rate>0.98'],
    'submission_success{scenario:sustained}': ['rate>0.95'],
  },
};

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Submit code and validate response
 */
function submitCode(language, problemId, userId) {
  const sample = getRandomSubmission(language);
  
  const payload = JSON.stringify({
    code: sample.code,
    language: language,
    problemId: problemId,
    userId: userId,
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { language: language },
  };
  
  const startTime = Date.now();
  const response = http.post(API_ENDPOINT, payload, params);
  const duration = Date.now() - startTime;
  
  // Record metrics
  submissionDuration.add(duration, { language: language });
  languageSubmissions.add(1, { language: language });
  
  const success = check(response, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'has submission id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.submissionId !== undefined;
      } catch {
        return false;
      }
    },
    'response time < 5s': () => duration < 5000,
  });
  
  if (success) {
    submissionSuccess.add(1);
  } else {
    submissionErrors.add(1);
    submissionSuccess.add(0);
  }
  
  return response;
}

/**
 * Scenario 1: Burst Test
 * 1000 submissions in 1 minute with mixed languages
 */
export function burstTest() {
  const language = selectLanguage(LANGUAGE_WEIGHTS.burst);
  const problemId = randomItem(PROBLEM_IDS);
  const userId = generateUserId();
  
  group('burst_submission', () => {
    submitCode(language, problemId, userId);
  });
  
  // Minimal sleep to allow some spacing
  sleep(randomIntBetween(10, 100) / 1000);
}

/**
 * Scenario 2: Sustained Test
 * 100 RPS for 10 minutes
 */
export function sustainedTest() {
  const language = selectLanguage(LANGUAGE_WEIGHTS.sustained);
  const problemId = randomItem(PROBLEM_IDS);
  const userId = generateUserId();
  
  group('sustained_submission', () => {
    submitCode(language, problemId, userId);
  });
}

/**
 * Scenario 3: Compilation Stress Test
 * Focus on compiled languages (C, C++, Java, Rust, Go)
 */
export function compilationStressTest() {
  const language = selectLanguage(LANGUAGE_WEIGHTS.compilation);
  const problemId = randomItem(PROBLEM_IDS);
  const userId = generateUserId();
  
  group('compilation_submission', () => {
    submitCode(language, problemId, userId);
  });
}

/**
 * Scenario 4: Soak Test
 * Extended duration with moderate load
 */
export function soakTest() {
  const language = selectLanguage(LANGUAGE_WEIGHTS.sustained);
  const problemId = randomItem(PROBLEM_IDS);
  const userId = generateUserId();
  
  group('soak_submission', () => {
    submitCode(language, problemId, userId);
  });
}

// =============================================================================
// Lifecycle Hooks
// =============================================================================

export function setup() {
  console.log('Starting load test...');
  console.log(`Target URL: ${API_ENDPOINT}`);
  
  // Verify API is accessible
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    console.warn('Health check failed, API may not be ready');
  }
  
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration.toFixed(2)} seconds`);
}

// =============================================================================
// Default function (for simple runs)
// =============================================================================

export default function() {
  sustainedTest();
}

