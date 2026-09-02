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

`playwright-core`, `pdfjs-dist`, `pdf-lib`, and `@deckflow/office2html` are optional dependencies. DeckRender depends only on that converter entry package; it owns platform detection and installs the matching runtime through its optional dependencies. An unsupported platform installs no official binary; cloud, browser, HTML, and PDF routes do not require `office2html`.

```bash
# No office2html binary or other optional local dependencies:
npm install -g --omit=optional @deckflow/deckrender

# Enable local dependencies later, including only this machine's binary:
npm install -g --include=optional @deckflow/deckrender

# The equivalent lightweight installation with pnpm:
pnpm add -g --no-optional @deckflow/deckrender
# Enable local dependencies again:
pnpm add -g @deckflow/deckrender
```

Both npm's `--omit=optional` and pnpm's `--no-optional` leave the converter entry package and its platform runtime uninstalled.

For an SDK project, omit `-g`. If you only need local HTML or PDF rendering, start with `--omit=optional` and explicitly add the required libraries (for example `npm install --omit=optional playwright-core@1.55.1` for HTML capture; add `pdfjs-dist@4.8.69` for PDF rasterization). This does not install `office2html`.

The main npm tarball contains no platform binaries, and source checkouts use the same registry dependencies as consumers. No install hook or render operation runs an installer. Do not configure pnpm's `supportedArchitectures` for extra platforms unless a multi-platform installation is intentional.

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
> @deckflow/office2html getBinaryPath()
> PATH
```

The tested upstream entry package is pinned to `0.2.1`, independently of DeckRender's version. DeckRender calls its public `getBinaryPath()` API and does not know platform package names or binary layouts. The entry package also exposes the `office2html` CLI.

If optional dependencies were omitted, reinstall DeckRender with `--include=optional`, or explicitly add `@deckflow/office2html@0.2.1` to the SDK project. Other local libraries must also be present for the chosen route.

Explicit paths and `PATH` remain available for enterprise mirrors, offline installations, custom builds, or platforms without an official package:

```bash
deckrender config set office2html-path /opt/deckflow/office2html
```

Missing local dependencies produce an actionable error when the relevant route is used; DeckRender does not install them in the background or fall back to cloud.

### Dependency and release checks

`pnpm verify:office2html` validates that DeckRender declares exactly one pinned converter entry package, checks its lockfile integrity, and exercises the installed package's public `getBinaryPath()` API. CI adds `--require-installed` so a failed optional runtime install cannot silently pass. Versions and tarball integrity come from the upstream npm release and `pnpm-lock.yaml`, not repository-owned binary copies.

`pnpm build && pnpm test:packaging` verifies the published wrapper tarball and its public API/CLI contract, then tests native and cloud-only DeckRender installs with npm and pnpm. Platform-routing correctness belongs to `@deckflow/office2html`; DeckRender's release test deliberately does not duplicate that package's platform table. It also checks both DeckRender tarballs contain no binaries, direct platform-package dependencies, or workspace references. It never publishes packages; the release workflow publishes only DeckRender. Set `KEEP_PACKAGING_ARTIFACTS=1` to retain the test's temporary files.

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
