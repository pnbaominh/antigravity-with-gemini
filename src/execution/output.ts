import { ExecutionRecorder, type ExecutionRecord } from "./records.js";

export function getExecutionSummary(workspaceRoot: string): string {
  const recorder = new ExecutionRecorder(workspaceRoot);
  const record = recorder.getLatestRecord();

  if (!record) {
    return "No execution records found in current workspace.";
  }

  const lines: string[] = [
    `# Execution Summary (${record.id})`,
    `- Status: ${record.status.toUpperCase()}`,
    `- Timestamp: ${record.timestamp}`,
    `- Task: ${record.task}`,
    `- Summary: ${record.summary}`,
    `- Total Commands Executed: ${record.commands.length}`,
  ];

  if (record.testResults) {
    lines.push(
      `- Test Results: ${record.testResults.passed ? "PASSED" : "FAILED"} (${record.testResults.failed} failed / ${record.testResults.total} total)`
    );
  }

  return lines.join("\n");
}

export function getExecutionOutput(workspaceRoot: string, commandIndex?: number): string {
  const recorder = new ExecutionRecorder(workspaceRoot);
  const record = recorder.getLatestRecord();

  if (!record) {
    return "No execution output recorded.";
  }

  if (record.commands.length === 0) {
    return "No commands executed in this session.";
  }

  if (typeof commandIndex === "number") {
    const cmd = record.commands[commandIndex];
    if (!cmd) {
      return `Command index ${commandIndex} not found. Available commands: 0 to ${record.commands.length - 1}.`;
    }
    return [
      `Command: ${cmd.command}`,
      `Exit Code: ${cmd.exitCode}`,
      `Timestamp: ${cmd.timestamp}`,
      `--- STDOUT ---`,
      cmd.stdout || "(empty)",
      `--- STDERR ---`,
      cmd.stderr || "(empty)",
    ].join("\n");
  }

  // Return last command output by default
  const lastCmd = record.commands[record.commands.length - 1];
  return [
    `[Last Command] ${lastCmd.command} (exit: ${lastCmd.exitCode})`,
    `--- STDOUT ---`,
    lastCmd.stdout || "(empty)",
    `--- STDERR ---`,
    lastCmd.stderr || "(empty)",
  ].join("\n");
}

export function getTestStatus(workspaceRoot: string): string {
  const recorder = new ExecutionRecorder(workspaceRoot);
  const record = recorder.getLatestRecord();

  if (!record || !record.testResults) {
    return "No test runs recorded for this workspace.";
  }

  return [
    `Status: ${record.testResults.passed ? "PASSED" : "FAILED"}`,
    `Failed Tests: ${record.testResults.failed}`,
    `Total Tests: ${record.testResults.total}`,
    `Output:\n${record.testResults.output}`,
  ].join("\n");
}
