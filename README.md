# DeckRender

> Render PPTX, PDF, DOCX, Keynote, HTML and Markdown into images, PDF or video.

DeckRender turns supported document and web inputs into images, PDFs, or videos through one predictable CLI and TypeScript contract. Use it to move visual document work out of one-off desktop steps and into repeatable software workflows.

It ships two interchangeable engines: a Community engine that renders supported formats on your machine, and the existing DeckFlow cloud engine with a wider matrix. Run `deckrender formats --engine local|cloud`, or read [the matrices](#supported-formats) below.

```bash
deckrender deck.pptx -o deck.png
deckrender deck.pptx -o deck.pdf
deckrender deck.pptx -o deck.mp4
```

It is to documents what `ffmpeg` is to media: one command, a small set of flags, predictable output. It deliberately does **not** parse content, extract text, or edit files — those belong to other tools in the [DeckFlow](https://github.com/deckflow) family.

## Where it creates value

- **Product previews and delivery** — turn document pages and slides into visual
  artifacts that web and mobile products can display.
- **AI vision pipelines** — create page or slide images for multimodal models
  and document-understanding workflows.
- **Automated publishing** — generate images, PDFs, or videos from scripts and
  CI when the selected input/output route supports them.
- **Review handoffs** — produce concrete visual artifacts that people or agents
  can inspect before downstream delivery.

## Install

```bash
npx -y @deckflow/deckrender@latest deck.pptx
```

```bash
npm install -g @deckflow/deckrender
```

Requires Node.js 18 or newer.

For Community/local rendering, install Chrome or Chromium. DeckRender has one optional converter dependency, `@deckflow/office2html@0.2.1`; that package installs the matching platform runtime. DeckRender does not maintain the platform mapping or bundle/republish the binaries. See [Local engine setup](docs/engines.md#local-engine-setup).

Only the current OS/CPU binary is installed, as selected by `@deckflow/office2html`. Cloud-only and browser-only users can skip optional local dependencies with `npm install --omit=optional @deckflow/deckrender` (add `-g` for the CLI). To enable local rendering later, reinstall with `npm install --include=optional @deckflow/deckrender`. pnpm users can omit local dependencies with `pnpm add --no-optional @deckflow/deckrender`.

For cloud-only installs, npm's `--omit=optional` and pnpm's `--no-optional` leave the converter entry package and its platform runtime uninstalled.

`office2html` is resolved only for local PPTX conversion; cloud, browser, HTML, and PDF routes do not need it. Rendering never runs a package installer or downloads a missing binary automatically.

## Quick start

Render every slide to PNG. With no `-o`, output lands in a directory named after the input:

```bash
$ deckrender presentation.pptx
presentation/
```

```
presentation/
├── 001.png
├── 002.png
└── 003.png
```

Pick a format, a size, and a page range:

```bash
deckrender report.pdf --pages 1-5 --width 2560 -o pages/
deckrender deck.pptx --format pdf -o deck.pdf
deckrender page.html -o screenshot.png
deckrender https://example.com -o screenshot.png
cat page.html | deckrender - --from html -o screenshot.png
```

Machine-readable output for scripts and agents:

```bash
$ deckrender deck.pptx --json
{
  "ok": true,
  "input": "deck.pptx",
  "format": "image",
  "engine": "cloud",
  "route": ["convertor.ppt2image"],
  "pages": 3,
  "outputs": [
    { "page": 1, "file": "presentation/001.png", "width": 1920, "height": 1080, "bytes": 184320 }
  ],
  "durationMs": 8123
}
```

Keep PPTX/PDF/HTML rendering on the machine:

```bash
deckrender config set engine local
deckrender deck.pptx -o frames/
```

Or choose per invocation with `--engine local|cloud|auto`. `auto` is local-first and prints a warning before falling back to cloud; an explicit `local` choice never uploads or silently falls back.

## Supported formats

The table below is the default cloud matrix. Use `deckrender formats --engine local` for the Community matrix.

| Input          | → image | → pdf | → video |
| -------------- | ------- | ----- | ------- |
| `.pptx`        | ✅      | ✅    | ✅      |
| `.ppt`         | ✅      | 🕓    | ✅      |
| `.pdf`         | ✅      | ✅    | 🕓      |
| `.key`         | ✅      | ✅    | 🕓      |
| `.docx`        | ✅      | ✅    | —       |
| `.doc`         | —       | —     | —       |
| `.xlsx`        | 🕓      | 🕓    | —       |
| `.pages`       | 🕓      | 🕓    | —       |
| `.numbers`     | 🕓      | 🕓    | —       |
| `.html` + URLs | ✅      | ✅    | ✅      |
| `.md`          | ✅      | —     | —       |

Image output supports `png`, `jpg` and `webp` via `--image-format`.

**🕓** means the DeckFlow cloud has no converter for it yet; those report `not_implemented` with a message naming the missing backend task — the full list is under [Coming soon](docs/roadmap.md#coming-soon). Unsupported pairs fail with a clear message rather than producing something approximate.

The local matrix currently supports `.pptx → image/pdf`, `.pdf → image/pdf`, and `.html`/URL → image. Local WebP and video are not supported. The two matrices remain independent: choosing `local` never borrows a missing cloud route.

Pages and Numbers are recognized but not renderable yet — DeckRender will not answer with the thumbnail iWork embeds. Export to PDF or PPTX and render that. Keynote `.key` is unaffected.

Legacy Word `.doc` files are not supported. Save them as `.docx` or export them to PDF first.
Legacy PowerPoint `.ppt` files support image and video output; PDF conversion waits on the backend.

Full detail, including which flags each route accepts: [`docs/formats.md`](docs/formats.md).

## Authentication is optional for cloud

DeckRender works with no setup at all — rendering runs in guest mode. Log in when you want higher quotas or a private workspace:

```bash
deckrender auth login
```

Credentials are stored in `~/.deckflow/credentials` and **shared across every DeckFlow CLI**. Log in once through DeckRender and DeckHTML picks it up too, and vice versa. If your machine already has `DECKHTML_API_KEY` set, or you have logged in with the `deckops` CLI, DeckRender uses that automatically.

A credential the backend rejects is treated as no credential: DeckRender drops it and retries the render in guest mode, warning on stderr rather than failing. Rendering is supposed to work with no setup at all, and stale state on a machine should not take that away. See [`docs/errors.md`](docs/errors.md#a-rejected-credential-falls-back-to-guest-mode).

```bash
deckrender config list    # shows every value and exactly where it came from
```

See [`docs/configuration.md`](docs/configuration.md) for the full resolution order.

The local engine does not resolve or send credentials.

## Use it as a library

The CLI and the programmatic API ship in the same package. The root import is the
Node.js API; browser applications use the separate cloud-only entry below.

```ts
import { render } from '@deckflow/deckrender';

const result = await render({
  input: 'deck.pptx',
  engine: 'local',
  format: 'image',
  pages: '1-10',
  out: 'frames/',
});

console.log(result.route); // ['local.office2html', 'local.capture']
console.log(result.outputs); // [{ page: 1, file: 'frames/001.png', ... }]
```

Reuse configuration, or swap in your own render backend:

```ts
import { createRenderer, type RenderEngine } from '@deckflow/deckrender';

const renderer = createRenderer({
  apiKey: process.env.DECKFLOW_API_KEY,
  onWarning: (message) => console.warn(message),
});
```

### Browser applications

```ts
import { createRenderer } from '@deckflow/deckrender/browser';

const renderer = createRenderer({ getToken: () => auth.getDeckFlowToken() });
const result = await renderer.render({ input: file, format: 'image', pages: '1-3' });

previewImage.src = result.outputs[0]!.url;
// When removing the preview:
result.dispose();
```

The SDK accepts `File`, named `Blob`/binary input, and inline HTML/Markdown. It
returns URLs with lazy `blob()` downloads instead of writing files. Rendering is
cloud-only (PDF passthrough stays in memory); no Node polyfills are required.
Use a user token or explicitly opt into `guest: true`, never embed an application
API key. See [Browser SDK](docs/browser.md) for authentication, CORS, and lifecycle details.

## Documentation

|                                        |                                                         |
| -------------------------------------- | ------------------------------------------------------- |
| [Quick start](docs/quickstart.md)      | Install and first render                                |
| [CLI reference](docs/cli.md)           | Every command and flag                                  |
| [Formats](docs/formats.md)             | What converts to what, and the flags each route accepts |
| [Profiles](docs/profiles.md)           | Named flag presets                                      |
| [Configuration](docs/configuration.md) | Credentials, shared auth, render defaults               |
| [Errors](docs/errors.md)               | Error codes and exit codes                              |
| [Roadmap](docs/roadmap.md)             | What is coming and what is blocked upstream             |
| [Engines](docs/engines.md)             | Local/cloud selection, setup, privacy and fidelity       |
| [Browser SDK](docs/browser.md)        | Cloud-only browser entry, inputs, previews, auth and CORS |

## How it works

```
Input (file | URL | stdin)
   → InputResolver     normalize and classify
   → RenderPlan        engine-specific source × target route table
   → LocalEngine       office2html + Chromium + PDF.js
     or CloudEngine    DeckOps tasks
   → ArtifactWriter    page selection, naming, files / directory / zip
   → Result            human text or --json
```

Cloud rendering is performed through [`@deckops/sdk`](https://www.npmjs.com/package/@deckops/sdk). Community rendering uses the bundled local orchestration layer and optional local dependencies. Both share input resolution, artifact naming, errors and the result contract.

### Where rendering happens

| Engine        | Where rendering runs | What leaves your machine |
| ------------- | -------------------- | ------------------------ |
| `local`       | your machine         | no document bytes        |
| `cloud`       | DeckFlow cloud       | source and intermediates |
| `passthrough` | your machine         | nothing                  |

Local PPTX capture blocks the CDN references emitted by `office2html` and uses local CSS/system-font fallbacks. URL input still fetches the URL the user requested, and generic HTML may load its own referenced assets; neither path calls the DeckFlow API. `--json` reports the actual `engine` and route so the boundary is auditable.

Full detail, including chained routes and URL input: [`docs/formats.md`](docs/formats.md#where-rendering-happens).

## Development

Issues and pull requests are welcome. Node.js 18 or newer.

```bash
pnpm install
pnpm check                    # typecheck + lint + unit + integration
pnpm build && pnpm test:e2e   # e2e drives the built binary

DECKRENDER_E2E=1 pnpm test:cloud    # guest render against the live backend
DECKRENDER_LOCAL_E2E=1 pnpm test:local  # real Chrome/PDF.js local routes
pnpm test:conformance              # every format pair; needs credentials
```

The cloud table in `src/core/routes.ts` and local table in `src/engines/local/routes.ts`
decide what converts to what. Probe the corresponding engine before adding a route — several
plausible-looking conversions do not actually work, so a route inferred from type
definitions alone can be wrong. `pnpm test:conformance` confirms the matrix end
to end.

A missing local route stays local-only unsupported and never falls back unless the user explicitly selected `auto`. A missing cloud route remains an upstream DeckOps ask; do not use one matrix to conceal a gap in the other.

The `--json` envelope, error codes, exit codes and the shared credential file
format are what other people's scripts depend on. Changing any of them is a
breaking change; note it in `CHANGELOG.md`.

## License

MIT © DeckFlow
