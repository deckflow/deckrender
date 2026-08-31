# Roadmap

## Shipped

### v0.1 — cloud client

- Cloud conversion over `@deckops/sdk`
- Profiles, JSON envelope, page selection, zip/stdout output
- Shared credentials and guest mode

### v0.2 — stricter cloud boundaries

- Unsupported/planned cloud routes are explicit
- Rejected credentials fall back to guest mode
- Runtime validation for SDK inputs and custom engine output

### v0.3 — Community/local engine

- Independent `local` and `cloud` route tables
- `--engine local|cloud|auto`, config and environment selection
- PPTX→image/PDF through `office2html` and Chromium
- PDF→image through PDF.js in Chromium; PDF→PDF passthrough
- HTML/URL→image through Chromium
- Numeric page-order guarantees and post-write temporary cleanup
- Strict local PPTX/PDF boundary: no credential resolution, upload or silent cloud fallback
- Repository-owned `office2html` packages for macOS arm64/x64, Linux x64 and Windows x64, installed by platform

## Engine boundaries

The Community engine sells local capability: engine, CLI and SDK. The cloud tiers sell a managed production system and a wider conversion matrix. One matrix never hides a gap in the other.

- Explicit `local` is strict and never falls back.
- `auto` is local-first and warns before selecting cloud.
- Cloud-only combinations remain upstream DeckOps asks.
- Local-only planned combinations remain upstream `office2html` asks.

See [engines.md](engines.md) for setup and privacy details.

## Next

### Local distribution and offline fidelity

- Add `office2html --version` and machine-readable conversion output.
- Add upstream `office2html --offline` self-contained HTML so the local compatibility CSS/system-font fallback can be retired.
- Add versioned local font/icon assets where licensing permits.
- Extend local routes as `office2html` gains DOCX, XLSX and Keynote support.

### Throughput

- Batch rendering across many inputs
- `--watch`
- Render cache keyed on input hash, engine and normalized parameters
- Reuse a warm browser across safe local batch jobs

### Cloud upstream asks

| Ask | Unlocks |
| --- | ------- |
| Publish a resolvable `@deckops/sdk` successor to 0.7.3 | Remove the current dependency pin and tsconfig declaration workaround |
| Publish `html.getByURL` | Runtime-DOM cloud URL capture |
| Parameters for `convertor.ppt2video` | FPS, duration and transitions |
| Resolution/format parameters for Keynote image output | Keynote sizing and JPEG |
| Page ranges on conversion tasks | Cloud compute savings from `--pages` |
| Task chaining by upstream task id | Remove derived-route download/upload round trips |
| Native HTML→PDF | Remove cloud HTML reconstruction caveat |
| Pages, Numbers, PDF-video and Keynote-video converters | Fill current cloud planned cells |

## v1.0 — frozen contracts

The CLI JSON envelope, error codes, exit codes, engine-selection semantics and artifact layout become stable under semver.

## Out of scope

DeckRender renders. It does not parse document meaning, extract text, understand structure or edit files. Those belong to DeckProbe, DeckUse and DeckOps.
