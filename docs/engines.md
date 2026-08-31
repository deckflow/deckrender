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

`playwright-core`, `pdfjs-dist`, `pdf-lib`, and the upstream `@deckflow/office2html-*` npm packages are optional dependencies. npm/pnpm use the platform packages' `os` / `cpu` metadata to install only the current platform's binary. An unsupported platform installs no official binary; cloud, browser, HTML, and PDF routes do not require `office2html`.

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

With pnpm 9.15, a fresh `--no-optional` installation can still download the current platform tarball while resolving its lockfile, even though no platform package is installed. To guarantee no binary downloads, use npm's `--omit=optional`, or `pnpm install --frozen-lockfile --no-optional` in a project with an up-to-date lockfile. Both pnpm paths are covered by the installation test below.

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
> installed upstream @deckflow/office2html-<platform> package
> PATH
```

The tested upstream version is pinned to `0.1.0`, independently of DeckRender's version. These upstream packages contain a root-level executable and do not declare an npm `bin` entry, so DeckRender resolves the file directly instead of relying on a `node_modules/.bin` shim. Legacy packages with a `bin` entry or `bin/` layout remain supported.

| Platform | npm package | Executable inside package |
| --- | --- | --- |
| macOS arm64 | `@deckflow/office2html-darwin-arm64` | `office2html` |
| macOS x64 | `@deckflow/office2html-darwin-x64` | `office2html` |
| Linux x64 | `@deckflow/office2html-linux-x64` | `office2html` |
| Windows x64 | `@deckflow/office2html-win32-x64` | `office2html.exe` |

If optional dependencies were omitted, reinstall DeckRender with `--include=optional`, or explicitly install just the matching platform package in the SDK project, for example `npm install --omit=optional @deckflow/office2html-darwin-arm64@0.1.0`. Other local libraries must also be present for the chosen route. Installing a platform package globally does not create an `office2html` command because upstream does not declare `bin`; use a normal DeckRender install or configure the executable's absolute path.

Explicit paths and `PATH` remain available for enterprise mirrors, offline installations, custom builds, or platforms without an official package:

```bash
deckrender config set office2html-path /opt/deckflow/office2html
```

Missing local dependencies produce an actionable error when the relevant route is used; DeckRender does not install them in the background or fall back to cloud.

### Dependency and release checks

`pnpm verify:office2html` validates the four pinned dependency declarations, their lockfile integrity/platform metadata, and the current platform package if installed. CI adds `--require-installed` so a failed optional download cannot silently pass. Versions and tarball integrity come from the upstream npm release and `pnpm-lock.yaml`, not repository-owned binary copies.

`pnpm build && pnpm test:packaging` downloads the four pinned upstream tarballs for verification, checks their integrity, and uses an isolated loopback registry to test nine installation scenarios: npm's four platforms, unsupported platform, and optional omission, plus pnpm's native install and fresh/frozen optional omission. Those cross-platform downloads are a release test only; normal installs download just the current platform. The test also checks both npm and pnpm DeckRender tarballs contain no binaries or workspace references. It never publishes packages; the release workflow publishes only DeckRender. Set `KEEP_PACKAGING_ARTIFACTS=1` to retain the test's temporary files.

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
