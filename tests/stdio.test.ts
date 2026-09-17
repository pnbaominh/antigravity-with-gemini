import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { writeAntigravityMcpSchemas, TOOL_SCHEMAS } from "../src/mcp/schemas.js";

describe("MCP Schemas and Stdio Transport", () => {
  it("should have schemas for all 14 tools", () => {
    const keys = Object.keys(TOOL_SCHEMAS);
    expect(keys.length).toBe(14);
    expect(keys).toContain("workspace_info");
    expect(keys).toContain("gemini_plan");
    expect(keys).toContain("gemini_get_phase");
    expect(keys).toContain("gemini_active_plan");
    expect(keys).toContain("gemini_review");
    expect(keys).toContain("gemini_think");
  });

  it("should generate schema files on disk", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-schemas-test-"));
    try {
      const written = writeAntigravityMcpSchemas(tempDir);
      expect(written.length).toBe(15); // 14 tools + instructions.md
      expect(fs.existsSync(path.join(tempDir, "gemini_plan.json"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "instructions.md"))).toBe(true);

      const planSchema = JSON.parse(fs.readFileSync(path.join(tempDir, "gemini_plan.json"), "utf-8"));
      expect(planSchema.name).toBe("gemini_plan");
      expect(planSchema.parameters.required).toContain("task");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
