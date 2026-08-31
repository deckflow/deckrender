import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { startBrowserFixture } from '../../scripts/browser-fixture.mjs';
import { launchLocalBrowser } from '../../src/engines/local/browser.js';

const browserTests = process.env.DECKRENDER_BROWSER_E2E === '1' ? describe : describe.skip;
browserTests('published browser SDK in real Chromium', () => {
  let browser: Browser;
  let fixture: Awaited<ReturnType<typeof startBrowserFixture>>;
  beforeAll(async () => {
    fixture = await startBrowserFixture();
    browser = (await launchLocalBrowser()).browser;
  });
  afterAll(async () => {
    await browser?.close();
    await fixture?.close();
  });
  it('uploads across origins, waits for tasks, previews artifacts and enforces identity boundaries', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(fixture.url);
      await page.locator('#run').click();
      await page.waitForFunction(() =>
        /^(PASS|FAIL)/.test(document.querySelector('#status')?.textContent ?? '')
      );
      expect(await page.locator('#status').innerText()).toMatch(/^PASS \(21 checks\)/);
    } finally {
      await page.close();
    }
  });
});
