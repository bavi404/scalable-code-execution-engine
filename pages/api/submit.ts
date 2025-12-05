import type { NextApiRequest, NextApiResponse } from 'next';
import { submissionDb } from '../../lib/db';
import { uploadCode } from '../../lib/s3';
import { pushJob, ExecutionJob } from '../../lib/redis';

// Supported languages
const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
  'c',
  'go',
  'rust',
  'ruby',
  'php',
];

// Payload limits
const MAX_CODE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PROBLEM_ID_LENGTH = 255;
const MAX_USER_ID_LENGTH = 255;

interface SubmitRequest {
  code: string;
  language: string;
  problemId: string;
  userId: string;
  metadata?: {
    timeLimit?: number;
    memoryLimit?: number;
    priority?: 'low' | 'normal' | 'high';
  };
}

interface SubmitResponse {
  success: boolean;
  message: string;
  submissionId?: string;
  timestamp?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SubmitResponse>
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed. Use POST.',
    });
  }

  const startTime = Date.now();

  try {
    const { code, language, problemId, userId, metadata }: SubmitRequest = req.body;

    // ===== VALIDATION =====

    // 1. Check required fields
    if (!code || !language || !problemId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: code, language, problemId, or userId',
        error: 'MISSING_FIELDS',
      });
    }

    // 2. Validate types
    if (typeof code !== 'string' || typeof language !== 'string' || 
        typeof problemId !== 'string' || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid field types',
        error: 'INVALID_TYPES',
      });
    }

    // 3. Validate code size
    const codeSize = Buffer.from(code, 'utf-8').length;
    if (codeSize > MAX_CODE_SIZE) {
      return res.status(413).json({
        success: false,
        message: `Code size exceeds maximum allowed size of ${MAX_CODE_SIZE / 1024 / 1024}MB`,
        error: 'CODE_TOO_LARGE',
      });
    }

    if (codeSize === 0) {
      return res.status(400).json({
        success: false,
        message: 'Code cannot be empty',
        error: 'EMPTY_CODE',
      });
    }

    // 4. Validate language
    const normalizedLanguage = language.toLowerCase().trim();
    if (!SUPPORTED_LANGUAGES.includes(normalizedLanguage)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported language: ${language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
        error: 'UNSUPPORTED_LANGUAGE',
      });
    }

    // 5. Validate ID lengths
    if (problemId.length > MAX_PROBLEM_ID_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Problem ID too long (max ${MAX_PROBLEM_ID_LENGTH} characters)`,
        error: 'INVALID_PROBLEM_ID',
      });
    }

    if (userId.length > MAX_USER_ID_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `User ID too long (max ${MAX_USER_ID_LENGTH} characters)`,
        error: 'INVALID_USER_ID',
      });
    }

    // 6. Validate metadata (optional)
    const timeLimit = metadata?.timeLimit || 5000; // Default 5 seconds
    const memoryLimit = metadata?.memoryLimit || 262144; // Default 256MB
    const priority = metadata?.priority || 'normal';

    if (timeLimit < 100 || timeLimit > 30000) {
      return res.status(400).json({
        success: false,
        message: 'Time limit must be between 100ms and 30000ms',
        error: 'INVALID_TIME_LIMIT',
      });
    }

    if (!['low', 'normal', 'high'].includes(priority)) {
      return res.status(400).json({
        success: false,
        message: 'Priority must be low, normal, or high',
        error: 'INVALID_PRIORITY',
      });
    }

    // ===== PROCESSING =====

    // 1. Upload code to S3
    let s3Key: string;
    let submissionId: string | undefined;

    try {
      const uploadResult = await uploadCode(code, {
        userId,
        problemId,
        language: normalizedLanguage,
      });
      s3Key = uploadResult.s3Key;
    } catch (error: any) {
      console.error('S3 upload failed:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to store code',
        error: 'STORAGE_ERROR',
      });
    }

    // 2. Create submission record in database
    try {
      const submission = await submissionDb.create({
        userId,
        problemId,
        language: normalizedLanguage,
        s3Key,
        codeSizeBytes: codeSize,
        metadata: {
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          timeLimit,
          memoryLimit,
          priority,
        },
      });

      submissionId = submission.id;
    } catch (error: any) {
      console.error('Database insert failed:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create submission record',
        error: 'DATABASE_ERROR',
      });
    }

    // 3. Push job to Redis Stream
    try {
      const job: ExecutionJob = {
        submissionId: submissionId!,
        userId,
        problemId,
        language: normalizedLanguage,
        s3Key,
        codeSizeBytes: codeSize,
        timeLimit,
        memoryLimit,
        priority,
        createdAt: new Date().toISOString(),
      };

      const jobId = await pushJob(job);

      // Update submission status to queued
      await submissionDb.updateStatus(submissionId!, 'queued');

      console.log('Submission queued:', {
        submissionId,
        jobId,
        userId,
        problemId,
        language: normalizedLanguage,
        codeSize,
        processingTime: Date.now() - startTime,
      });
    } catch (error: any) {
      console.error('Redis queue failed:', error);
      
      // Job queuing failed, but submission is recorded
      // Workers can pick it up later from database
      return res.status(202).json({
        success: true,
        message: 'Submission received but queuing delayed. Will be processed shortly.',
        submissionId: submissionId!,
        timestamp: new Date().toISOString(),
      });
    }

    // ===== SUCCESS RESPONSE =====
    return res.status(201).json({
      success: true,
      message: 'Code submitted successfully',
      submissionId: submissionId!,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message || 'UNKNOWN_ERROR',
    });
  }
}

/**
 * Increase payload size limit for code submissions
 */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

