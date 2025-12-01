import type { NextApiRequest, NextApiResponse } from 'next';

interface SubmitRequest {
  code: string;
  language: string;
  problemId: string;
}

interface SubmitResponse {
  success: boolean;
  message: string;
  submissionId?: string;
  timestamp?: string;
}

export default function handler(
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

  try {
    const { code, language, problemId }: SubmitRequest = req.body;

    // Validate request body
    if (!code || !language || !problemId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: code, language, or problemId',
      });
    }

    // TODO: Add your actual submission logic here
    // - Validate the code
    // - Send to execution engine
    // - Store in database
    // - Run test cases
    // - Return results

    // Mock response for now
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('Received submission:', {
      problemId,
      language,
      codeLength: code.length,
      submissionId,
    });

    return res.status(200).json({
      success: true,
      message: 'Code submitted successfully',
      submissionId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

