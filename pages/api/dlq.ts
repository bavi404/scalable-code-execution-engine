import type { NextApiRequest, NextApiResponse } from 'next';
import { getRedisClient } from '../../lib/redis';

interface DlqEntry {
  id: string;
  submissionId: string;
  userId: string;
  problemId: string;
  language: string;
  reason: string;
  attempts: number;
  createdAt: string;
}

const ADMIN_TOKEN = process.env.DLQ_ADMIN_TOKEN || '';
const DLQ_KEY = `${process.env.REDIS_STREAM_KEY || 'code-execution-jobs'}:dlq`;
const ALLOWED_IPS = (process.env.DLQ_ALLOW_IPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; entries?: DlqEntry[]; message?: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  if (!ADMIN_TOKEN) {
    return res.status(503).json({ success: false, message: 'DLQ admin token not configured' });
  }

  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (ALLOWED_IPS.length > 0) {
    const ipHeader = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = Array.isArray(ipHeader) ? ipHeader[0] : (ipHeader as string).split(',')[0].trim();
    const allowed = ALLOWED_IPS.includes(clientIp);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'IP not allowed' });
    }
  }

  const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);

  try {
    const client = await getRedisClient();
    const entries = await client.xRange(DLQ_KEY, '-', '+', { COUNT: limit });

    const parsed: DlqEntry[] = entries.map((entry) => {
      const msg: any = entry.message;
      return {
        id: entry.id,
        submissionId: msg.submissionId,
        userId: msg.userId,
        problemId: msg.problemId,
        language: msg.language,
        reason: msg.reason,
        attempts: parseInt(msg.attempts || '1'),
        createdAt: msg.createdAt,
      };
    });

    return res.status(200).json({ success: true, entries: parsed });
  } catch (error: any) {
    console.error('DLQ fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch DLQ' });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

