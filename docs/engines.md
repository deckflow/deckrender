# Render engines

DeckRender exposes one CLI and SDK contract over two independent engines.

| Engine  | Intended use | Supported routes |
| ------- | ------------ | ---------------- |
| `local` | Community, private/offline document rendering | PPTX→image/PDF, PDF→image/PDF, HTML/URL→image |
| `cloud` | Broad format support and the managed DeckFlow production system | See `deckrender formats --engine cloud` |
| `auto`  | Local-first convenience | Uses local when that exact route exists; otherwise warns and uses cloud |

The default remains `cloud` for compatibility with releases before 0.3. Set the Community default once with:

```bash
deckrender config set engine local
```

Selection precedence is:

```text
--engine > DECKRENDER_ENGINE > ~/.deckrender/config.json > cloud
```

An explicit `--engine local` is a privacy boundary. Missing formats and runtime failures are returned as errors; they never trigger a cloud retry. `auto` is the only mode that may choose cloud, and it emits a warning before doing so.

## Local engine setup

Local image/PDF routes use:

- `office2html` for PPTX→HTML;
- Chrome or Chromium driven by `playwright-core` for HTML capture and PDF printing;
- PDF.js in the same browser for PDF→image;
- `pdf-lib` for numeric-order PDF page merging.

`playwright-core`, `pdfjs-dist`, `pdf-lib`, and the four repository-owned `office2html` platform packages are optional dependencies so cloud-only installations may use `--omit=optional`. Package managers install only the `office2html` package matching the current OS/CPU. Reinstall without `--omit=optional` before using local rendering.

```bash
# No office2html binary or other optional local dependencies:
npm install -g --omit=optional @deckflow/deckrender
```

The main npm tarball does not contain any platform binaries. Four package declarations do not mean four downloads: each platform package is guarded by `os` / `cpu`. The repository's pnpm workspace may link all four local directories for development; a registry installation downloads only its matching binary. See [platform packaging and release checks](../packages/README.md).

Chrome/Chromium resolution order:

```text
--executable-path
> DECKRENDER_CHROMIUM_EXECUTABLE_PATH
> an existing Playwright browser cache
> standard Chrome/Chromium/Edge installation paths
> PATH
```

`playwright-core` does not download a browser. Install Chrome/Chromium yourself when none is present.

`office2html` resolution order:

```text
config office2html-path
> DECKRENDER_OFFICE2HTML_PATH
> bundled @deckflow/office2html-<platform> package
> PATH
```

All four binary packages live under `packages/` in this open-source repository and are part of the same release. Their package manifests constrain `os` and `cpu`, while `scripts/verify-office2html.mjs` pins every artifact's size and SHA-256 digest. An explicit binary override remains available for enterprise mirrors or custom builds:

```bash
deckrender config set office2html-path /opt/deckflow/office2html
```

## office2html output contract

The 2026-08-31 binary defaults to a lazy-slides deck: `index.html` is a player shell and each slide is a separate HTML file. DeckRender calls `office2html input.pptx -o output/`, reads the `slide-meta` manifest, and renders the referenced slide documents directly. In this build `slides/0000.html` is the first page: metadata indexes are zero-based, while all DeckRender page numbers remain one-based. Do not infer page numbers by counting files or copy a one-based `0001.html` assumption from a standalone capture example.

The converter's new `pages: N, assets: M` summary and the legacy `Slides: N, assets: M` summary are both recognized. Legacy single-file decks remain supported for binary overrides. DeckRender does not pass `--no-player` (which disables the lazy layout), or forward `--pages` to the converter (which reports only the filtered count); image selection happens against the validated complete manifest.

Standalone capture and PDF printing share a worker pool capped at four pages, fixed slide bounds, animation freezing, local asset/font settling, and strict local request interception. Results are written directly to temporary files and emitted in numeric page order. Workers finish or fail before their shared browser context and temporary files are cleaned up.

## Privacy and network boundary

Local PPTX and PDF routes do not call DeckFlow and do not upload document bytes. They also do not resolve cloud credentials.

`office2html` currently emits references to Tailwind CDN, Google Fonts, and Font Awesome. DeckRender blocks those requests on the PPTX fast path, injects a local utility-CSS compatibility layer, and uses installed system fonts, including explicit CJK fallback for Chromium PDF printing. This keeps rendering local but means a missing local font/icon can differ from a cloud render. The long-term upstream fix is a self-contained `office2html --offline` output.

HTML/URL capture is different: URL input must fetch the requested URL, and HTML may intentionally reference remote assets. It still does not contact the DeckFlow rendering API. Callers needing air-gapped generic HTML should make the HTML and its assets self-contained.

## Output and lifecycle guarantees

Both engines share the same `--json` envelope, error/exit codes, output naming, zip/stdout behavior, and 1-based numeric page identifiers. Local temporary artifacts remain available until the common writer has copied them, then are removed on success or failure.

Every multi-page path sorts by numeric `RenderArtifact.page`, never by filename. A 12-page selection therefore remains `1, 2, …, 10, 11, 12`, regardless of temporary names.

Local PDF output is printed from the `office2html` HTML deck and merged page-by-page. Text remains selectable, but Office effects, font metrics, and PDF.js rasterization can differ from the managed cloud pipeline. These differences are surfaced as `caveat` in JSON and warnings on stderr.

## SDK

```ts
import { render } from '@deckflow/deckrender';

const result = await render({
  input: 'deck.pptx',
  engine: 'local',
  format: 'image',
  pages: '1-5',
  out: 'frames/',
});
```

The existing custom-engine API remains compatible:

```ts
const renderer = createRenderer({ engine: myRenderEngine });
```

For the one-shot `render()` helper, `engine` accepts either a built-in engine name or the legacy custom `RenderEngine` object. `customEngine` is also available on `RendererOptions` when a less overloaded spelling is preferred.

A renderer already constructed with a custom engine rejects a second built-in engine name on `.render()`: the two authorities are mutually exclusive, which prevents a contradictory `local` label from being handed to a cloud custom engine.
