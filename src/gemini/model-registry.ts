import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { getStateDirectory } from "../config/paths.js";

export interface DiscoveredModel {
  id: string; // e.g. "gemini-3.8-flash"
  version: number; // e.g. 3.8
  tier: "PLANNER" | "THINKING" | "FAST";
  displayName?: string;
}

export interface ModelCacheData {
  discoveredAt: string;
  ttlMs: number;
  models: DiscoveredModel[];
  discardedLegacyModels: string[];
}

export const MIN_GEMINI_VERSION = 3.1; // Filter out <= 3.0 (2.5, 2.0, 1.5, 3.0-preview)

export const DEFAULT_MODERN_MODELS = {
  PLANNER: "gemini-3.8-flash",
  THINKING: "gemini-3.8-flash",
  FAST: "gemini-3.5-flash-lite",
  FALLBACK_CHAIN: [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
  ],
};

export class DynamicModelRegistry {
  private static instance: DynamicModelRegistry | null = null;
  private throttledModels = new Map<string, number>(); // modelId -> cooldown expiration timestamp
  private cacheFilePath: string;
  private memoryCache: ModelCacheData | null = null;

  constructor(customCachePath?: string) {
    this.cacheFilePath = customCachePath || path.join(getStateDirectory(), "models_cache.json");
  }

  public static getInstance(): DynamicModelRegistry {
    if (!DynamicModelRegistry.instance) {
      DynamicModelRegistry.instance = new DynamicModelRegistry();
    }
    return DynamicModelRegistry.instance;
  }

  /**
   * Filters raw model IDs from Google API, keeping only text-capable models > 3.0
   * and discarding legacy versions <= 3.0.
   */
  public filterSupportedModels(rawModelIds: string[]): {
    supported: DiscoveredModel[];
    discarded: string[];
  } {
    const supported: DiscoveredModel[] = [];
    const discarded: string[] = [];

    // Blacklist patterns that are not general-purpose text/planning models
    const nonTextBlacklist = /(image|tts|transcribe|clip|audio|robotics|customtools|embedding|aqa|veo|lyria)/i;

    for (const rawName of rawModelIds) {
      const cleanId = rawName.replace(/^models\//, "");

      // Must be a Gemini model
      if (!cleanId.startsWith("gemini-")) {
        discarded.push(cleanId);
        continue;
      }

      // Filter out non-text specialized models
      if (nonTextBlacklist.test(cleanId)) {
        discarded.push(cleanId);
        continue;
      }

      // Extract semantic version: e.g. gemini-3.8-flash -> 3.8
      const versionMatch = cleanId.match(/^gemini-(\d+(?:\.\d+)?)/i);
      if (!versionMatch) {
        discarded.push(cleanId);
        continue;
      }

      const version = parseFloat(versionMatch[1]);

      // Strict filter: Must be greater than 3.0 (discard <= 3.0)
      if (version < MIN_GEMINI_VERSION) {
        discarded.push(cleanId);
        continue;
      }

      // Determine tier
      let tier: DiscoveredModel["tier"] = "PLANNER";
      if (cleanId.includes("lite")) {
        tier = "FAST";
      } else if (cleanId.includes("pro") || cleanId.includes("extended-thinking")) {
        tier = "THINKING";
      } else {
        tier = "PLANNER";
      }

      supported.push({
        id: cleanId,
        version,
        tier,
      });
    }

    // Sort supported models descending by version (e.g. 3.8 before 3.7 before 3.6...)
    supported.sort((a, b) => {
      if (b.version !== a.version) {
        return b.version - a.version;
      }
      // Prioritize standard flash or pro over lite
      const aIsLite = a.id.includes("lite") ? 1 : 0;
      const bIsLite = b.id.includes("lite") ? 1 : 0;
      return aIsLite - bIsLite;
    });

    return { supported, discarded };
  }

  /**
   * Reads persistent disk cache. Returns null if missing or expired.
   */
  public loadCache(): ModelCacheData | null {
    if (this.memoryCache && !this.isCacheExpired(this.memoryCache)) {
      return this.memoryCache;
    }

    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, "utf-8");
        const parsed = JSON.parse(raw) as ModelCacheData;
        if (!this.isCacheExpired(parsed)) {
          this.memoryCache = parsed;
          return parsed;
        }
      }
    } catch {
      // ignore read error
    }

    return null;
  }

  /**
   * Saves cache to disk atomically.
   */
  public saveCache(data: ModelCacheData): void {
    this.memoryCache = data;
    try {
      fs.mkdirSync(path.dirname(this.cacheFilePath), { recursive: true });
      const tempPath = `${this.cacheFilePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tempPath, this.cacheFilePath);
    } catch {
      // ignore write error
    }
  }

  private isCacheExpired(cache: ModelCacheData): boolean {
    const age = Date.now() - new Date(cache.discoveredAt).getTime();
    return age > cache.ttlMs;
  }

  /**
   * Discovers models dynamically via GoogleGenAI models.list().
   * Automatically falls back to default modern chain if API error occurs.
   */
  public async discoverModels(
    aiClient?: GoogleGenAI,
    forceRefresh: boolean = false
  ): Promise<ModelCacheData> {
    if (!forceRefresh) {
      const cached = this.loadCache();
      if (cached && cached.models.length > 0) {
        return cached;
      }
    }

    if (!aiClient) {
      return this.getDefaultCacheData();
    }

    try {
      const rawIds: string[] = [];
      const res = await aiClient.models.list();
      for await (const m of res) {
        if (m.name) {
          rawIds.push(m.name);
        }
      }

      const { supported, discarded } = this.filterSupportedModels(rawIds);

      const cacheData: ModelCacheData = {
        discoveredAt: new Date().toISOString(),
        ttlMs: 24 * 60 * 60 * 1000, // 24 hours
        models: supported.length > 0 ? supported : this.getDefaultDiscoveredModels(),
        discardedLegacyModels: discarded,
      };

      this.saveCache(cacheData);
      return cacheData;
    } catch {
      return this.getDefaultCacheData();
    }
  }

  /**
   * Mark a model as temporarily throttled (e.g. 429 quota exhaustion).
   */
  public markThrottled(modelId: string, cooldownMs: number = 60_000): void {
    this.throttledModels.set(modelId, Date.now() + cooldownMs);
  }

  /**
   * Check if a model is currently in cooldown.
   */
  public isThrottled(modelId: string): boolean {
    const expiresAt = this.throttledModels.get(modelId);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.throttledModels.delete(modelId);
      return false;
    }
    return true;
  }

  /**
   * Get ordered list of candidate models for generation.
   * Puts active (non-throttled) models first, and throttled models at the very end.
   */
  public getCandidateModels(preferredModel?: string): string[] {
    const cache = this.loadCache() || this.getDefaultCacheData();
    const allDiscoveredIds = cache.models.map((m) => m.id);

    const candidates: string[] = [];
    if (preferredModel && !candidates.includes(preferredModel)) {
      candidates.push(preferredModel);
    }

    for (const id of allDiscoveredIds) {
      if (!candidates.includes(id)) {
        candidates.push(id);
      }
    }

    // Append fallback defaults if not already present
    for (const fallback of DEFAULT_MODERN_MODELS.FALLBACK_CHAIN) {
      if (!candidates.includes(fallback)) {
        candidates.push(fallback);
      }
    }

    // Partition by throttle status: non-throttled first, throttled last
    const active = candidates.filter((id) => !this.isThrottled(id));
    const throttled = candidates.filter((id) => this.isThrottled(id));

    return [...active, ...throttled];
  }

  private getDefaultDiscoveredModels(): DiscoveredModel[] {
    return [
      { id: "gemini-3.8-flash", version: 3.8, tier: "PLANNER" },
      { id: "gemini-3.7-flash", version: 3.7, tier: "PLANNER" },
      { id: "gemini-3.6-flash", version: 3.6, tier: "PLANNER" },
      { id: "gemini-3.5-flash", version: 3.5, tier: "PLANNER" },
      { id: "gemini-3.5-flash-lite", version: 3.5, tier: "FAST" },
      { id: "gemini-3.1-pro-preview", version: 3.1, tier: "THINKING" },
      { id: "gemini-3.1-flash-lite", version: 3.1, tier: "FAST" },
    ];
  }

  private getDefaultCacheData(): ModelCacheData {
    return {
      discoveredAt: new Date().toISOString(),
      ttlMs: 24 * 60 * 60 * 1000,
      models: this.getDefaultDiscoveredModels(),
      discardedLegacyModels: [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-3-flash-preview",
      ],
    };
  }
}
