import { GeminiWebClient } from './dist/browser/gemini-web-client.js';

async function main() {
  const client = new GeminiWebClient();
  const page = await client.getPage(false);
  await page.goto('https://gemini.google.com/u/1/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('Ensuring "Nhiệm vụ" mode...');
  await client.ensureSegmentedMode(page, 'task');
  await page.waitForTimeout(1000);

  const inputSelector = 'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"]';
  const textbox = page.locator(inputSelector).first();
  await textbox.focus();
  await textbox.click({ force: true });
  await page.waitForTimeout(300);
  await page.keyboard.insertText('Lập danh sách 3 bước tối ưu Windows');
  await page.waitForTimeout(1000);

  // Take screenshot right after typing to see if send button appears
  await page.screenshot({ path: 'scratch_typed.png' });
  console.log('Saved scratch_typed.png');

  // Find send button
  const sendBtn = page.locator('button[aria-label*="Gửi"], button[aria-label*="Send"], button.send-button, [data-test-id="send-button"]').first();
  console.log('Send button visible:', await sendBtn.isVisible());
  if (await sendBtn.isVisible()) {
    await sendBtn.click({ force: true });
    console.log('Clicked send button!');
  } else {
    await page.keyboard.press('Enter');
    console.log('Pressed Enter!');
  }

  // Wait 10s and screenshot
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'scratch_after_send_10s.png' });
  console.log('Saved scratch_after_send_10s.png');

  const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');
  console.log('Page text snippet:\n', pageText.slice(0, 500));

  await client.close();
}

main().catch(console.error);
