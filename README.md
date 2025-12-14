# Code Execution Engine - Next.js + Monaco Editor

A scalable, production-ready code execution platform with Monaco Editor integration. Supports multiple programming languages with Docker-based sandboxing, Redis job queuing, and PostgreSQL persistence.

**Local Docker:**
```bash
./deploy.sh
```
Access at: http://localhost:3000

## Features

- **Monaco Editor**: Full-featured code editor (VS Code editor)
- **Multi-language Support**: JavaScript, Python, TypeScript
- **Quick Run**: Execute JavaScript code safely in a Web Worker with console output
- **Submit API**: POST code to `/api/submit` endpoint
- **Three-panel Layout**: File list, editor, and output panel

## Tech Stack

- **Next.js 14**: React framework for production
- **TypeScript**: Type-safe development
- **@monaco-editor/react**: React wrapper for Monaco Editor (VS Code's editor)
- **Web Workers**: Safe, sandboxed JavaScript execution

## NPM Packages Explained

1. **@monaco-editor/react** (v4.6.0)
   - React component wrapper for Monaco Editor
   - Provides VS Code-like editing experience
   - Supports syntax highlighting, IntelliSense, and multiple languages
   - Lazy loads the editor for better performance

2. **next** (v14.0.0)
   - React framework with SSR, API routes, and routing
   - Provides `/api` directory for serverless functions

3. **react** & **react-dom** (v18.2.0)
   - Core React libraries for building UI

4. **typescript** (v5.0.0)
   - Type checking and better DX

## Project Structure

```
├── pages/
│   ├── index.tsx          # Main page with layout
│   ├── _app.tsx           # Next.js app wrapper
│   └── api/
│       └── submit.ts      # POST /api/submit handler
├── components/
│   ├── Editor.tsx         # Monaco Editor wrapper
│   └── OutputPanel.tsx    # Output display with action buttons
├── package.json
├── tsconfig.json
└── next.config.js
```

## Setup & Run

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run development server:**
   ```bash
   npm run dev
   ```

3. **Open browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. **Select a file** from the left panel (or edit Problem ID)
2. **Write code** in the Monaco Editor
3. **Run (Quick)**: Execute JavaScript/TypeScript in browser (uses Web Worker)
4. **Submit**: Send code to `/api/submit` endpoint

## Quick Run (Web Worker)

- Only works for JavaScript/TypeScript
- Executes code in isolated Web Worker for safety (dedicated `worker.js` file)
- **2-second timeout protection** with automatic worker termination
- Captures `console.log`, `console.error`, `console.warn`, `console.info`
- Displays output in the right panel with formatted results
- **See `WORKER_IMPLEMENTATION.md` for detailed documentation**

### Worker Features:
- Safe execution in isolated context
- Automatic timeout (2000ms worker + 2500ms main thread)
- Console output capture with serialization
- Error handling with stack traces
- Worker termination and recreation on timeout
- Structured message protocol

## Submit API

**Endpoint:** `POST /api/submit`

**Full Implementation with PostgreSQL, Redis, and S3:**

**Request Body:**
```json
{
  "code": "console.log('Hello');",
  "language": "javascript",
  "problemId": "problem-1",
  "userId": "user-123",
  "metadata": {
    "timeLimit": 5000,
    "memoryLimit": 262144,
    "priority": "normal"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Code submitted successfully",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2025-12-01T00:00:00.000Z"
}
```

**See `API_DOCUMENTATION.md` for complete API reference.**

### Backend Architecture

1. **Validation**: Payload size, language support, field types
2. **S3 Storage**: Upload code to S3-compatible storage
3. **PostgreSQL**: Store submission metadata in database
4. **Redis Stream**: Queue execution job with S3 key
5. **Response**: Return submission ID immediately

**See `DEPLOYMENT.md` for setup instructions.**

## Production Features Implemented

**Database Integration**
- PostgreSQL with full schema
- Submission tracking and history
- Status management and timestamps

**Object Storage**
- S3-compatible storage for code files
- Automatic file organization by user/problem
- Support for AWS S3 or MinIO

**Job Queue**
- Redis Streams for distributed job processing
- Priority queue support
- Consumer groups for worker coordination

**Validation & Security**
- Request payload validation
- Code size limits (10MB max)
- Language whitelist
- Rate limiting ready

## Architecture

```
Client → API → [Validation] → S3 Upload → DB Insert → Redis Queue → Workers
                                    ↓           ↓            ↓
                                  S3 Key    Submission   Job Message
                                            Record
```
