# API Documentation

## Submit Code Endpoint

**Endpoint:** `POST /api/submit`

**Description:** Submit code for execution with validation, storage in S3, database record creation, and job queuing.

### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```typescript
{
  code: string;           // Required: Code to execute
  language: string;       // Required: Programming language
  problemId: string;      // Required: Problem identifier
  userId: string;         // Required: User identifier
  metadata?: {            // Optional: Additional metadata
    timeLimit?: number;   // Execution time limit in ms (100-30000, default: 5000)
    memoryLimit?: number; // Memory limit in KB (default: 262144 = 256MB)
    priority?: string;    // Job priority: 'low' | 'normal' | 'high' (default: 'normal')
  };
}
```

### Request Example

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "code": "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i+1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []",
    "language": "python",
    "problemId": "problem-1",
    "userId": "user-123",
    "metadata": {
      "timeLimit": 3000,
      "priority": "high"
    }
  }'
```

### Response

**Success (201 Created):**
```json
{
  "success": true,
  "message": "Code submitted successfully",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2025-12-01T12:34:56.789Z"
}
```

**Partial Success (202 Accepted):**
```json
{
  "success": true,
  "message": "Submission received but queuing delayed. Will be processed shortly.",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2025-12-01T12:34:56.789Z"
}
```

**Error Responses:**

**400 Bad Request - Missing Fields:**
```json
{
  "success": false,
  "message": "Missing required fields: code, language, problemId, or userId",
  "error": "MISSING_FIELDS"
}
```

**400 Bad Request - Invalid Types:**
```json
{
  "success": false,
  "message": "Invalid field types",
  "error": "INVALID_TYPES"
}
```

**400 Bad Request - Empty Code:**
```json
{
  "success": false,
  "message": "Code cannot be empty",
  "error": "EMPTY_CODE"
}
```

**400 Bad Request - Unsupported Language:**
```json
{
  "success": false,
  "message": "Unsupported language: cobol. Supported: javascript, typescript, python, java, cpp, c, go, rust, ruby, php",
  "error": "UNSUPPORTED_LANGUAGE"
}
```

**400 Bad Request - Invalid Time Limit:**
```json
{
  "success": false,
  "message": "Time limit must be between 100ms and 30000ms",
  "error": "INVALID_TIME_LIMIT"
}
```

**405 Method Not Allowed:**
```json
{
  "success": false,
  "message": "Method not allowed. Use POST."
}
```

**413 Payload Too Large:**
```json
{
  "success": false,
  "message": "Code size exceeds maximum allowed size of 10MB",
  "error": "CODE_TOO_LARGE"
}
```

**500 Internal Server Error - Storage:**
```json
{
  "success": false,
  "message": "Failed to store code",
  "error": "STORAGE_ERROR"
}
```

**500 Internal Server Error - Database:**
```json
{
  "success": false,
  "message": "Failed to create submission record",
  "error": "DATABASE_ERROR"
}
```

## Supported Languages

The following programming languages are currently supported:

| Language   | Extension | Identifier   |
|------------|-----------|--------------|
| JavaScript | .js       | javascript   |
| TypeScript | .ts       | typescript   |
| Python     | .py       | python       |
| Java       | .java     | java         |
| C++        | .cpp      | cpp          |
| C          | .c        | c            |
| Go         | .go       | go           |
| Rust       | .rs       | rust         |
| Ruby       | .rb       | ruby         |
| PHP        | .php      | php          |

## Validation Rules

### Code
- **Type:** String
- **Min Size:** 1 byte
- **Max Size:** 10 MB (10,485,760 bytes)
- **Encoding:** UTF-8

### Language
- **Type:** String
- **Format:** Lowercase, trimmed
- **Allowed Values:** See supported languages table

### Problem ID
- **Type:** String
- **Max Length:** 255 characters
- **Pattern:** Alphanumeric with hyphens/underscores recommended

### User ID
- **Type:** String
- **Max Length:** 255 characters
- **Pattern:** Alphanumeric recommended

### Time Limit (Optional)
- **Type:** Number
- **Min:** 100 ms
- **Max:** 30,000 ms (30 seconds)
- **Default:** 5,000 ms (5 seconds)

### Memory Limit (Optional)
- **Type:** Number
- **Unit:** KB (kilobytes)
- **Default:** 262,144 KB (256 MB)

### Priority (Optional)
- **Type:** String
- **Allowed Values:** 'low', 'normal', 'high'
- **Default:** 'normal'

## Processing Flow

1. **Request Validation**
   - Validate required fields
   - Check field types
   - Validate code size
   - Verify language support
   - Validate metadata constraints

2. **Code Storage (S3)**
   - Upload code to S3-compatible storage
   - Generate unique S3 key: `submissions/{userId}/{problemId}/{timestamp}-{uuid}.{ext}`
   - Store with metadata

3. **Database Record**
   - Insert submission record into PostgreSQL
   - Store: submission ID, user, problem, language, S3 key, size, metadata
   - Initial status: 'pending'

4. **Job Queuing (Redis)**
   - Create execution job with metadata
   - Push to Redis Stream: `code-execution-jobs`
   - Include: submission ID, user, problem, language, S3 key, limits

5. **Status Update**
   - Update submission status to 'queued'
   - Record queued timestamp

6. **Response**
   - Return submission ID immediately
   - Status: 201 Created (or 202 Accepted if queuing delayed)

## Database Schema

### Submissions Table

```sql
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  problem_id VARCHAR(255) NOT NULL,
  language programming_language NOT NULL,
  s3_key VARCHAR(512) NOT NULL,
  code_size_bytes INTEGER NOT NULL,
  status submission_status DEFAULT 'pending' NOT NULL,
  score INTEGER,
  max_score INTEGER,
  passed_test_cases INTEGER DEFAULT 0,
  total_test_cases INTEGER,
  execution_time_ms INTEGER,
  memory_used_kb INTEGER,
  error_message TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  queued_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB
);
```

### Status Enum Values

- `pending` - Submission received, not yet queued
- `queued` - Job added to execution queue
- `processing` - Currently being executed
- `completed` - Execution finished successfully
- `failed` - Execution failed with error
- `timeout` - Execution exceeded time limit

## Redis Stream Format

**Stream Key:** `code-execution-jobs`

**Message Fields:**
```
submissionId: UUID string
userId: string
problemId: string
language: string
s3Key: string
codeSizeBytes: string (number as string)
timeLimit: string (ms, number as string)
memoryLimit: string (KB, number as string)
priority: 'low' | 'normal' | 'high'
createdAt: ISO 8601 timestamp
```

**Message ID:** Auto-generated by Redis (format: `{timestamp}-{sequence}`)

## S3 Storage Structure

```
bucket: code-submissions/
├── submissions/
│   ├── {userId}/
│   │   ├── {problemId}/
│   │   │   ├── {timestamp}-{uuid}.js
│   │   │   ├── {timestamp}-{uuid}.py
│   │   │   └── ...
```

**Object Metadata:**
- `userId`: User identifier
- `problemId`: Problem identifier
- `language`: Programming language
- `submissionId`: Submission UUID
- `uploadedAt`: ISO 8601 timestamp

## Rate Limiting (Recommended)

Implement rate limiting based on:
- **Per User:** 10 submissions per minute
- **Per IP:** 20 submissions per minute
- **Global:** 1000 submissions per minute

Example with `express-rate-limit`:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many submissions. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

export default limiter;
```

## Error Codes Reference

| Code                    | HTTP Status | Description                          |
|-------------------------|-------------|--------------------------------------|
| MISSING_FIELDS          | 400         | Required field(s) not provided       |
| INVALID_TYPES           | 400         | Field type validation failed         |
| EMPTY_CODE              | 400         | Code field is empty                  |
| CODE_TOO_LARGE          | 413         | Code exceeds 10MB limit              |
| UNSUPPORTED_LANGUAGE    | 400         | Language not in supported list       |
| INVALID_PROBLEM_ID      | 400         | Problem ID invalid or too long       |
| INVALID_USER_ID         | 400         | User ID invalid or too long          |
| INVALID_TIME_LIMIT      | 400         | Time limit out of range              |
| INVALID_PRIORITY        | 400         | Priority not low/normal/high         |
| STORAGE_ERROR           | 500         | S3 upload failed                     |
| DATABASE_ERROR          | 500         | Database operation failed            |
| UNKNOWN_ERROR           | 500         | Unexpected server error              |

## Testing Examples

### JavaScript Submission

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "code": "function twoSum(nums, target) {\n  for (let i = 0; i < nums.length; i++) {\n    for (let j = i + 1; j < nums.length; j++) {\n      if (nums[i] + nums[j] === target) {\n        return [i, j];\n      }\n    }\n  }\n  return [];\n}",
    "language": "javascript",
    "problemId": "two-sum",
    "userId": "user-001"
  }'
```

### Python Submission with Metadata

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "code": "class Solution:\n    def reverseString(self, s):\n        return s[::-1]",
    "language": "python",
    "problemId": "reverse-string",
    "userId": "user-002",
    "metadata": {
      "timeLimit": 2000,
      "memoryLimit": 131072,
      "priority": "high"
    }
  }'
```

### Invalid Language Error

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "code": "print(\"Hello\")",
    "language": "cobol",
    "problemId": "test",
    "userId": "user-003"
  }'
```

## Client Integration Example (TypeScript)

```typescript
interface SubmitCodeRequest {
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

interface SubmitCodeResponse {
  success: boolean;
  message: string;
  submissionId?: string;
  timestamp?: string;
  error?: string;
}

async function submitCode(
  request: SubmitCodeRequest
): Promise<SubmitCodeResponse> {
  const response = await fetch('/api/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const data: SubmitCodeResponse = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Submission failed');
  }

  return data;
}

// Usage
try {
  const result = await submitCode({
    code: 'console.log("Hello, World!");',
    language: 'javascript',
    problemId: 'hello-world',
    userId: 'user-123',
  });

  console.log('Submission ID:', result.submissionId);
} catch (error) {
  console.error('Submission error:', error);
}
```


