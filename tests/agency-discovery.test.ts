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
});
