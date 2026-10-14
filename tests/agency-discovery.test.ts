import { describe, it, expect, vi } from "vitest";
import { AgencyDiscoveryEngine } from "../src/gemini/agency-discovery.js";
import type { GeminiGenerationClient } from "../src/gemini/client-interface.js";

describe("AgencyDiscoveryEngine", () => {
  const sampleDiscoveryOutput = `### 1. 🎯 Mục Tiêu Cốt Lõi & Giá Trị Kỹ Thuật (Mission & Value Metric)
* Mục tiêu chính của hệ thống là gì?
- [x] (Recommended) Xây dựng hệ thống phân tán chịu lỗi cao với độ trễ < 50ms
- [ ] Xây dựng giải pháp monolithic đơn giản
- [ ] Chỉ viết prototype thử nghiệm

### 2. ⚙️ Ràng Buộc Kiến Trúc & Tech Stack (Architecture Invariants)
* Framework và runtime mục tiêu là gì?
- [x] (Recommended) Node.js LTS với TypeScript nghiêm ngặt (strict mode)
- [ ] Bun runtime với ES modules
- [ ] Deno 2.0

### 3. 🚫 Non-Goals & Giới Hạn Phạm Vi (Strict Boundaries)
* Những tính năng nào kiên quyết KHÔNG làm trong đợt này?
- [x] (Recommended) Không tái cấu trúc cơ sở dữ liệu quan hệ, không thay đổi OAuth core
- [ ] Làm tất cả mọi thứ

### 4. ⚠️ Bẫy Kỹ Thuật & Pre-Mortem Reality Check (Failure Modes)
* Rủi ro concurrency và race conditions được xử lý thế nào?
- [x] (Recommended) Sử dụng Redlock distributed mutex và atomic compare-and-swap
- [ ] Không cần khóa, chấp nhận dirty read

### 5. ✅ Tiêu Chuẩn Nghiệm Thu & Lệnh Kiểm Thử (Definition of Done)
* Lệnh shell kiểm thử tự động nào chứng minh hoàn thành?
- [x] (Recommended) npm.cmd test với 100% test case pass và 0 type error
- [ ] Kiểm thử thủ công bằng mắt`;

  it("should generate structured discovery questions with agency-agents pillars", async () => {
    const mockClient: GeminiGenerationClient = {
      isConfigured: () => true,
      generate: vi.fn().mockResolvedValue({
        text: sampleDiscoveryOutput,
        model: "3.8 Flash",
      }),
    };

    const engine = new AgencyDiscoveryEngine(mockClient);
    const result = await engine.discover({
      task: "Xây dựng hệ thống phân tán Redis Cache",
      persona: "architect",
      language: "vi",
    });

    expect(result.persona).toContain("Principal Systems Architect");
    expect(result.questions).toHaveLength(5);
    expect(result.questions[0].pillar).toBe("Mission");
    expect(result.questions[1].pillar).toBe("Architecture");
    expect(result.questions[2].pillar).toBe("NonGoals");
    expect(result.questions[3].pillar).toBe("RealityCheck");
    expect(result.questions[4].pillar).toBe("DefinitionOfDone");

    expect(result.questions[0].options).toBeDefined();
    expect(result.questions[0].options?.[0].isRecommended).toBe(true);

    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.stringContaining("Xây dựng hệ thống phân tán Redis Cache"),
      expect.objectContaining({
        thinkingBudget: 8192,
        model: "4 Argon",
      })
    );
  });

  it("should build Reconnaissance Dossier accurately from target workspace", async () => {
    const mockClient: GeminiGenerationClient = {
      isConfigured: () => true,
      generate: vi.fn(),
    };
    const engine = new AgencyDiscoveryEngine(mockClient);
    const dossier = await engine.buildReconnaissanceDossier(process.cwd());

    expect(dossier.projectName).toBe("antigravity-with-gemini");
    expect(dossier.moduleType).toBe("module");
    expect(dossier.configFilesDetected).toContain("package.json");
    expect(dossier.configFilesDetected).toContain("tsconfig.json");
    expect(dossier.topLevelDirectories).toContain("src");
    expect(dossier.topLevelDirectories).toContain("tests");
    expect(dossier.topLevelDirectories).not.toContain("node_modules");
  });

  it("should generate full Agency Discovery Report with dossier and questions", async () => {
    const mockClient: GeminiGenerationClient = {
      isConfigured: () => true,
      generate: vi.fn().mockResolvedValue({
        text: sampleDiscoveryOutput,
        model: "4 Argon",
      }),
    };
    const engine = new AgencyDiscoveryEngine(mockClient);
    const report = await engine.generateAgencyDiscoveryReport("Thực thi khảo sát", process.cwd());

    expect(report.dossier).toBeDefined();
    expect(report.questions.length).toBeGreaterThan(0);
    expect(report.questions[0].dimension).toBe("scope");
    expect(report.formattedPromptBlock).toBeTruthy();
  });
});
