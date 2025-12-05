/**
 * k6 Sustained Load Test
 * 
 * 100 RPS for 10 minutes with mixed languages
 * 
 * Run with: k6 run loadtest/k6/sustained-100rps.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/submit`;

// Custom metrics
const submissionDuration = new Trend('submission_duration', true);
const submissionSuccess = new Rate('submission_success');
const languageCounter = new Counter('submissions_by_language');

// Code samples
const CODE_SAMPLES = {
  python: [
    `a, b = map(int, input().split())\nprint(a + b)`,
    `n = int(input())\narr = list(map(int, input().split()))\nprint(max(arr))`,
    `def fib(n):\n    if n <= 1: return n\n    a, b = 0, 1\n    for _ in range(2, n + 1): a, b = b, a + b\n    return b\nprint(fib(int(input())))`,
  ],
  javascript: [
    `const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nrl.on('line', (line) => { const [a, b] = line.split(' ').map(Number); console.log(a + b); rl.close(); });`,
    `const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nlet lines = [];\nrl.on('line', l => lines.push(l));\nrl.on('close', () => console.log(Math.max(...lines[1].split(' ').map(Number))));`,
  ],
  cpp: [
    `#include <iostream>\nusing namespace std;\nint main() { int a, b; cin >> a >> b; cout << a + b << endl; return 0; }`,
    `#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\nint main() { int n; cin >> n; vector<int> a(n); for(int i=0;i<n;i++) cin>>a[i]; cout << *max_element(a.begin(),a.end()) << endl; return 0; }`,
  ],
  java: [
    `import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner sc = new Scanner(System.in); System.out.println(sc.nextInt() + sc.nextInt()); }}`,
  ],
  c: [
    `#include <stdio.h>\nint main() { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }`,
  ],
};

// Language weights (Python and JS are most common)
const LANGUAGE_WEIGHTS = { python: 35, javascript: 30, cpp: 20, java: 10, c: 5 };
const PROBLEMS = ['prob_001', 'prob_002', 'prob_003', 'prob_004', 'prob_005'];

function selectLanguage() {
  const total = Object.values(LANGUAGE_WEIGHTS).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (const [lang, weight] of Object.entries(LANGUAGE_WEIGHTS)) {
    random -= weight;
    if (random <= 0) return lang;
  }
  return 'python';
}

export const options = {
  scenarios: {
    sustained_load: {
      executor: 'constant-arrival-rate',
      rate: 100,              // 100 requests per second
      timeUnit: '1s',
      duration: '10m',        // For 10 minutes
      preAllocatedVUs: 100,   // Pre-allocate 100 VUs
      maxVUs: 200,            // Allow scaling to 200 VUs if needed
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed: ['rate<0.05'],
    submission_success: ['rate>0.95'],
    http_reqs: ['rate>=95'],  // At least 95 RPS achieved
  },
};

export default function() {
  const language = selectLanguage();
  const samples = CODE_SAMPLES[language];
  const code = randomItem(samples);
  const problemId = randomItem(PROBLEMS);
  
  const payload = JSON.stringify({
    code: code,
    language: language,
    problemId: problemId,
    userId: `user_${randomIntBetween(1, 10000)}`,
  });
  
  const start = Date.now();
  const response = http.post(API_ENDPOINT, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { language: language },
  });
  const duration = Date.now() - start;
  
  submissionDuration.add(duration, { language: language });
  languageCounter.add(1, { language: language });
  
  const success = check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'has submission id': (r) => {
      try { return JSON.parse(r.body).submissionId !== undefined; }
      catch { return false; }
    },
    'response time < 5s': () => duration < 5000,
  });
  
  submissionSuccess.add(success ? 1 : 0);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  
  console.log(`
================================================================================
SUSTAINED LOAD TEST SUMMARY (100 RPS for 10 minutes)
================================================================================

Target: 100 RPS for 600 seconds = 60,000 requests

Actual Results:
  Total Requests: ${metrics.http_reqs?.values?.count || 0}
  Success Rate:   ${((metrics.submission_success?.values?.rate || 0) * 100).toFixed(2)}%
  Actual RPS:     ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)}

Response Times:
  Median:   ${(metrics.http_req_duration?.values?.med || 0).toFixed(2)}ms
  P90:      ${(metrics.http_req_duration?.values['p(90)'] || 0).toFixed(2)}ms
  P95:      ${(metrics.http_req_duration?.values['p(95)'] || 0).toFixed(2)}ms
  P99:      ${(metrics.http_req_duration?.values['p(99)'] || 0).toFixed(2)}ms

VUs Used:
  Max VUs:  ${data.state?.maxVUs || 'N/A'}

Thresholds:
  P95 < 5s:     ${(metrics.http_req_duration?.values['p(95)'] || 0) < 5000 ? '✓ PASS' : '✗ FAIL'}
  Success > 95%: ${(metrics.submission_success?.values?.rate || 0) > 0.95 ? '✓ PASS' : '✗ FAIL'}
================================================================================
`);

  return {
    'results/sustained-summary.json': JSON.stringify(data, null, 2),
  };
}

