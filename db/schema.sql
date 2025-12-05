-- Database Schema for Code Execution Engine

-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for submission status
CREATE TYPE submission_status AS ENUM (
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'timeout'
);

-- Create enum for supported languages
CREATE TYPE programming_language AS ENUM (
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
  'c',
  'go',
  'rust',
  'ruby',
  'php'
);

-- Submissions table
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- User and problem information
  user_id VARCHAR(255) NOT NULL,
  problem_id VARCHAR(255) NOT NULL,
  
  -- Code metadata
  language programming_language NOT NULL,
  s3_key VARCHAR(512) NOT NULL,  -- S3 object key where code is stored
  code_size_bytes INTEGER NOT NULL,
  
  -- Submission status
  status submission_status DEFAULT 'pending' NOT NULL,
  
  -- Execution results (populated after execution)
  score INTEGER,
  max_score INTEGER,
  passed_test_cases INTEGER DEFAULT 0,
  total_test_cases INTEGER,
  execution_time_ms INTEGER,
  memory_used_kb INTEGER,
  error_message TEXT,
  
  -- Timestamps
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  queued_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Additional metadata
  metadata JSONB,
  
  -- Indexes for faster queries
  CONSTRAINT submissions_score_check CHECK (score >= 0),
  CONSTRAINT submissions_code_size_check CHECK (code_size_bytes > 0 AND code_size_bytes <= 10485760) -- Max 10MB
);

-- Indexes for common queries
CREATE INDEX idx_submissions_user_id ON submissions(user_id);
CREATE INDEX idx_submissions_problem_id ON submissions(problem_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_submitted_at ON submissions(submitted_at DESC);
CREATE INDEX idx_submissions_user_problem ON submissions(user_id, problem_id, submitted_at DESC);
CREATE INDEX idx_submissions_status_queued ON submissions(status, queued_at) WHERE status = 'queued';

-- Create a view for submission summaries
CREATE VIEW submission_summary AS
SELECT 
  id,
  user_id,
  problem_id,
  language,
  status,
  score,
  max_score,
  passed_test_cases,
  total_test_cases,
  execution_time_ms,
  memory_used_kb,
  submitted_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - submitted_at)) as total_time_seconds
FROM submissions;

-- Problems table (optional, for reference)
CREATE TABLE problems (
  id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  description TEXT NOT NULL,
  difficulty VARCHAR(50) NOT NULL,
  max_score INTEGER DEFAULT 100,
  time_limit_ms INTEGER DEFAULT 5000,
  memory_limit_kb INTEGER DEFAULT 262144, -- 256MB
  test_cases_count INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_problems_difficulty ON problems(difficulty);

-- Users table (optional, for reference)
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- Add foreign key constraints (optional, based on your needs)
-- ALTER TABLE submissions ADD CONSTRAINT fk_submissions_problem 
--   FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE;
-- ALTER TABLE submissions ADD CONSTRAINT fk_submissions_user 
--   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for problems table
CREATE TRIGGER update_problems_updated_at 
  BEFORE UPDATE ON problems 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for users table
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Sample data for testing (optional)
-- INSERT INTO problems (id, title, description, difficulty, test_cases_count) VALUES
--   ('problem-1', 'Two Sum', 'Find two numbers that add up to target', 'easy', 10),
--   ('problem-2', 'Reverse String', 'Reverse a given string', 'easy', 8),
--   ('problem-3', 'Binary Search', 'Implement binary search algorithm', 'medium', 15);

-- INSERT INTO users (id, username, email) VALUES
--   ('user-1', 'testuser', 'test@example.com');

COMMENT ON TABLE submissions IS 'Stores all code submissions with metadata and execution results';
COMMENT ON COLUMN submissions.s3_key IS 'S3 object key where the actual code is stored';
COMMENT ON COLUMN submissions.code_size_bytes IS 'Size of the submitted code in bytes';
COMMENT ON COLUMN submissions.metadata IS 'Additional metadata in JSON format (e.g., IP address, user agent)';


