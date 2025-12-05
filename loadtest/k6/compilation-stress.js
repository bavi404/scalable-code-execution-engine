/**
 * k6 Compilation Stress Test
 * 
 * Targets compiled languages (C, C++, Java, Rust, Go) with ramping load
 * 
 * Run with: k6 run loadtest/k6/compilation-stress.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/submit`;

// Metrics
const submissionDuration = new Trend('submission_duration', true);
const compilationDuration = new Trend('compilation_duration', true);
const submissionSuccess = new Rate('submission_success');
const compilationErrors = new Counter('compilation_errors');
const languageCounter = new Counter('submissions_by_language');

// Compiled language code samples (more complex to stress compilers)
const CODE_SAMPLES = {
  cpp: [
    // Simple
    {
      code: `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`,
      complexity: 'simple',
    },
    // Medium - uses STL
    {
      code: `#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> arr(n);
    for (int i = 0; i < n; i++) cin >> arr[i];
    
    sort(arr.begin(), arr.end());
    long long sum = accumulate(arr.begin(), arr.end(), 0LL);
    
    cout << "Sum: " << sum << endl;
    cout << "Min: " << arr.front() << endl;
    cout << "Max: " << arr.back() << endl;
    cout << "Median: " << arr[n/2] << endl;
    
    return 0;
}`,
      complexity: 'medium',
    },
    // Complex - templates and multiple headers
    {
      code: `#include <iostream>
#include <vector>
#include <algorithm>
#include <map>
#include <set>
#include <queue>
#include <stack>
#include <cmath>
#include <cstring>
#include <string>
using namespace std;

template<typename T>
class SegmentTree {
    vector<T> tree;
    int n;
    
    void build(const vector<T>& arr, int node, int start, int end) {
        if (start == end) {
            tree[node] = arr[start];
        } else {
            int mid = (start + end) / 2;
            build(arr, 2*node, start, mid);
            build(arr, 2*node+1, mid+1, end);
            tree[node] = tree[2*node] + tree[2*node+1];
        }
    }
    
    T query(int node, int start, int end, int l, int r) {
        if (r < start || end < l) return T();
        if (l <= start && end <= r) return tree[node];
        int mid = (start + end) / 2;
        return query(2*node, start, mid, l, r) + query(2*node+1, mid+1, end, l, r);
    }
    
public:
    SegmentTree(const vector<T>& arr) : n(arr.size()), tree(4 * arr.size()) {
        build(arr, 1, 0, n-1);
    }
    
    T query(int l, int r) {
        return query(1, 0, n-1, l, r);
    }
};

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    
    int n, q;
    cin >> n >> q;
    
    vector<long long> arr(n);
    for (int i = 0; i < n; i++) cin >> arr[i];
    
    SegmentTree<long long> st(arr);
    
    while (q--) {
        int l, r;
        cin >> l >> r;
        cout << st.query(l, r) << "\\n";
    }
    
    return 0;
}`,
      complexity: 'complex',
    },
  ],
  
  c: [
    // Simple
    {
      code: `#include <stdio.h>

int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}`,
      complexity: 'simple',
    },
    // Medium
    {
      code: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int compare(const void* a, const void* b) {
    return (*(int*)a - *(int*)b);
}

int main() {
    int n;
    scanf("%d", &n);
    
    int* arr = (int*)malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) {
        scanf("%d", &arr[i]);
    }
    
    qsort(arr, n, sizeof(int), compare);
    
    for (int i = 0; i < n; i++) {
        printf("%d ", arr[i]);
    }
    printf("\\n");
    
    free(arr);
    return 0;
}`,
      complexity: 'medium',
    },
    // Complex - data structures
    {
      code: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_N 100005

typedef struct {
    int to, next, weight;
} Edge;

Edge edges[MAX_N * 2];
int head[MAX_N], edge_cnt;
int dist[MAX_N], visited[MAX_N];

void add_edge(int u, int v, int w) {
    edges[edge_cnt].to = v;
    edges[edge_cnt].weight = w;
    edges[edge_cnt].next = head[u];
    head[u] = edge_cnt++;
}

typedef struct {
    int node, dist;
} HeapNode;

HeapNode heap[MAX_N];
int heap_size;

void heap_push(int node, int d) {
    int i = heap_size++;
    while (i > 0) {
        int parent = (i - 1) / 2;
        if (heap[parent].dist <= d) break;
        heap[i] = heap[parent];
        i = parent;
    }
    heap[i].node = node;
    heap[i].dist = d;
}

HeapNode heap_pop() {
    HeapNode result = heap[0];
    HeapNode last = heap[--heap_size];
    int i = 0;
    while (2*i + 1 < heap_size) {
        int child = 2*i + 1;
        if (child + 1 < heap_size && heap[child+1].dist < heap[child].dist)
            child++;
        if (last.dist <= heap[child].dist) break;
        heap[i] = heap[child];
        i = child;
    }
    heap[i] = last;
    return result;
}

int main() {
    int n, m, s;
    scanf("%d %d %d", &n, &m, &s);
    
    memset(head, -1, sizeof(head));
    memset(dist, 0x3f, sizeof(dist));
    
    for (int i = 0; i < m; i++) {
        int u, v, w;
        scanf("%d %d %d", &u, &v, &w);
        add_edge(u, v, w);
    }
    
    dist[s] = 0;
    heap_push(s, 0);
    
    while (heap_size > 0) {
        HeapNode cur = heap_pop();
        if (visited[cur.node]) continue;
        visited[cur.node] = 1;
        
        for (int e = head[cur.node]; e != -1; e = edges[e].next) {
            int v = edges[e].to;
            int w = edges[e].weight;
            if (dist[cur.node] + w < dist[v]) {
                dist[v] = dist[cur.node] + w;
                heap_push(v, dist[v]);
            }
        }
    }
    
    for (int i = 1; i <= n; i++) {
        printf("%d ", dist[i] == 0x3f3f3f3f ? -1 : dist[i]);
    }
    printf("\\n");
    
    return 0;
}`,
      complexity: 'complex',
    },
  ],
  
  java: [
    // Simple
    {
      code: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}`,
      complexity: 'simple',
    },
    // Medium
    {
      code: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        StringTokenizer st = new StringTokenizer(br.readLine());
        
        long[] arr = new long[n];
        for (int i = 0; i < n; i++) {
            arr[i] = Long.parseLong(st.nextToken());
        }
        
        Arrays.sort(arr);
        
        StringBuilder sb = new StringBuilder();
        for (long x : arr) {
            sb.append(x).append(" ");
        }
        System.out.println(sb.toString().trim());
    }
}`,
      complexity: 'medium',
    },
    // Complex
    {
      code: `import java.util.*;
import java.io.*;

public class Main {
    static int[] parent, rank;
    
    static int find(int x) {
        if (parent[x] != x) parent[x] = find(parent[x]);
        return parent[x];
    }
    
    static boolean union(int x, int y) {
        int px = find(x), py = find(y);
        if (px == py) return false;
        if (rank[px] < rank[py]) { int t = px; px = py; py = t; }
        parent[py] = px;
        if (rank[px] == rank[py]) rank[px]++;
        return true;
    }
    
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        
        parent = new int[n + 1];
        rank = new int[n + 1];
        for (int i = 0; i <= n; i++) parent[i] = i;
        
        int[][] edges = new int[m][3];
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            edges[i][0] = Integer.parseInt(st.nextToken());
            edges[i][1] = Integer.parseInt(st.nextToken());
            edges[i][2] = Integer.parseInt(st.nextToken());
        }
        
        Arrays.sort(edges, (a, b) -> a[2] - b[2]);
        
        long mstWeight = 0;
        int edgeCount = 0;
        
        for (int[] edge : edges) {
            if (union(edge[0], edge[1])) {
                mstWeight += edge[2];
                edgeCount++;
                if (edgeCount == n - 1) break;
            }
        }
        
        System.out.println(edgeCount == n - 1 ? mstWeight : -1);
    }
}`,
      complexity: 'complex',
    },
  ],
  
  rust: [
    // Simple
    {
      code: `use std::io::{self, BufRead};

fn main() {
    let stdin = io::stdin();
    let line = stdin.lock().lines().next().unwrap().unwrap();
    let nums: Vec<i32> = line.split_whitespace()
        .map(|x| x.parse().unwrap())
        .collect();
    println!("{}", nums[0] + nums[1]);
}`,
      complexity: 'simple',
    },
    // Medium
    {
      code: `use std::io::{self, BufRead, Write, BufWriter};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    
    let mut lines = stdin.lock().lines();
    let n: usize = lines.next().unwrap().unwrap().trim().parse().unwrap();
    
    let mut arr: Vec<i64> = lines.next().unwrap().unwrap()
        .split_whitespace()
        .map(|x| x.parse().unwrap())
        .collect();
    
    arr.sort();
    
    for x in arr {
        write!(out, "{} ", x).unwrap();
    }
    writeln!(out).unwrap();
}`,
      complexity: 'medium',
    },
  ],
  
  go: [
    // Simple
    {
      code: `package main

import "fmt"

func main() {
    var a, b int
    fmt.Scan(&a, &b)
    fmt.Println(a + b)
}`,
      complexity: 'simple',
    },
    // Medium
    {
      code: `package main

import (
    "bufio"
    "fmt"
    "os"
    "sort"
)

func main() {
    reader := bufio.NewReader(os.Stdin)
    writer := bufio.NewWriter(os.Stdout)
    defer writer.Flush()
    
    var n int
    fmt.Fscan(reader, &n)
    
    arr := make([]int, n)
    for i := 0; i < n; i++ {
        fmt.Fscan(reader, &arr[i])
    }
    
    sort.Ints(arr)
    
    for _, x := range arr {
        fmt.Fprintf(writer, "%d ", x)
    }
    fmt.Fprintln(writer)
}`,
      complexity: 'medium',
    },
  ],
};

// Weights: C++ most common, then Java, then C, then Rust/Go
const LANGUAGE_WEIGHTS = { cpp: 40, java: 25, c: 20, rust: 10, go: 5 };
const COMPLEXITY_WEIGHTS = { simple: 30, medium: 50, complex: 20 };
const PROBLEMS = ['prob_001', 'prob_002', 'prob_003', 'prob_004', 'prob_005'];

function selectLanguage() {
  const total = Object.values(LANGUAGE_WEIGHTS).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (const [lang, weight] of Object.entries(LANGUAGE_WEIGHTS)) {
    random -= weight;
    if (random <= 0) return lang;
  }
  return 'cpp';
}

function selectComplexity() {
  const total = Object.values(COMPLEXITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (const [complexity, weight] of Object.entries(COMPLEXITY_WEIGHTS)) {
    random -= weight;
    if (random <= 0) return complexity;
  }
  return 'medium';
}

export const options = {
  scenarios: {
    compilation_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 150,
      stages: [
        { duration: '30s', target: 20 },   // Warm up
        { duration: '1m', target: 40 },    // Ramp up
        { duration: '2m', target: 60 },    // Moderate stress
        { duration: '2m', target: 80 },    // High stress
        { duration: '1m', target: 100 },   // Peak stress
        { duration: '1m', target: 60 },    // Ramp down
        { duration: '30s', target: 20 },   // Cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<8000', 'p(99)<15000'],
    http_req_failed: ['rate<0.1'],
    submission_success: ['rate>0.90'],
    'submission_duration{complexity:simple}': ['p(95)<5000'],
    'submission_duration{complexity:medium}': ['p(95)<8000'],
    'submission_duration{complexity:complex}': ['p(95)<15000'],
  },
};

export default function() {
  const language = selectLanguage();
  const complexity = selectComplexity();
  
  const samples = CODE_SAMPLES[language];
  const matchingSamples = samples.filter(s => s.complexity === complexity);
  const sample = matchingSamples.length > 0 ? randomItem(matchingSamples) : randomItem(samples);
  
  const payload = JSON.stringify({
    code: sample.code,
    language: language,
    problemId: randomItem(PROBLEMS),
    userId: `user_${randomIntBetween(1, 10000)}`,
  });
  
  const start = Date.now();
  const response = http.post(API_ENDPOINT, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { language: language, complexity: sample.complexity },
  });
  const duration = Date.now() - start;
  
  submissionDuration.add(duration, { language: language, complexity: sample.complexity });
  languageCounter.add(1, { language: language });
  
  const success = check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'has submission id': (r) => {
      try { return JSON.parse(r.body).submissionId !== undefined; }
      catch { return false; }
    },
  });
  
  submissionSuccess.add(success ? 1 : 0);
  
  // Check for compilation errors
  if (response.status === 200) {
    try {
      const body = JSON.parse(response.body);
      if (body.verdict === 'CE') {
        compilationErrors.add(1, { language: language });
      }
    } catch {}
  }
}

export function handleSummary(data) {
  const metrics = data.metrics;
  
  console.log(`
================================================================================
COMPILATION STRESS TEST SUMMARY
================================================================================

Total Requests: ${metrics.http_reqs?.values?.count || 0}
Success Rate:   ${((metrics.submission_success?.values?.rate || 0) * 100).toFixed(2)}%

Response Times (All):
  Median:   ${(metrics.http_req_duration?.values?.med || 0).toFixed(2)}ms
  P95:      ${(metrics.http_req_duration?.values['p(95)'] || 0).toFixed(2)}ms
  P99:      ${(metrics.http_req_duration?.values['p(99)'] || 0).toFixed(2)}ms

Response Times by Complexity:
  Simple:   P95 = ${(metrics['submission_duration{complexity:simple}']?.values['p(95)'] || 'N/A')}ms
  Medium:   P95 = ${(metrics['submission_duration{complexity:medium}']?.values['p(95)'] || 'N/A')}ms
  Complex:  P95 = ${(metrics['submission_duration{complexity:complex}']?.values['p(95)'] || 'N/A')}ms

Compilation Errors: ${metrics.compilation_errors?.values?.count || 0}

Peak RPS: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)}
================================================================================
`);

  return {
    'results/compilation-stress-summary.json': JSON.stringify(data, null, 2),
  };
}

