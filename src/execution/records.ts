import fs from "node:fs";
import path from "node:path";
import { getWorkspaceStateDirectory } from "../config/paths.js";

export interface ExecutionRecord {
  id: string;
  timestamp: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed";
  commands: Array<{
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timestamp: string;
  }>;
  testResults?: {
    passed: boolean;
    total: number;
    failed: number;
    output: string;
  };
  summary: string;
}

export class ExecutionRecorder {
  private stateDir: string;
  private currentRecord: ExecutionRecord | null = null;

  constructor(workspaceRoot: string) {
    this.stateDir = getWorkspaceStateDirectory(workspaceRoot);
  }

  startExecution(task: string): ExecutionRecord {
    const record: ExecutionRecord = {
      id: Buffer.from(`${Date.now()}-${Math.random()}`).toString("hex").slice(0, 12),
      timestamp: new Date().toISOString(),
      task,
      status: "running",
      commands: [],
      summary: `Execution started for task: ${task}`,
    };
    this.currentRecord = record;
    this.saveRecord(record);
    return record;
  }

  recordCommand(command: string, exitCode: number | null, stdout: string, stderr: string) {
    if (!this.currentRecord) {
      this.startExecution("Unnamed task");
    }
    this.currentRecord!.commands.push({
      command,
      exitCode,
      stdout: stdout.slice(-5000), // Keep last 5000 chars
      stderr: stderr.slice(-5000),
      timestamp: new Date().toISOString(),
    });
    this.saveRecord(this.currentRecord!);
  }

  recordTestResult(passed: boolean, total: number, failed: number, output: string) {
    if (!this.currentRecord) {
      this.startExecution("Test run");
    }
    this.currentRecord!.testResults = {
      passed,
      total,
      failed,
      output: output.slice(-5000),
    };
    this.saveRecord(this.currentRecord!);
  }

  completeExecution(summary: string, status: "completed" | "failed" = "completed") {
    if (this.currentRecord) {
      this.currentRecord.status = status;
      this.currentRecord.summary = summary;
      this.saveRecord(this.currentRecord);
    }
  }

  getLatestRecord(): ExecutionRecord | null {
    if (this.currentRecord) return this.currentRecord;
    const recordsFile = path.join(this.stateDir, "latest_execution.json");
    if (fs.existsSync(recordsFile)) {
      try {
        return JSON.parse(fs.readFileSync(recordsFile, "utf-8"));
      } catch {
        return null;
      }
    }
    return null;
  }

  private saveRecord(record: ExecutionRecord) {
    const recordsFile = path.join(this.stateDir, "latest_execution.json");
    try {
      fs.writeFileSync(recordsFile, JSON.stringify(record, null, 2), "utf-8");
    } catch {
      // ignore write error
    }
  }
}
