import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { BrowserDetector } from "../dist/browser/detector.js";
import { cleanupBrowserSingletonLocks } from "../dist/utils/platform.js";

async function explore() {
  const detected = BrowserDetector.findBrowser();
  if (!detected) {
    console.error("No browser detected!");
    process.exit(1);
  }

  const userDataDir = path.join(os.homedir(), ".g2a", "browser_profile");
  await cleanupBrowserSingletonLocks(userDataDir);

  console.log(`Launching ${detected.name} (${detected.executablePath})...`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: detected.executablePath,
    headless: false, // Run headed so we can see and inspect
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log("Navigating to https://gemini.google.com/app...");
  await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  // Look for elements with text "Cuộc trò chuyện" and "Nhiệm vụ"
  const elementsInfo = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button, [role='button'], [role='tab'], div, span"));
    const chatElements = all.filter(el => {
      const t = (el.textContent || "").trim();
      return t === "Cuộc trò chuyện" || t === "Nhiệm vụ" || t.includes("Cuộc trò chuyện") || t.includes("Nhiệm vụ");
    }).map(el => ({
      tagName: el.tagName,
      role: el.getAttribute("role"),
      className: el.className,
      textContent: (el.textContent || "").trim(),
      ariaSelected: el.getAttribute("aria-selected"),
      dataTestId: el.getAttribute("data-test-id"),
      attributes: Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).join(" "),
      outerHTML: el.outerHTML.slice(0, 300)
    }));
    return chatElements;
  });

  console.log("Found matching elements:", JSON.stringify(elementsInfo, null, 2));

  await context.close();
}

explore().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
