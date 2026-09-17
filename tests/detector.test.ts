import { describe, it, expect } from "vitest";
import { BrowserDetector } from "../src/browser/detector.js";
import fs from "fs";

describe("BrowserDetector", () => {
  it("should find an installed browser on this system", () => {
    const detected = BrowserDetector.findBrowser();
    expect(detected).not.toBeNull();
    if (detected) {
      expect(fs.existsSync(detected.executablePath)).toBe(true);
      expect(["brave", "edge", "chrome", "chromium", "custom"]).toContain(detected.name);
    }
  });

  it("should respect custom preferred executable path", () => {
    const dummyPath = "C:\\Windows\\System32\\cmd.exe";
    const detected = BrowserDetector.findBrowser(dummyPath);
    expect(detected).not.toBeNull();
    expect(detected?.name).toBe("custom");
    expect(detected?.executablePath).toBe(dummyPath);
  });
});
