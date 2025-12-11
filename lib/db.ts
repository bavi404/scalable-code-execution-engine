/**
 * PostgreSQL Database Client
 * Singleton pattern for connection pooling
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | null = null;

/**
 * Get or create database connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'code_execution',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });
  }

  return pool;
}

/**
 * Execute a query
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      console.warn('Slow query detected:', { text, duration, rows: result.rowCount });
    }
    
    return result;
  } catch (error) {
    console.error('Database query error:', { text, error });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return await pool.connect();
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Submission database operations
 */
export const submissionDb = {
  /**
   * Create a new submission record
   */
  async create(data: {
    userId: string;
    problemId: string;
    language: string;
    s3Key: string;
    codeSizeBytes: number;
    metadata?: object;
  }) {
    const result = await query<{ id: string }>(
      `INSERT INTO submissions (user_id, problem_id, language, s3_key, code_size_bytes, metadata, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        data.userId,
        data.problemId,
        data.language,
        data.s3Key,
        data.codeSizeBytes,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );

    return result.rows[0];
  },

  /**
   * Update submission status
   */
  async updateStatus(id: string, status: string, additionalData?: object) {
    const updates: string[] = ['status = $2'];
    const params: any[] = [id, status];
    let paramIndex = 3;

    // Update timestamp based on status
    if (status === 'queued') {
      updates.push(`queued_at = CURRENT_TIMESTAMP`);
    } else if (status === 'processing') {
      updates.push(`started_at = CURRENT_TIMESTAMP`);
    } else if (['completed', 'failed', 'timeout'].includes(status)) {
      updates.push(`completed_at = CURRENT_TIMESTAMP`);
    }

    // Add additional data if provided
    if (additionalData) {
      for (const [key, value] of Object.entries(additionalData)) {
        updates.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    const query_text = `UPDATE submissions SET ${updates.join(', ')} WHERE id = $1`;
    
    await query(query_text, params);
  },

  /**
   * Get submission by ID
   */
  async getById(id: string) {
    const result = await query(
      'SELECT * FROM submissions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  },

  /**
   * Get user submissions for a problem
   */
  async getUserSubmissions(userId: string, problemId?: string, limit = 50) {
    const params: any[] = [userId];
    let query_text = `
      SELECT id, problem_id, language, status, score, max_score, 
             passed_test_cases, total_test_cases, submitted_at, completed_at
      FROM submissions 
      WHERE user_id = $1
    `;

    if (problemId) {
      query_text += ' AND problem_id = $2';
      params.push(problemId);
      query_text += ' ORDER BY submitted_at DESC LIMIT $3';
      params.push(limit);
    } else {
      query_text += ' ORDER BY submitted_at DESC LIMIT $2';
      params.push(limit);
    }

    const result = await query(query_text, params);
    return result.rows;
  },
};


