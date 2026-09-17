import { describe, it, expect } from "vitest";
import path from "node:path";
import { WorkspaceManager } from "../src/workspace/manager.js";

describe("WorkspaceManager", () => {
  const root = path.resolve(process.cwd());
  const manager = new WorkspaceManager(root);

  it("should get workspace info including package manager and name", () => {
    const info = manager.getInfo();
    expect(info.name).toBe("antigravity-with-gemini");
    expect(info.packageManager).toBe("npm");
    expect(info.root).toBe(root);
  });

  it("should list directory files respecting ignore filter", () => {
    const items = manager.listDirectory("", 1);
    expect(items.length).toBeGreaterThan(0);
    const itemNames = items.map((i) => i.name);
    expect(itemNames).toContain("package.json");
    expect(itemNames).not.toContain("node_modules");
  });

  it("should read a file with line slicing", () => {
    const result = manager.readFile("package.json", 1, 5);
    expect(result.path).toBe("package.json");
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(5);
    expect(result.content).toContain('"name": "antigravity-with-gemini"');
  });
});
