import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { browserDeckopsSource } from '../../scripts/deckops-browser.js';

describe('pinned upstream browser compatibility bridge', () => {
  it('removes only Node-specific paths while preserving upload and task features', async () => {
    const source = await readFile('node_modules/@deckops/sdk/dist/index.js', 'utf8');
    const browser = browserDeckopsSource(source);
    expect(browser).not.toMatch(/\bprocess\b|import\s*\(|fs\/promises|homedir|getNodeConfigDir/);
    for (const feature of [
      'uploadMultipart',
      'calculateMD5',
      'fetchEventStream',
      'consumeWebStream',
      'completeMultipart',
    ]) {
      expect(browser).toContain(feature);
    }
    expect(browser).toContain('Filesystem inputs are not available');
  });
  it('fails closed when upstream content changes', () => {
    expect(() => browserDeckopsSource('new upstream code')).toThrow(/Audit its browser export/);
  });
});
