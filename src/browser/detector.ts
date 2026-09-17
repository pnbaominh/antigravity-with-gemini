import fs from "fs";
import path from "path";

export interface DetectedBrowser {
  name: "brave" | "chrome" | "edge" | "chromium" | "custom";
  executablePath: string;
  version?: string;
}

export class BrowserDetector {
  /**
   * Discovers the best available Chromium-based browser on the host system.
   * Prioritizes Brave, then Chrome, then Edge.
   */
  public static findBrowser(preferredPath?: string): DetectedBrowser | null {
    if (preferredPath && fs.existsSync(preferredPath)) {
      return {
        name: "custom",
        executablePath: preferredPath,
      };
    }

    const platform = process.platform;
    const candidates = this.getCandidatesForPlatform(platform);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate.path)) {
        return {
          name: candidate.name,
          executablePath: candidate.path,
        };
      }
    }

    return null;
  }

  private static getCandidatesForPlatform(
    platform: NodeJS.Platform
  ): Array<{ name: DetectedBrowser["name"]; path: string }> {
    if (platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local";
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

      return [
        // 1. Brave (High priority as preferred by user)
        {
          name: "brave",
          path: path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        },
        {
          name: "brave",
          path: path.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        },
        {
          name: "brave",
          path: path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        },
        // 2. Google Chrome
        {
          name: "chrome",
          path: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        },
        {
          name: "chrome",
          path: path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        },
        {
          name: "chrome",
          path: path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        },
        // 3. Microsoft Edge (standard on Windows)
        {
          name: "edge",
          path: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        },
        {
          name: "edge",
          path: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        },
      ];
    }

    if (platform === "darwin") {
      return [
        {
          name: "brave",
          path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        },
        {
          name: "chrome",
          path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
        {
          name: "edge",
          path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        },
      ];
    }

    // Linux
    return [
      { name: "brave", path: "/usr/bin/brave-browser" },
      { name: "chrome", path: "/usr/bin/google-chrome-stable" },
      { name: "chrome", path: "/usr/bin/google-chrome" },
      { name: "chromium", path: "/usr/bin/chromium-browser" },
      { name: "chromium", path: "/usr/bin/chromium" },
      { name: "edge", path: "/usr/bin/microsoft-edge" },
    ];
  }
}
