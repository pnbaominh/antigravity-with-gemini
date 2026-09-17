import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { DynamicModelRegistry } from "../src/gemini/model-registry.js";

describe("DynamicModelRegistry", () => {
  let tempDir: string;
  let cacheFile: string;
  let registry: DynamicModelRegistry;

  const mockApiModels = [
    "models/gemini-2.5-flash",
    "models/gemini-2.5-pro",
    "models/gemini-2.0-flash",
    "models/gemini-3-flash-preview", // version 3.0 -> discarded
    "models/gemini-3.1-pro-preview",
    "models/gemini-3.1-flash-lite",
    "models/gemini-3.5-flash",
    "models/gemini-3.5-flash-lite",
    "models/gemini-3.6-flash",
    "models/gemini-3.7-flash",
    "models/gemini-3.8-flash",
    "models/gemini-3.8-live", // live streaming -> discarded
    "models/gemini-3.8-live-extended-thinking", // live streaming -> discarded
    "models/gemini-3.5-live-translate-preview", // live streaming -> discarded
    "models/gemini-3.1-flash-image", // image-only -> discarded
    "models/gemini-3.5-transcribe", // audio/transcribe -> discarded
    "models/veo-3.1-generate-preview", // non-gemini -> discarded
    "models/lyria-3.5", // non-gemini -> discarded
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-registry-test-"));
    cacheFile = path.join(tempDir, "models_cache.json");
    registry = new DynamicModelRegistry(cacheFile);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should strictly filter out models <= 3.0 and keep only text models > 3.0", () => {
    const { supported, discarded } = registry.filterSupportedModels(mockApiModels);

    const supportedIds = supported.map((m) => m.id);

    // Kept models (> 3.0)
    expect(supportedIds).toContain("gemini-3.8-flash");
    expect(supportedIds).toContain("gemini-3.7-flash");
    expect(supportedIds).toContain("gemini-3.6-flash");
    expect(supportedIds).toContain("gemini-3.5-flash");
    expect(supportedIds).toContain("gemini-3.5-flash-lite");
    expect(supportedIds).toContain("gemini-3.1-pro-preview");
    expect(supportedIds).toContain("gemini-3.1-flash-lite");

    // Strictly discarded legacy models (<= 3.0)
    expect(supportedIds).not.toContain("gemini-3-flash-preview");
    expect(supportedIds).not.toContain("gemini-2.5-flash");
    expect(supportedIds).not.toContain("gemini-2.5-pro");
    expect(supportedIds).not.toContain("gemini-2.0-flash");

    // Specialized non-text and streaming live models discarded
    expect(supportedIds).not.toContain("gemini-3.8-live");
    expect(supportedIds).not.toContain("gemini-3.8-live-extended-thinking");
    expect(supportedIds).not.toContain("gemini-3.5-live-translate-preview");
    expect(supportedIds).not.toContain("gemini-3.1-flash-image");
    expect(supportedIds).not.toContain("gemini-3.5-transcribe");
    expect(supportedIds).not.toContain("veo-3.1-generate-preview");
    expect(supportedIds).not.toContain("lyria-3.5");

    // Verify all supported versions are > 3.0
    for (const model of supported) {
      expect(model.version).toBeGreaterThan(3.0);
    }

    // Verify discarded contains legacy versions
    expect(discarded).toContain("gemini-3-flash-preview");
    expect(discarded).toContain("gemini-2.5-flash");
  });

  it("should sort supported models descending by version", () => {
    const { supported } = registry.filterSupportedModels(mockApiModels);
    expect(supported[0].id).toBe("gemini-3.8-flash");
    expect(supported[1].id).toBe("gemini-3.7-flash");
    expect(supported[2].id).toBe("gemini-3.6-flash");
    expect(supported[3].id).toBe("gemini-3.5-flash");
  });

  it("should persist and load cache atomically with TTL check", () => {
    const cacheData = {
      discoveredAt: new Date().toISOString(),
      ttlMs: 3600 * 1000,
      models: [
        { id: "gemini-3.8-flash", version: 3.8, tier: "PLANNER" as const },
        { id: "gemini-3.7-flash", version: 3.7, tier: "PLANNER" as const },
      ],
      discardedLegacyModels: ["gemini-2.5-flash"],
    };

    registry.saveCache(cacheData);

    expect(fs.existsSync(cacheFile)).toBe(true);

    const loaded = registry.loadCache();
    expect(loaded).not.toBeNull();
    expect(loaded?.models).toHaveLength(2);
    expect(loaded?.models[0].id).toBe("gemini-3.8-flash");
  });

  it("should track throttled models and prioritize available models in candidates list", () => {
    // Initially all available
    const candidates1 = registry.getCandidateModels("gemini-3.8-flash");
    expect(candidates1[0]).toBe("gemini-3.8-flash");

    // Mark 3.8 as throttled (e.g. 429 quota exhaustion)
    registry.markThrottled("gemini-3.8-flash", 60_000);
    expect(registry.isThrottled("gemini-3.8-flash")).toBe(true);

    // Candidates should now push 3.8 to the bottom and offer 3.7 or 3.6 first
    const candidates2 = registry.getCandidateModels("gemini-3.8-flash");
    expect(candidates2[0]).not.toBe("gemini-3.8-flash");
    expect(candidates2[candidates2.length - 1]).toBe("gemini-3.8-flash");
  });

  it("should failover seamlessly when primary model hits 429 quota exhaustion", async () => {
    registry.markThrottled("gemini-3.8-flash", 60_000);
    const candidates = registry.getCandidateModels("gemini-3.8-flash");
    
    // First available candidate must not be 3.8-flash
    expect(candidates[0]).not.toBe("gemini-3.8-flash");
    // All candidates must be modern versions > 3.0
    for (const c of candidates) {
      const match = c.match(/gemini-(\d+(?:\.\d+)?)/);
      if (match) {
        expect(parseFloat(match[1])).toBeGreaterThan(3.0);
      }
    }
  });

  it("should persist cooldowns to disk across distinct registry instances", () => {
    // Save cache first
    registry.saveCache({
      discoveredAt: new Date().toISOString(),
      ttlMs: 3600 * 1000,
      models: [
        { id: "gemini-3.5-flash", version: 3.5, tier: "PLANNER" },
        { id: "gemini-3.8-flash", version: 3.8, tier: "PLANNER" },
      ],
      discardedLegacyModels: [],
    });

    // Mark 3.8 throttled on instance 1
    registry.markThrottled("gemini-3.8-flash", 12 * 3600 * 1000);
    expect(registry.isThrottled("gemini-3.8-flash")).toBe(true);

    // Create a new instance reading the same cache file
    const registry2 = new DynamicModelRegistry(cacheFile);
    expect(registry2.isThrottled("gemini-3.8-flash")).toBe(true);

    const candidates = registry2.getCandidateModels("gemini-3.8-flash");
    expect(candidates[0]).toBe("gemini-3.5-flash");
    expect(candidates[candidates.length - 1]).toBe("gemini-3.8-flash");
  });
});
