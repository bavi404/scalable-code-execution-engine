/**
 * S3 (AWS or MinIO) Client for storing code submissions
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

let s3Client: S3Client | null = null;

/**
 * Get or create S3 client
 */
export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
      // For MinIO or other S3-compatible services
      ...(process.env.S3_ENDPOINT && {
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true, // Required for MinIO
      }),
    });
  }

  return s3Client;
}

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'code-submissions';
const MAX_CODE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Upload code to S3
 */
export async function uploadCode(
  code: string,
  metadata: {
    userId: string;
    problemId: string;
    language: string;
    submissionId?: string;
  }
): Promise<{ s3Key: string; sizeBytes: number }> {
  const codeBuffer = Buffer.from(code, 'utf-8');
  const sizeBytes = codeBuffer.length;

  if (sizeBytes > MAX_CODE_SIZE) {
    throw new Error(`Code size exceeds maximum allowed size of ${MAX_CODE_SIZE} bytes`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().split('-')[0]; // Short UUID
  const s3Key = `submissions/${metadata.userId}/${metadata.problemId}/${timestamp}-${uniqueId}.${getFileExtension(metadata.language)}`;

  const client = getS3Client();

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: codeBuffer,
      ContentType: 'text/plain',
      Metadata: {
        userId: metadata.userId,
        problemId: metadata.problemId,
        language: metadata.language,
        submissionId: metadata.submissionId || '',
        uploadedAt: new Date().toISOString(),
      },
      // Optional: Add server-side encryption
      // ServerSideEncryption: 'AES256',
    });

    await client.send(command);

    return { s3Key, sizeBytes };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error('Failed to upload code to storage');
  }
}

/**
 * Download code from S3
 */
export async function downloadCode(s3Key: string): Promise<string> {
  const client = getS3Client();

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const response = await client.send(command);
    
    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const bodyContents = await streamToString(response.Body as any);
    return bodyContents;
  } catch (error) {
    console.error('S3 download error:', error);
    throw new Error('Failed to download code from storage');
  }
}

/**
 * Delete code object from S3
 */
export async function deleteCode(s3Key: string): Promise<void> {
  const client = getS3Client();

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await client.send(command);
  } catch (error) {
    console.error(`S3 delete error for key ${s3Key}:`, error);
    // Best-effort cleanup; do not throw to avoid masking original errors
  }
}

/**
 * Helper: Convert stream to string
 */
async function streamToString(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/**
 * Get file extension based on language
 */
function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    go: 'go',
    rust: 'rs',
    ruby: 'rb',
    php: 'php',
  };

  return extensions[language] || 'txt';
}

/**
 * Validate S3 configuration
 */
export function validateS3Config(): { valid: boolean; error?: string } {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    return { valid: false, error: 'AWS_ACCESS_KEY_ID not configured' };
  }
  if (!process.env.AWS_SECRET_ACCESS_KEY) {
    return { valid: false, error: 'AWS_SECRET_ACCESS_KEY not configured' };
  }
  return { valid: true };
}


