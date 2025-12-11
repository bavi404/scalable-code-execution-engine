/**
 * Minimal E2E harness (submit -> worker -> runner).
 * NOTE: This is a smoke test scaffold; it requires Redis, Postgres, S3/minio,
 * and the worker running locally. Adjust env vars before running.
 */

import fetch from 'node-fetch';

const SUBMIT_URL = process.env.SUBMIT_URL || 'http://localhost:3000/api/submit';
const DLQ_URL = process.env.DLQ_URL || 'http://localhost:3000/api/dlq';
const ADMIN_TOKEN = process.env.DLQ_ADMIN_TOKEN || '';

async function submit() {
  const payload = {
    code: 'console.log("ok");',
    language: 'javascript',
    problemId: 'e2e-problem',
    userId: 'e2e-user',
    metadata: {
      timeLimit: 2000,
      testCases: [
        { id: 't1', input: '', expectedOutput: 'ok' },
      ],
    },
  };

  const res = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Submit failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.submissionId as string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkDlq() {
  const res = await fetch(DLQ_URL, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  if (!res.ok) return [];
  const json: any = await res.json();
  return json.entries || [];
}

describe('e2e smoke', () => {
  it('runs JS submission with test cases and does not hit DLQ', async () => {
    if (!ADMIN_TOKEN) {
      console.warn('Skipping DLQ check because DLQ_ADMIN_TOKEN is not set');
    }

    const submissionId = await submit();

    // Wait for worker to process
    await sleep(5000);

    // Best-effort DLQ check
    if (ADMIN_TOKEN) {
      const dlq = await checkDlq();
      const hit = dlq.find((d: any) => d.submissionId === submissionId);
      expect(hit).toBeUndefined();
    }
  }, 20000);
});




