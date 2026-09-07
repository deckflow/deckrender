import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('official SDK browser entry', () => {
  it('ships browser exports without Node-only file access', async () => {
    const manifest = JSON.parse(await readFile('node_modules/@deckflow/decktools-sdk/package.json', 'utf8'));
    expect(manifest.exports['./browser']).toBeDefined();
    const browser = await readFile('node_modules/@deckflow/decktools-sdk/dist/browser.js', 'utf8');
    expect(browser).not.toMatch(/from ["']node:|import\(["']node:|fs\/promises|homedir|getNodeConfigDir/);
    for (const feature of [
      'uploadMultipart',
      'calculateMD5',
      'fetchEventStream',
      'consumeWebStream',
      'completeMultipart',
    ]) {
      expect(browser).toContain(feature);
    }
  });
});
