/**
 * Code Execution Judge Module (Node.js/TypeScript)
 * 
 * Reads harness output JSON, applies comparison rules,
 * assigns verdicts, and produces final score.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

// Verdict codes
export enum Verdict {
  AC = 'AC',   // Accepted
  WA = 'WA',   // Wrong Answer
  TLE = 'TLE', // Time Limit Exceeded
  MLE = 'MLE', // Memory Limit Exceeded
  RE = 'RE',   // Runtime Error
  CE = 'CE',   // Compilation Error
  IE = 'IE',   // Internal Error
  PE = 'PE',   // Presentation Error
  SK = 'SK',   // Skipped
}

// Interfaces
export interface TestCaseVerdict {
  testId: string;
  verdict: string;
  score: number;
  maxScore: number;
  executionTimeMs: number;
  memoryUsedKb: number;
  message?: string;
  expectedOutput?: string;
  actualOutput?: string;
  inputPreview?: string;
}

export interface JudgeResult {
  finalVerdict: string;
  totalScore: number;
  maxScore: number;
  scorePercentage: number;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  totalTimeMs: number;
  maxMemoryKb: number;
  testVerdicts: TestCaseVerdict[];
  compilationStatus?: string;
  compilationMessage?: string;
  judgeMessage?: string;
}

export interface ProblemConfig {
  timeLimitMs: number;
  memoryLimitKb: number;
  comparisonMode: 'exact' | 'token' | 'float' | 'special';
  floatTolerance: number;
  specialJudgePath?: string;
  caseSensitive: boolean;
  ignoreTrailingWhitespace: boolean;
  ignoreTrailingNewlines: boolean;
  partialScoring: boolean;
  testWeights: Record<string, number>;
}

export interface TestResult {
  testId?: string;
  test_id?: string;
  status?: string;
  actualOutput?: string;
  actual_output?: string;
  expectedOutput?: string;
  expected_output?: string;
  executionTimeMs?: number;
  execution_time_ms?: number;
  memoryUsedKb?: number;
  memory_used_kb?: number;
  input?: string;
  error?: string;
  timedOut?: boolean;
}

export interface HarnessOutput {
  success?: boolean;
  testResults?: TestResult[];
  test_results?: TestResult[];
  compileResult?: {
    success: boolean;
    skipped?: boolean;
    stderr?: string;
    error?: string;
  };
  compile_result?: {
    success: boolean;
    skipped?: boolean;
    stderr?: string;
    error?: string;
  };
  stdout?: string;
  output?: string;
  status?: string;
  executionTimeMs?: number;
  execution_time_ms?: number;
  memoryUsedKb?: number;
  memory_used_kb?: number;
}

// Default config
const defaultConfig: ProblemConfig = {
  timeLimitMs: 5000,
  memoryLimitKb: 262144,
  comparisonMode: 'exact',
  floatTolerance: 1e-6,
  caseSensitive: true,
  ignoreTrailingWhitespace: true,
  ignoreTrailingNewlines: true,
  partialScoring: true,
  testWeights: {},
};

/**
 * Comparator utilities
 */
class Comparator {
  static normalize(text: string | null | undefined, config: ProblemConfig): string {
    if (!text) return '';
    
    let result = text;
    
    // Handle trailing whitespace per line
    if (config.ignoreTrailingWhitespace) {
      result = result.split('\n').map(line => line.trimEnd()).join('\n');
    }
    
    // Handle trailing newlines
    if (config.ignoreTrailingNewlines) {
      result = result.replace(/\n+$/, '');
    }
    
    // Handle case sensitivity
    if (!config.caseSensitive) {
      result = result.toLowerCase();
    }
    
    return result;
  }
  
  static exactMatch(expected: string, actual: string, config: ProblemConfig): { passed: boolean; message: string } {
    const normExpected = this.normalize(expected, config);
    const normActual = this.normalize(actual, config);
    
    if (normExpected === normActual) {
      return { passed: true, message: 'Output matches expected' };
    }
    
    const expLines = normExpected.split('\n');
    const actLines = normActual.split('\n');
    
    if (expLines.length !== actLines.length) {
      return { 
        passed: false, 
        message: `Line count mismatch: expected ${expLines.length}, got ${actLines.length}` 
      };
    }
    
    for (let i = 0; i < expLines.length; i++) {
      if (expLines[i] !== actLines[i]) {
        return { passed: false, message: `Difference at line ${i + 1}` };
      }
    }
    
    return { passed: false, message: 'Output differs from expected' };
  }
  
  static tokenMatch(expected: string, actual: string, config: ProblemConfig): { passed: boolean; message: string } {
    let expTokens = expected.split(/\s+/).filter(t => t);
    let actTokens = actual.split(/\s+/).filter(t => t);
    
    if (!config.caseSensitive) {
      expTokens = expTokens.map(t => t.toLowerCase());
      actTokens = actTokens.map(t => t.toLowerCase());
    }
    
    if (expTokens.length !== actTokens.length) {
      return {
        passed: false,
        message: `Token count mismatch: expected ${expTokens.length}, got ${actTokens.length}`
      };
    }
    
    for (let i = 0; i < expTokens.length; i++) {
      if (expTokens[i] !== actTokens[i]) {
        return {
          passed: false,
          message: `Token mismatch at position ${i + 1}: expected '${expTokens[i]}', got '${actTokens[i]}'`
        };
      }
    }
    
    return { passed: true, message: 'All tokens match' };
  }
  
  static floatMatch(expected: string, actual: string, config: ProblemConfig): { passed: boolean; message: string } {
    const expValues = expected.split(/\s+/).filter(t => t).map(parseFloat);
    const actValues = actual.split(/\s+/).filter(t => t).map(parseFloat);
    
    if (expValues.some(isNaN)) {
      return { passed: false, message: 'Expected output contains non-numeric values' };
    }
    
    if (actValues.some(isNaN)) {
      return { passed: false, message: 'Output contains non-numeric values' };
    }
    
    if (expValues.length !== actValues.length) {
      return {
        passed: false,
        message: `Value count mismatch: expected ${expValues.length}, got ${actValues.length}`
      };
    }
    
    const tolerance = config.floatTolerance;
    
    for (let i = 0; i < expValues.length; i++) {
      const exp = expValues[i];
      const act = actValues[i];
      const diff = Math.abs(exp - act);
      
      if (diff > tolerance && diff > tolerance * Math.abs(exp)) {
        return {
          passed: false,
          message: `Value mismatch at position ${i + 1}: expected ${exp}, got ${act}`
        };
      }
    }
    
    return { passed: true, message: 'All values within tolerance' };
  }
}

/**
 * Special Judge Runner
 */
class SpecialJudge {
  constructor(private judgePath: string) {
    if (!fs.existsSync(judgePath)) {
      throw new Error(`Special judge not found: ${judgePath}`);
    }
  }
  
  run(
    inputData: string,
    expectedOutput: string,
    actualOutput: string,
    testId: string = ''
  ): { passed: boolean; score: number; message: string } {
    // Create temp files
    const tmpDir = fs.mkdtempSync('/tmp/judge-');
    const inputPath = path.join(tmpDir, 'input.txt');
    const expectedPath = path.join(tmpDir, 'expected.txt');
    const actualPath = path.join(tmpDir, 'actual.txt');
    
    try {
      fs.writeFileSync(inputPath, inputData);
      fs.writeFileSync(expectedPath, expectedOutput);
      fs.writeFileSync(actualPath, actualOutput);
      
      // Run special judge
      const result = execSync(
        `"${this.judgePath}" "${inputPath}" "${expectedPath}" "${actualPath}" "${testId}"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      
      // Parse result
      try {
        const output = JSON.parse(result.trim());
        const passed = output.verdict === 'AC' || output.passed === true;
        const score = parseFloat(output.score) || (passed ? 1.0 : 0.0);
        const message = output.message || '';
        return { passed, score, message };
      } catch {
        // Fallback: simple output
        const stdout = result.trim();
        if (['1', 'AC', 'ACCEPTED', 'true'].includes(stdout)) {
          return { passed: true, score: 1.0, message: 'Accepted by special judge' };
        } else if (['0', 'WA', 'WRONG', 'false'].includes(stdout)) {
          return { passed: false, score: 0.0, message: 'Rejected by special judge' };
        }
        const score = parseFloat(stdout);
        if (!isNaN(score)) {
          return { passed: score > 0, score, message: `Score: ${score}` };
        }
        return { passed: false, score: 0.0, message: `Unknown output: ${stdout}` };
      }
    } catch (error: any) {
      return { passed: false, score: 0.0, message: `Special judge error: ${error.message}` };
    } finally {
      // Cleanup
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {}
    }
  }
}

/**
 * Main Judge Class
 */
export class Judge {
  private config: ProblemConfig;
  private specialJudge?: SpecialJudge;
  
  constructor(config?: Partial<ProblemConfig>) {
    this.config = { ...defaultConfig, ...config };
    
    if (this.config.specialJudgePath) {
      this.specialJudge = new SpecialJudge(this.config.specialJudgePath);
    }
  }
  
  judgeTestCase(
    testResult: TestResult,
    expectedOutput?: string
  ): TestCaseVerdict {
    const testId = testResult.testId || testResult.test_id || 'unknown';
    const status = testResult.status || '';
    const actualOutput = testResult.actualOutput || testResult.actual_output || '';
    const execTime = testResult.executionTimeMs || testResult.execution_time_ms || 0;
    const memoryKb = testResult.memoryUsedKb || testResult.memory_used_kb || 0;
    const inputData = testResult.input || '';
    
    // Use provided expected or from test result
    const expected = expectedOutput ?? testResult.expectedOutput ?? testResult.expected_output ?? '';
    
    // Get test weight
    const weight = this.config.testWeights[testId] ?? 1.0;
    
    // Check for execution errors first
    if (status === 'timeout' || testResult.timedOut) {
      return {
        testId,
        verdict: Verdict.TLE,
        score: 0,
        maxScore: weight,
        executionTimeMs: execTime,
        memoryUsedKb: memoryKb,
        message: `Time limit exceeded (${execTime}ms)`,
        inputPreview: inputData.slice(0, 100),
      };
    }
    
    if (status === 'memory_limit') {
      return {
        testId,
        verdict: Verdict.MLE,
        score: 0,
        maxScore: weight,
        executionTimeMs: execTime,
        memoryUsedKb: memoryKb,
        message: `Memory limit exceeded (${memoryKb}KB)`,
        inputPreview: inputData.slice(0, 100),
      };
    }
    
    if (status === 'runtime_error') {
      return {
        testId,
        verdict: Verdict.RE,
        score: 0,
        maxScore: weight,
        executionTimeMs: execTime,
        memoryUsedKb: memoryKb,
        message: testResult.error || 'Runtime error',
        inputPreview: inputData.slice(0, 100),
      };
    }
    
    // Compare outputs
    let passed = false;
    let message = '';
    let score = 0;
    
    if (this.specialJudge && this.config.comparisonMode === 'special') {
      const result = this.specialJudge.run(inputData, expected, actualOutput, testId);
      passed = result.passed;
      score = result.score * weight;
      message = result.message;
    } else {
      let compResult: { passed: boolean; message: string };
      
      switch (this.config.comparisonMode) {
        case 'token':
          compResult = Comparator.tokenMatch(expected, actualOutput, this.config);
          break;
        case 'float':
          compResult = Comparator.floatMatch(expected, actualOutput, this.config);
          break;
        default:
          compResult = Comparator.exactMatch(expected, actualOutput, this.config);
      }
      
      passed = compResult.passed;
      message = compResult.message;
      score = passed ? weight : 0;
    }
    
    return {
      testId,
      verdict: passed ? Verdict.AC : Verdict.WA,
      score,
      maxScore: weight,
      executionTimeMs: execTime,
      memoryUsedKb: memoryKb,
      message,
      expectedOutput: expected.slice(0, 500),
      actualOutput: actualOutput.slice(0, 500),
      inputPreview: inputData.slice(0, 100),
    };
  }
  
  judgeSubmission(
    harnessOutput: HarnessOutput,
    expectedOutputs?: Record<string, string>
  ): JudgeResult {
    // Check compilation status
    const compileResult = harnessOutput.compileResult || harnessOutput.compile_result;
    if (compileResult && !compileResult.success && !compileResult.skipped) {
      return {
        finalVerdict: Verdict.CE,
        totalScore: 0,
        maxScore: 0,
        scorePercentage: 0,
        passedCount: 0,
        failedCount: 0,
        totalCount: 0,
        totalTimeMs: 0,
        maxMemoryKb: 0,
        testVerdicts: [],
        compilationStatus: 'failed',
        compilationMessage: compileResult.stderr || compileResult.error || 'Compilation failed',
      };
    }
    
    // Get test results
    let testResults = harnessOutput.testResults || harnessOutput.test_results || [];
    
    // If no test results, check for single execution result
    if (testResults.length === 0 && (harnessOutput.stdout || harnessOutput.output)) {
      testResults = [{
        testId: 'test-1',
        status: harnessOutput.status || 'success',
        actualOutput: harnessOutput.stdout || harnessOutput.output || '',
        expectedOutput: expectedOutputs?.['test-1'] || '',
        executionTimeMs: harnessOutput.executionTimeMs || harnessOutput.execution_time_ms || 0,
        memoryUsedKb: harnessOutput.memoryUsedKb || harnessOutput.memory_used_kb || 0,
      }];
    }
    
    // Judge each test case
    const verdicts: TestCaseVerdict[] = [];
    
    for (const testResult of testResults) {
      const testId = testResult.testId || testResult.test_id || `test-${verdicts.length + 1}`;
      const expected = expectedOutputs?.[testId];
      verdicts.push(this.judgeTestCase(testResult, expected));
    }
    
    // Aggregate results
    const totalScore = verdicts.reduce((sum, v) => sum + v.score, 0);
    const maxScore = verdicts.reduce((sum, v) => sum + v.maxScore, 0);
    const passedCount = verdicts.filter(v => v.verdict === Verdict.AC).length;
    const failedCount = verdicts.length - passedCount;
    const totalTime = verdicts.reduce((sum, v) => sum + v.executionTimeMs, 0);
    const maxMemory = Math.max(...verdicts.map(v => v.memoryUsedKb), 0);
    
    // Determine final verdict
    let finalVerdict: Verdict;
    
    if (verdicts.every(v => v.verdict === Verdict.AC)) {
      finalVerdict = Verdict.AC;
    } else if (verdicts.some(v => v.verdict === Verdict.TLE)) {
      finalVerdict = Verdict.TLE;
    } else if (verdicts.some(v => v.verdict === Verdict.MLE)) {
      finalVerdict = Verdict.MLE;
    } else if (verdicts.some(v => v.verdict === Verdict.RE)) {
      finalVerdict = Verdict.RE;
    } else {
      finalVerdict = Verdict.WA;
    }
    
    const scorePercentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    
    return {
      finalVerdict,
      totalScore: Math.round(totalScore * 100) / 100,
      maxScore: Math.round(maxScore * 100) / 100,
      scorePercentage: Math.round(scorePercentage * 100) / 100,
      passedCount,
      failedCount,
      totalCount: verdicts.length,
      totalTimeMs: totalTime,
      maxMemoryKb: maxMemory,
      testVerdicts: verdicts,
      compilationStatus: compileResult ? 'success' : undefined,
    };
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: ts-node judge.ts <harness_output.json> [--expected <file>] [--special-judge <path>]');
    process.exit(1);
  }
  
  const harnessFile = args[0];
  const harnessOutput: HarnessOutput = JSON.parse(fs.readFileSync(harnessFile, 'utf-8'));
  
  // Parse options
  let expectedOutputs: Record<string, string> | undefined;
  let specialJudgePath: string | undefined;
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--expected' && args[i + 1]) {
      const data = JSON.parse(fs.readFileSync(args[i + 1], 'utf-8'));
      if (Array.isArray(data)) {
        expectedOutputs = {};
        data.forEach((tc, idx) => {
          const id = tc.id || tc.test_id || `test-${idx + 1}`;
          expectedOutputs![id] = tc.expected_output || tc.expectedOutput || '';
        });
      } else {
        expectedOutputs = data;
      }
      i++;
    } else if (args[i] === '--special-judge' && args[i + 1]) {
      specialJudgePath = args[i + 1];
      i++;
    }
  }
  
  const config: Partial<ProblemConfig> = {};
  if (specialJudgePath) {
    config.specialJudgePath = specialJudgePath;
    config.comparisonMode = 'special';
  }
  
  const judge = new Judge(config);
  const result = judge.judgeSubmission(harnessOutput, expectedOutputs);
  
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.finalVerdict === Verdict.AC ? 0 : 1);
}

export default Judge;

