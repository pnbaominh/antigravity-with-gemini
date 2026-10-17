import { GeminiWebClient } from './dist/browser/gemini-web-client.js';
import fs from 'fs';

async function main() {
  const client = new GeminiWebClient();
  const page = await client.getPage(false);
  await page.goto('https://gemini.google.com/u/1/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await client.handleCaptchaAndPopups(page);

  console.log('Switching to "Nhiệm vụ" mode...');
  await client.ensureSegmentedMode(page, 'task');
  await page.waitForTimeout(2000);

  const inputSelector = 'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"]';
  const textbox = page.locator(inputSelector).first();
  await textbox.focus();
  await textbox.click({ force: true });
  await page.keyboard.insertText('Lập danh sách 3 bước kiểm tra CPU ngắn gọn');
  await page.waitForTimeout(800);

  const sendBtn = page.locator('button[aria-label*="Gửi"], button[aria-label*="Send"], button.send-button').first();
  if (await sendBtn.isVisible()) {
    console.log('Clicking send button...');
    await sendBtn.click({ force: true });
  } else {
    console.log('Pressing Enter...');
    await page.keyboard.press('Enter');
  }

  // Poll DOM every 3 seconds for 30 seconds
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(3000);
    const dump = await page.evaluate(() => {
      // Find all custom tags or containers in main content area
      const allElements = Array.from(document.querySelectorAll('*'));
      const relevant = allElements.filter(el => {
        const tag = el.tagName.toLowerCase();
        return (
          tag.includes('message') ||
          tag.includes('response') ||
          tag.includes('task') ||
          tag.includes('card') ||
          tag.includes('artifact') ||
          tag.includes('plan') ||
          tag.includes('step') ||
          tag.includes('progress') ||
          tag.includes('status') ||
          tag.includes('deep') ||
          tag.includes('research') ||
          tag.includes('viewer') ||
          tag.includes('turn')
        );
      }).map(el => ({
        tag: el.tagName.toLowerCase(),
        classes: el.className,
        textSnippet: (el.innerText || '').slice(0, 150).trim()
      }));

      // Also get stop button or spinners
      const spinners = Array.from(document.querySelectorAll('mat-spinner, .loading-indicator, button[aria-label*="Stop"], button[aria-label*="Dừng"]')).map(el => el.outerHTML.slice(0, 100));

      // Also get body text snippet
      const bodyText = document.body ? document.body.innerText.slice(0, 500) : '';

      return {
        spinners,
        relevantCount: relevant.length,
        relevantSample: relevant.slice(0, 10),
        bodySnippet: bodyText
      };
    });

    console.log(`[After ${i * 3}s] Spinners:`, dump.spinners.length, 'Relevant tags:', dump.relevantCount);
    console.log(`[After ${i * 3}s] Sample:`, JSON.stringify(dump.relevantSample, null, 2));
    if (dump.bodySnippet.includes('CPU') && !dump.bodySnippet.endsWith('Lập danh sách 3 bước kiểm tra CPU ngắn gọn')) {
      console.log(`[After ${i * 3}s] Body snippet:`, dump.bodySnippet.slice(0, 300));
    }
  }

  // Save screenshot to scratch/task_mode.png
  await page.screenshot({ path: 'scratch_task_mode.png' });
  console.log('Screenshot saved to scratch_task_mode.png');

  await client.close();
}

main().catch(console.error);
