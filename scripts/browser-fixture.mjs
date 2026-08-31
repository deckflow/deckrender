/** Loopback-only fake cloud for browser contract tests; never calls DeckFlow. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1kAAAAASUVORK5CYII=',
  'base64'
);

export async function startBrowserFixture() {
  const records = [];
  const uploads = new Map();
  let apiOrigin;
  let appOrigin;
  const api = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, apiOrigin);
      const parts = url.pathname.split('/').filter(Boolean);
      const scenario = parts[1];
      if (!url.pathname.endsWith('blocked.png')) {
        res.setHeader('Access-Control-Allow-Origin', appOrigin);
        res.setHeader(
          'Access-Control-Allow-Headers',
          'content-type,x-auth-token,x-auth-uuid,response-event-stream'
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'ETag');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      records.push({
        path: url.pathname,
        method: req.method,
        token: req.headers['x-auth-token'],
        authorization: req.headers.authorization,
        sse: req.headers['response-event-stream'],
        body: body.toString(),
      });
      const json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/stats') {
        json(records);
        return;
      }
      if (parts[0] === 'assets') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
        return;
      }
      if (scenario === 'unauthorized' || scenario === 'payment') {
        json({ message: 'Denied by test cloud' }, scenario === 'unauthorized' ? 401 : 402);
        return;
      }
      if (url.pathname.endsWith('/user')) {
        json({ id: 'test-space' });
        return;
      }
      if (url.pathname.endsWith('/file/auth')) {
        const metadata = JSON.parse(body.toString());
        uploads.set(scenario, { metadata, chunks: [] });
        if (scenario === 'multipart') {
          json({
            id: 'file-1',
            key: 'source',
            platform: 'oss',
            multipart: true,
            multipartPartSize: 4,
            auth: { url: `${apiOrigin}/v1/${scenario}/complete` },
            multipartPartAuths: [0, 1].map((n) => ({ url: `${apiOrigin}/v1/${scenario}/part/${n}` })),
          });
        } else {
          json({
            id: 'file-1',
            key: 'source',
            platform: 'oss',
            auth: { url: `${apiOrigin}/v1/${scenario}/upload` },
          });
        }
        return;
      }
      if (url.pathname.endsWith('/upload')) {
        const upload = uploads.get(scenario);
        if (upload.metadata.hash !== createHash('md5').update(body).digest('hex')) {
          json({ message: 'Bad upload hash' }, 400);
          return;
        }
        json({ ok: true });
        return;
      }
      if (url.pathname.includes('/part/')) {
        uploads.get(scenario).chunks[Number(parts.at(-1))] = body;
        res.setHeader('ETag', `"part-${parts.at(-1)}"`);
        json({ ok: true });
        return;
      }
      if (url.pathname.endsWith('/complete')) {
        const upload = uploads.get(scenario);
        const actual = Buffer.concat(upload.chunks);
        if (
          createHash('md5').update(actual).digest('hex') !== upload.metadata.hash ||
          !body.toString().includes('<ETag>part-0</ETag>')
        ) {
          json({ message: 'Invalid multipart completion' }, 400);
          return;
        }
        json({ ok: true });
        return;
      }
      const task = { id: 'task-1', spaceId: 'test-space', type: 'convertor.ppt2image', status: 'completed' };
      if (url.pathname.endsWith('/tasks') && req.method === 'POST') {
        const payload = JSON.parse(body.toString());
        if (payload.fileIds?.[0] !== 'file-1') {
          json({ message: 'Missing uploaded source' }, 400);
          return;
        }
        json({ ...task, status: 'pending' });
        return;
      }
      if (url.pathname.endsWith('/start')) {
        json({ ...task, status: 'running' });
        return;
      }
      if (url.pathname.endsWith('/download')) {
        json(
          [1, 2].map((page) => [
            `${apiOrigin}/assets/${scenario === 'cors' ? 'blocked' : page}.png`,
            png.length,
            'hash',
            { w: 1, h: 1, total: 2 },
          ])
        );
        return;
      }
      if (url.pathname.endsWith('/tasks/task-1')) {
        if (scenario === 'failed') {
          json({ ...task, status: 'failed', error: 'test task failed' });
          return;
        }
        if (!req.headers['response-event-stream']) {
          json({ ...task, status: 'running' });
          return;
        }
        if (scenario === 'json') {
          json(task);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ ...task, status: 'running' })}\n\n`);
        res.end(`data: ${JSON.stringify(task)}\n\n`);
        return;
      }
      json({ message: 'Unknown fixture route' }, 404);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  const app = http.createServer(async (req, res) => {
    try {
      const files = { '/sdk.js': '../dist/browser/index.js', '/smoke.js': '../tests/browser/smoke.js' };
      if (req.url === '/config.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ apiOrigin }));
        return;
      }
      if (files[req.url]) {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(await readFile(new URL(files[req.url], import.meta.url)));
        return;
      }
      if (req.url !== '/') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><meta charset="utf-8"><title>DeckRender browser smoke tests</title><h1>DeckRender browser SDK</h1><p>Loopback fake cloud; no real documents are uploaded.</p><button id="run">Run browser tests</button><pre id="status">Ready</pre><img id="preview" alt="Rendered image preview"><script type="module" src="/smoke.js"></script>'
      );
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  async function listen(server) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return `http://127.0.0.1:${server.address().port}`;
  }
  try {
    apiOrigin = await listen(api);
    appOrigin = await listen(app);
  } catch (error) {
    api.close();
    app.close();
    throw error;
  }
  return {
    url: appOrigin,
    async close() {
      await Promise.all(
        [api, app].map(
          (server) =>
            new Promise((resolve) => {
              server.close(resolve);
              server.closeAllConnections();
            })
        )
      );
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startBrowserFixture();
  console.log(`Browser test fixture: ${fixture.url}`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await fixture.close();
      process.exit(0);
    });
}
