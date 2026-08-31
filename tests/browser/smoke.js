import { createRenderer, render } from '/sdk.js';

const status = document.querySelector('#status');
document.querySelector('#run').addEventListener('click', async () => {
  status.textContent = 'Running...';
  const checks = [];
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
    checks.push(message);
  };
  try {
    const { apiOrigin } = await (await fetch('/config.json')).json();
    const input = new File(['12345678'], 'deck.pptx');
    const client = (scenario, guest = false) =>
      createRenderer({
        apiBase: `${apiOrigin}/v1/${scenario}`,
        ...(guest ? { guest: true } : { token: 'test-user-token' }),
      });
    const stats = async () => (await fetch(`${apiOrigin}/stats`)).json();
    const startCount = (await stats()).length;
    const runStats = async () => (await stats()).slice(startCount);
    try {
      await render({ input });
      throw new Error('accepted missing auth');
    } catch (error) {
      check(error.code === 'auth_error', 'Missing credentials rejected before upload');
    }
    const phases = [];
    const result = await client('sse').render({
      input,
      pages: '2',
      onProgress: (event) => phases.push(event.phase),
    });
    check(
      result.engine === 'cloud' && result.pages === 2 && result.outputs[0].page === 2,
      'File upload, SSE wait and page selection'
    );
    check(phases.includes('wait') && !phases.includes('write'), 'Browser progress without disk writes');
    const beforeDownload = await runStats();
    check(!beforeDownload.some((r) => r.path.startsWith('/assets/')), 'No eager final artifact download');
    check(
      beforeDownload.some((r) => r.sse === 'yes'),
      'Real fetch event-stream path used'
    );
    check((await result.outputs[0].blob()).type === 'image/png', 'Cross-origin lazy Blob download');
    const img = document.querySelector('#preview');
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = result.outputs[0].url;
    });
    check(img.naturalWidth === 1, 'Returned URL displays in an image element');
    const guest = await client('guest', true).render({ input });
    check(guest.outputs.length === 2, 'Explicit guest render');
    const multipart = await client('multipart').render({ input });
    check(multipart.outputs.length === 2, 'Multipart upload, MD5 and exposed ETag completion');
    const json = await client('json').render({ input });
    check(json.outputs.length === 2, 'JSON response on event-stream endpoint');
    for (const scenario of ['unauthorized', 'payment']) {
      try {
        await client(scenario).render({ input });
        throw new Error('accepted rejected credentials');
      } catch (error) {
        check(error.code === 'auth_error', `${scenario} surfaces without guest fallback`);
      }
    }
    try {
      await client('failed').render({ input });
      throw new Error('accepted failed task');
    } catch (error) {
      check(
        error.code === 'render_error' && error.hint?.includes('task-1'),
        'Task failure retains task identity'
      );
    }
    const blocked = await client('cors').render({ input });
    try {
      await blocked.outputs[0].blob();
      throw new Error('ignored CORS');
    } catch (error) {
      check(error.code === 'conversion_error', 'Real artifact CORS denial is reported');
    }
    const pass = await render({ input: new File(['%PDF-test'], 'report.pdf'), format: 'pdf' });
    check((await (await fetch(pass.outputs[0].url)).text()) === '%PDF-test', 'Zero-upload PDF passthrough');
    pass.dispose();
    pass.dispose();
    try {
      await fetch(pass.outputs[0].url);
      throw new Error('URL was not revoked');
    } catch (error) {
      check(error instanceof TypeError, 'Owned object URL revoked on dispose');
    }
    const requests = await runStats();
    check(
      requests.filter((r) => r.path.endsWith('/start')).length === 1,
      'Only guest tasks are explicitly started'
    );
    check(
      requests.filter((r) => r.path.includes('/unauthorized/')).length === 1,
      '401 is not retried under another identity'
    );
    check(
      requests.filter((r) => r.path.startsWith('/assets/')).every((r) => !r.token && !r.authorization),
      'No API credentials sent to artifact hosts'
    );
    check(
      requests
        .filter((r) => r.method === 'PUT' && /\/upload$|\/part\//.test(r.path))
        .every((r) => !r.token && !r.authorization),
      'No user credentials sent to signed upload URLs'
    );
    check(
      typeof window.process === 'undefined' && typeof window.Buffer === 'undefined',
      'Runs without Node global polyfills'
    );
    status.textContent = `PASS (${checks.length} checks)\n${checks.join('\n')}`;
  } catch (error) {
    status.textContent = `FAIL\n${error.stack ?? error}\nPassed:\n${checks.join('\n')}`;
  }
});
