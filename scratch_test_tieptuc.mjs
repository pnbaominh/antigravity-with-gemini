import { GeminiWebClient } from './dist/browser/gemini-web-client.js';

async function main() {
  const client = new GeminiWebClient();
  const page = await client.getPage(false);
  await page.goto('https://gemini.google.com/u/1/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('Ensuring "Nhiệm vụ" mode...');
  await client.ensureSegmentedMode(page, 'task');
  await page.waitForTimeout(2000);

  // Check for "Tiếp tục" / "Hãy bắt đầu nào" modal
  const tiepTucBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Continue"), button:has-text("Bắt đầu"), button:has-text("Get started")').first();
  if (await tiepTucBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Found onboarding modal! Clicking "Tiếp tục"...');
    await tiepTucBtn.click({ force: true });
    await page.waitForTimeout(2000);
  }

  // Also check if any close button exists
  const closeBtn = page.locator('[aria-label="Đóng"], [aria-label="Close"], button.close-button').first();
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('Clicking modal close button...');
    await closeBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: 'scratch_after_tieptuc.png' });
  console.log('Screenshot after clicking Tiếp tục saved to scratch_after_tieptuc.png');

  // Now try submitAndExtract
  console.log('Submitting prompt in "Nhiệm vụ" mode...');
  const t0 = Date.now();
  const res = await client.submitAndExtract(page, 'Cho tôi 3 bước tối ưu CPU ngắn gọn');
  console.log(`Success in ${(Date.now() - t0) / 1000}s! Length: ${res.length}`);
  console.log('Snippet:\n', res.slice(0, 300));

  await client.close();
}

main().catch(console.error);
