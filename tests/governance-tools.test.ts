import { describe, it, expect } from "vitest";
import path from "node:path";
import { createG2AMcpServer } from "../src/mcp/server.js";
import { GeminiThinkingClient } from "../src/gemini/client.js";

describe("Governance MCP Tools", () => {
  const workspaceRoot = path.resolve(process.cwd());
  const mockClient = {} as GeminiThinkingClient;
  const server = createG2AMcpServer(workspaceRoot, { geminiClient: mockClient });

  // @ts-expect-error - accessing registered tools
  const tools = server._registeredTools;

  it("should calculate statistical PERT with 68% and 95% confidence intervals", async () => {
    const pertTool = tools["gemini_calculate_pert"];
    expect(pertTool).toBeDefined();

    const result = await pertTool.handler({
      optimistic: 6,
      mostLikely: 12,
      pessimistic: 24,
    });

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(text).toContain("**Expected Duration (E):** **13 hours**");
    expect(text).toContain("**Standard Deviation (σ):** **3 hours**");
    expect(text).toContain("**68% Confidence Interval (1σ):** [10h, 16h]");
    expect(text).toContain("**95% Confidence Interval (2σ):** [7h, 19h]");
    expect(text).toContain("Compliant ✓");
  });

  it("should validate a plan against RULES.MD invariants using gemini_validate_plan", async () => {
    const validateTool = tools["gemini_validate_plan"];
    expect(validateTool).toBeDefined();

    const compliantPlanMarkdown = `# Plan: Core Governance Engine
DRI: @lead_architect

## 1. AS-IS State & Evidence Grounding
- \`package.json\`: Workspace root descriptor with vitest configured
- \`RULES.md\`: Technical governance specification

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
- No migration of legacy tests to Jest
- No external web dashboard UI implementation
- No modification of Gemini API auth credentials flow

## 3. Unknowns & Halt Checks
- Status: CLEAR
- Unknowns: None

## 4. Pre-Mortem & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation | Owner DRI |
| RAID-1 | Risk | Windows CRLF causing test diff mismatch | High | Medium | Force LF in git attributes | @lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
### Phase 1: Foundation Parser
- [ ] Task 1.1: Implement markdown parser for governance schema
- [ ] Task 1.2: Add unit tests for parser
**Verification:** npm test tests/rules-engine.test.ts
PERT: O=1, M=2, P=3

## 6. Definition of Done & Acceptance Criteria
- 100% test pass rate
- Zero build errors
`;

    const result = await validateTool.handler({
      planMarkdown: compliantPlanMarkdown,
    });

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(text).toContain("RULES.MD COMPLIANT");
    expect(text).toContain("Validation Result:** PASSED");
    expect(text).toContain("Violations Count:** 0");
  });

  it("should trigger HALT REQUIRED when plan contains unknowns", async () => {
    const validateTool = tools["gemini_validate_plan"];

    const haltPlanMarkdown = `# Plan: Ambiguous Task
DRI: @dev

## 1. AS-IS State & Evidence Grounding
- \`package.json\`: Root

## 2. Non-Goals & Scope Boundaries
- No NG 1
- No NG 2
- No NG 3

## 3. Unknowns & Halt Checks
- Status: HALT
- Missing AWS access key for S3 bucket upload

## 4. Pre-Mortem & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation | Owner DRI |
| R-1 | Risk | Missing creds | High | High | Halt | @dev |

## 5. Phased Implementation Plan
### Phase 1: Upload
- [ ] Task 1.1: Upload files
**Verification:** npm test
`;

    const result = await validateTool.handler({
      planMarkdown: haltPlanMarkdown,
    });

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(text).toContain("HALT ON UNKNOWN REQUIRED");
    expect(text).toContain("Validation Result:** FAILED");
    expect(text).toContain("Halt-on-Unknown triggered");
  });
});