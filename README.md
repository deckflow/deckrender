# DeckRender

> Render any document format into visual artifacts.

DeckRender is a pure render engine. Give it a document, get back pixels — images, a PDF, or a video. Nothing else.

```bash
deckrender deck.pptx -o deck.png
deckrender deck.pptx -o deck.pdf
deckrender deck.pptx -o deck.mp4
```

It is to documents what `ffmpeg` is to media: one command, a small set of flags, predictable output. It deliberately does **not** parse content, extract text, or edit files — those belong to other tools in the [DeckFlow](https://github.com/deckflow) family.

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

| Input                   | → image  | → pdf      | → video    |
| ----------------------- | -------- | ---------- | ---------- |
| `.pptx` `.ppt`          | ✅       | ✅         | ✅         |
| `.pdf`                  | ✅       | copy       | 🕓         |
| `.key`                  | ✅       | ✅         | 🕓         |
| `.docx` `.doc`          | chained  | ✅         | —          |
| `.xlsx`                 | 🕓       | 🕓         | —          |
| `.pages`                | local ⚠️ | local ⚠️   | —          |
| `.numbers`              | local ⚠️ | local ⚠️   | —          |
| `.html` `.htm` and URLs | ✅       | chained ⚠️ | chained ⚠️ |
| `.md`                   | ✅       | —          | —          |

Image output supports `png`, `jpg` and `webp` via `--image-format`.

**local** runs on this machine with no network — Pages and Numbers have no cloud converter, so DeckRender extracts the preview embedded in the document (first page only). **🕓** is planned but not built; those report `not_implemented` with a message naming what is blocking them.

"chained" means DeckRender runs more than one backend task — slower, and sometimes with a fidelity note. Every render reports the exact task chain it used in `--json`'s `route` field, so nothing is hidden. Unsupported pairs fail with a clear message rather than producing something approximate.

Full detail, including which flags each route accepts: [`contracts/render-matrix.md`](contracts/render-matrix.md).

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

Rendering always runs in the DeckFlow cloud today. A local engine (Playwright for HTML, pdfium for PDF) is planned for v0.2 — the `RenderEngine` seam is already in place, so adding it will not disturb the rest of the pipeline.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
pnpm install
pnpm check     # typecheck + lint + unit + integration
pnpm build && pnpm test:e2e

# Optional: exercise the real guest cloud path
DECKRENDER_E2E=1 pnpm test:cloud
```

## License

MIT © DeckFlow
