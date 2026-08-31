# Browser SDK

Use `@deckflow/deckrender/browser` in browser applications. The SDK runs in the
browser; document conversion runs in the DeckFlow cloud. The existing package
root remains the Node.js API. No Node polyfills or `@types/node` are needed by
browser consumers.

This entry requires a modern browser in a secure context (HTTPS or localhost).
Importing it during SSR is safe, but call its browser rendering API on the client.
It is framework-independent: React, Vue, and other frameworks use the same API.

## Install and render

This entry is implemented in the current source tree and is not yet published
to npm. To try it from another project before release:

```sh
# In the DeckRender repository:
pnpm build
pnpm pack

# In your frontend project, install the .tgz path printed by pnpm pack:
npm install --omit=optional /absolute/path/to/generated-package.tgz
```

After a release containing this entry is published, use:

```sh
npm install --omit=optional @deckflow/deckrender
```

Skipping optional dependencies avoids installing native local-rendering tools.
If the same installation also uses the Node local engine, keep those dependencies.

```ts
import { createRenderer } from '@deckflow/deckrender/browser';

const renderer = createRenderer({
  // Implement this in your application's authentication layer. The returned
  // token must be a DeckFlow user token, not an arbitrary application JWT.
  getToken: () => auth.getDeckFlowToken(),
  onWarning: (message) => console.warn(message),
});

const result = await renderer.render({
  input: fileInput.files![0]!,
  format: 'image',
  imageFormat: 'png',
  pages: '1-3',
  width: 1920,
  onProgress: (event) => console.log(event.phase, event.message),
});

const first = result.outputs[0];
if (first) {
  previewImage.src = first.url;       // no eager download of every output
  const blob = await first.blob();   // optional, downloads only this artifact
  console.log(first.page, first.width, blob.size);
}

// When the preview is no longer used (e.g. component unmount):
result.dispose();
```

The `auth`, `fileInput`, and `previewImage` values above belong to your application.
The SDK does not provide a login UI. A one-shot `render({ input, token, ... })` is
also exported. Reuse `createRenderer()` for multiple renders.

## Inputs

```ts
await renderer.render({ input: file }); // File from a picker or drag-and-drop
await renderer.render({ input: { data: blob, name: 'deck.pptx' } });
await renderer.render({ input: { data: bytes, name: 'deck.pptx' } }); // Uint8Array / ArrayBuffer
await renderer.render({ input: { html: '<h1>Hello</h1>', baseUrl: 'https://example.com/deck/' } });
await renderer.render({ input: { markdown: '# Hello' } });
await renderer.render({ input: { data: bytes, name: 'document.bin' }, from: 'pdf' });
```

- Names are filenames, not paths. The extension determines the source format
  unless `from` is supplied. `.htm` and `.markdown` aliases are supported.
- Inline text is uploaded as an HTML/Markdown file. `baseUrl` supplies the base
  for relative assets; it does not upload those assets or reproduce an authenticated
  browser session. An existing HTML `<base>` is preserved.
- Paths, URL strings, raw unnamed Blobs, `local`/`auto`, `out`, native executable
  paths, profiles, and `AbortSignal` are not part of this first browser release.
  Unsupported options are rejected rather than silently ignored.
- To render a hosted document, fetch it with your application's own CORS/auth
  policy, then pass `{ data: blob, name }`. Never send private session cookies to
  an arbitrary asset host or build an unrestricted URL proxy.

The [cloud format matrix](formats.md) and option restrictions still apply. The
browser entry does not add converters. `pages` filters results and subsequent
per-page conversion work; the upstream initial conversion still renders the
whole document. Derived routes (e.g. DOCX → PDF → image, or WebP output) download
and re-upload intermediate artifacts in the browser. Large documents can use
substantial memory and bandwidth; keep native/server orchestration for that case.

## Results and lifetime

`BrowserRenderResult` contains `ok`, `input`, `format`, `engine`, `route`, `pages`,
`outputs`, `durationMs`, optional `caveat`, and `dispose()`.

Each output has `page`, `url`, `ext`, `mimeType`, optional `width`/`height`/`bytes`,
and `blob()`. This is separate from the Node result's `outputs[].file` contract.

- Cloud outputs retain the backend URLs. They may expire; this SDK does not
  invent an expiration time or make them permanent. `blob()` fetches on each call
  with credentials omitted and reports expiry/CORS/download failures.
- PDF → PDF is an unchanged-document passthrough. It creates a local object URL
  and does not resolve a token or upload anything. `pages: 1` in that result means
  one unchanged document, not a measured physical PDF page count. Page selection
  and image-only options are rejected for this route.
- Call `dispose()` after previews are removed. It revokes only object URLs the
  SDK created, is safe to call repeatedly, and does not delete remote files.
- `dispose()` is not cancellation. There is currently no public `AbortSignal` or
  server task-cancellation promise. `timeout` is a wait timeout **per task**, in
  seconds (default 300), not an end-to-end upload/render deadline. Closing a tab
  can leave already-created cloud tasks running; derived pipelines cannot continue
  orchestration after the tab closes.

Progress events describe phases, not a synthetic overall percentage. Not every
phase has `ratio`; browser rendering does not emit a disk `write` phase.

## Authentication and CORS

Use **one** of `token`, `getToken`, or explicit `guest: true`:

```ts
const signedIn = createRenderer({ token: userToken });
const refreshing = createRenderer({ getToken: () => auth.getDeckFlowToken() });
const guest = createRenderer({ guest: true }); // explicit consent to guest uploads
```

`getToken` is called before each cloud render; your application owns refresh.
Missing tokens fail before upload. HTTP 401/403/402 does not restart a render as
a guest. To retry after login, get a valid user token and explicitly render again.
An explicit guest configuration cannot be combined with tokens or `spaceId`.

Each render gets its own client to isolate parallel authentication state. The
SDK keeps tokens and its client UUID in memory, not in localStorage or Node
credential files. The module reuses its in-memory UUID across renderers and
one-shot calls for the page's lifetime. Reloading is not a new entitlement or quota.
The backend remains responsible for authorization and guest rate limiting.

Never put a long-lived application API key in a frontend bundle. When your
application only has such a key, use an authenticated server integration. A custom
`apiBase` must be an absolute HTTP(S) DeckOps-compatible API root without a query
or fragment, **not** an
arbitrary render endpoint. For a same-origin proxy use, for example,
`new URL('/api/deckops', window.location.origin).href`; enforce user/space/task
ownership on the server and do not expose a generic privileged forwarding proxy.

Before enabling production browser traffic, verify:

1. API preflights allow the frontend origin and the actual request headers,
   including `X-Auth-Token`, `X-Auth-UUID`, `Content-Type`, and `response-event-stream`.
2. Signed upload storage permits the required PUT/POST methods and signed headers.
   Multipart OSS uploads must expose `ETag` to JavaScript.
3. Intermediate and final artifact storage allows browser fetches. Displaying an
   image with `<img>` is not proof that `blob()` or canvas access will work.
4. The application's CSP permits the API/storage hosts via `connect-src` and
   preview hosts (including `blob:` for passthrough) via `img-src`/`media-src`.

The tests use cross-origin loopback fake endpoints. They verify the browser's
CORS enforcement and the client protocol, **not the production cloud's CORS
configuration or conversion fidelity**. No real document uploads are required.

## Build and verification

```sh
pnpm build
pnpm test:browser          # isolated DOM-only TypeScript consumer + browser bundle + SSR import
pnpm test:browser:e2e      # real Chromium, loopback fake cloud; requires Chrome/Chromium
node scripts/browser-fixture.mjs # optional interactive browser test page
```

The Node build runs first, then a separate browser build emits
`dist/browser/index.js` and `index.d.ts`. The browser bundle includes its transport
dependencies so consumers never resolve the broken upstream entry themselves.

Upstream `@deckops/sdk@0.7.3` supports browser uploads/SSE but still publishes Node
dynamic imports and an incorrect type entry. `scripts/deckops-browser.ts` is a
build-only, SHA-256-guarded compatibility bridge: it removes filesystem inputs,
Node UUID persistence and Node runtime selection while preserving the existing
upload/hash/multipart/task implementation. It does not edit `node_modules`, add
polyfills, or affect the Node build. Unknown upstream contents fail the build.
Replace this bridge with a verified upstream browser export when one is available.
