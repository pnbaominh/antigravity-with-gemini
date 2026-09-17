import { describe, it, expect } from "vitest";
import { PromptSanitizer } from "../src/gemini/prompt-sanitizer.js";

describe("PromptSanitizer & Authorized Scope Engine", () => {
  it("should detect domains like fastfoodbim.io.vn and record them", () => {
    const result = PromptSanitizer.sanitizeTask("Xay dung web BIO cho fastfoodbim.io.vn");
    expect(result.detectedDomains).toContain("fastfoodbim.io.vn");
    expect(result.sanitizedTask).toBe("thiết kế kiến trúc phần mềm BIO cho fastfoodbim.io.vn");
  });

  it("should swap pre-mortem with Risk Assessment & RAID Log", () => {
    const result = PromptSanitizer.sanitizeTask("Please perform a pre-mortem analysis before writing code");
    expect(result.sanitizedTask).toContain("Risk Assessment & RAID Log");
    expect(result.sanitizedTask).not.toMatch(/pre-mortem/i);
    expect(result.substitutions.length).toBeGreaterThan(0);
  });

  it("should swap bypass and exploit with defensive software engineering terms", () => {
    const result = PromptSanitizer.sanitizeTask("How to bypass auth and exploit race conditions");
    expect(result.sanitizedTask).toContain("graceful fallback & boundary handling");
    expect(result.sanitizedTask).toContain("boundary edge-case condition");
    expect(result.sanitizedTask).not.toContain("bypass");
    expect(result.sanitizedTask).not.toContain("exploit");
  });

  it("should strip reasoning extraction triggers", () => {
    const result = PromptSanitizer.sanitizeTask("Build user service. Explain step-by-step your thinking.");
    expect(result.sanitizedTask).not.toMatch(/explain step-by-step your thinking/i);
    expect(result.sanitizedTask).toBe("Build user service.");
  });

  it("should wrap task into clean architect prompt with domain tokens", () => {
    const { prompt, detectedDomains } = PromptSanitizer.buildAuthorizedArchitectPrompt({
      task: "Trien khai web BIO cho fastfoodbim.io.vn",
      workspaceSummary: "Project: bio-site",
      isGreenfield: true,
    });

    expect(detectedDomains).toContain("fastfoodbim.io.vn");
    expect(prompt).toContain("fastfoodbim.io.vn");
    expect(prompt).toContain("Domain Configuration");
    expect(prompt).toContain("greenfield");
    expect(prompt).toContain("RULES.MD");
  });
});
