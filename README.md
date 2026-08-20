# DeckRender

> One command from documents to pixels.

DeckRender turns supported document and web inputs into images, PDFs, or videos through one predictable CLI and TypeScript contract. Use it to move visual document work out of one-off desktop steps and into repeatable software workflows.

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

## Supported formats

```bash
deckrender formats
```

| Input          | → image | → pdf | → video |
| -------------- | ------- | ----- | ------- |
| `.pptx`        | ✅      | ✅    | ✅      |
| `.ppt`         | ✅      | 🕓    | ✅      |
| `.pdf`         | ✅      | ✅    | 🕓      |
| `.key`         | ✅      | ✅    | 🕓      |
| `.docx`        | ✅      | ✅    | —       |
| `.doc`         | —       | —     | —       |
| `.xlsx`        | 🕓      | 🕓    | —       |
| `.pages`       | ✅      | ✅    | —       |
| `.numbers`     | ✅      | ✅    | —       |
| `.html` + URLs | ✅      | ✅    | ✅      |
| `.md`          | ✅      | —     | —       |

Image output supports `png`, `jpg` and `webp` via `--image-format`.

**🕓** is planned but not built; those report `not_implemented` with a message naming what is blocking them — the full list is under [Coming soon](docs/roadmap.md#coming-soon). Unsupported pairs fail with a clear message rather than producing something approximate.

Pages and Numbers render their embedded first-page preview — see [`docs/formats.md`](docs/formats.md) for that and the other per-format notes.

Legacy Word `.doc` files are not supported. Save them as `.docx` or export them to PDF first.
Legacy PowerPoint `.ppt` files support image and video output; PDF conversion is still planned.

Full detail, including which flags each route accepts: [`docs/formats.md`](docs/formats.md).

## Authentication is optional

DeckRender works with no setup at all — rendering runs in guest mode. Log in when you want higher quotas or a private workspace:

```bash
deckrender auth login
```

Credentials are stored in `~/.deckflow/credentials` and **shared across every DeckFlow CLI**. Log in once through DeckRender and DeckHTML picks it up too, and vice versa. If your machine already has `DECKHTML_API_KEY` set, or you have logged in with the `deckops` CLI, DeckRender uses that automatically.

```bash
deckrender config list    # shows every value and exactly where it came from
```

See [`docs/configuration.md`](docs/configuration.md) for the full resolution order.

## Use it as a library

The CLI and the programmatic API ship in the same package.

```ts
import { render } from '@deckflow/deckrender';

const result = await render({
  input: 'deck.pptx',
  format: 'image',
  pages: '1-10',
  out: 'frames/',
});

console.log(result.route); // ['convertor.ppt2image']
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

## How it works

```
Input (file | URL | stdin)
   → InputResolver     normalize and classify
   → RenderPlan        route table: source × target → ordered backend tasks
   → RenderEngine      pluggable; v0.1 ships the cloud engine
   → ArtifactWriter    page selection, naming, files / directory / zip
   → Result            human text or --json
```

Rendering is performed by [`@deckops/sdk`](https://www.npmjs.com/package/@deckops/sdk). DeckRender contributes the input model, the render routing, artifact naming, and a stable output contract.

### Where rendering happens

**Most rendering runs in the DeckFlow cloud**: the document is uploaded over HTTPS, converted there, and the artifacts are downloaded back. Two routes never send anything anywhere:

| Route                            | Where          | What leaves your machine                         |
| -------------------------------- | -------------- | ------------------------------------------------ |
| `.pages` `.numbers` → image, pdf | your machine   | nothing — the embedded preview is extracted here |
| `.pdf` → pdf                     | your machine   | nothing — the file is copied as-is               |
| everything else in the matrix    | DeckFlow cloud | the document, and any intermediate artifact      |

`--json` reports the `engine` that ran — `cloud`, `local` or `passthrough` — so you can check rather than assume. What DeckFlow does with an uploaded document is the cloud service's policy, not this client's. If your documents cannot leave your machine, settle that before adopting DeckRender; a local engine is on the [roadmap](docs/roadmap.md) but not here yet.

Full detail, including chained routes and URL input: [`docs/formats.md`](docs/formats.md#where-rendering-happens).

## Development

Issues and pull requests are welcome. Node.js 18 or newer.

```bash
pnpm install
pnpm check                    # typecheck + lint + unit + integration
pnpm build && pnpm test:e2e   # e2e drives the built binary

DECKRENDER_E2E=1 pnpm test:cloud    # guest render against the live backend
pnpm test:conformance              # every format pair; needs credentials
```

The route table in `src/core/routes.ts` decides what converts to what. Probe the
backend before adding to it — several plausible-looking conversions do not
actually work, so a route inferred from type definitions alone can be wrong.
`pnpm test:conformance` confirms the matrix end to end.

The `--json` envelope, error codes, exit codes and the shared credential file
format are what other people's scripts depend on. Changing any of them is a
breaking change; note it in `CHANGELOG.md`.

## License

MIT © DeckFlow
