/**
 * k6 Burst Test Only
 * 
 * Simulates 1000 submissions in 1 minute
 * 
 * Run with: k6 run loadtest/k6/burst-only.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/submit`;

// Metrics
const submissionDuration = new Trend('submission_duration', true);
const submissionSuccess = new Rate('submission_success');

// Code samples (simplified)
const CODE_SAMPLES = {
  python: `a, b = map(int, input().split())\nprint(a + b)`,
  javascript: `const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nrl.on('line', (line) => { const [a, b] = line.split(' ').map(Number); console.log(a + b); rl.close(); });`,
  cpp: `#include <iostream>\nusing namespace std;\nint main() { int a, b; cin >> a >> b; cout << a + b << endl; return 0; }`,
  java: `import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner sc = new Scanner(System.in); System.out.println(sc.nextInt() + sc.nextInt()); }}`,
  c: `#include <stdio.h>\nint main() { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }`,
};

const LANGUAGES = ['python', 'python', 'python', 'python', 'javascript', 'javascript', 'javascript', 'cpp', 'cpp', 'java'];
const PROBLEMS = ['prob_001', 'prob_002', 'prob_003', 'prob_004', 'prob_005'];

export const options = {
  scenarios: {
    burst: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 1000,
      maxDuration: '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    submission_success: ['rate>0.95'],
  },
};

export default function() {
  const language = randomItem(LANGUAGES);
  const code = CODE_SAMPLES[language];
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
  });
  const duration = Date.now() - start;
  
  submissionDuration.add(duration);
  
  const success = check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'has submission id': (r) => {
      try { return JSON.parse(r.body).submissionId !== undefined; }
      catch { return false; }
    },
  });
  
  submissionSuccess.add(success ? 1 : 0);
  
  sleep(randomIntBetween(10, 50) / 1000);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results/burst-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  const metrics = data.metrics;
  return `
================================================================================
BURST TEST SUMMARY (1000 submissions in 1 minute)
================================================================================

Submissions:
  Total:    ${metrics.iterations?.values?.count || 0}
  Success:  ${(metrics.submission_success?.values?.rate * 100 || 0).toFixed(2)}%

Response Times:
  Median:   ${(metrics.http_req_duration?.values?.med || 0).toFixed(2)}ms
  P95:      ${(metrics.http_req_duration?.values['p(95)'] || 0).toFixed(2)}ms
  P99:      ${(metrics.http_req_duration?.values['p(99)'] || 0).toFixed(2)}ms
  Max:      ${(metrics.http_req_duration?.values?.max || 0).toFixed(2)}ms

Throughput:
  Requests: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)}/s

Errors:
  Failed:   ${((1 - (metrics.http_req_failed?.values?.rate || 1)) * 100).toFixed(2)}%
================================================================================
`;
}

