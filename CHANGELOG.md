# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-07

First release.

### Added

- `deckrender <input>` renders PPTX, PPT, PDF, Keynote, DOCX, DOC, HTML, Markdown
  and URLs to images or PDF; PPTX and PPT also render to video.
- Route table with `direct`, `derived`, `passthrough` and `local` classes. Chained
  routes report every backend task in `--json`'s `route` field.
- `html` renders to video through `html2pptx → ppt2video`, verified end to end.
- `.pages` and `.numbers` render through a zero-dependency local engine that
  extracts the document's embedded first-page preview, since DeckOps has no
  converter for either format. Both the single-file and directory-bundle shapes
  iWork writes are accepted. `--format pdf` wraps the JPEG in a single-page PDF.
- `not_implemented` error code for combinations that are planned but not built
  (`.xlsx` to image/pdf, `.pdf` and `.key` to video). `deckrender formats` marks
  these `soon`, so "not yet" is distinguishable from "never".
- Page selection (`--pages`, `--page`), sizing (`--width`, `--scale`),
  encoding (`--image-format png|jpg|webp`) and `--quality` presets.
- Profiles: `web`, `presentation`, `print`, `thumbnail`.
- Output layouts: directory, single file, templated frames, zip, stdout.
- `--json` result envelope, `--quiet`, `--verbose`, and exit codes 0/1/2/3.
- Credentials shared with DeckHTML and DeckOps through `~/.deckflow/credentials`,
  with a five-level resolution chain and `config list` source reporting.
- Guest mode: rendering works with no credentials; a 401 triggers browser login
  and retries the request.
- Pluggable `RenderEngine` interface; the cloud engine over `@deckops/sdk` is the
  only implementation in this release.
- Programmatic API (`render`, `createRenderer`) exported from the same package.

### Verification

- `scripts/conformance.mjs` renders every file in `tests/test-data/` through every
  output format against the live backend and diffs the result against the
  documented matrix. All 24 combinations match.

### Notes

- Options the backend cannot honour fail with `unsupported_option` rather than
  being silently ignored. Values inherited from a profile or config file are
  dropped with a warning instead.
- There is no `--mode` flag. Rendering runs in the DeckFlow cloud. The
  `RenderEngine` interface is in place for the local engine, but a switch with
  only one working position is not worth exposing.
- `html -> pdf` routes through PPTX and carries a fidelity caveat. A native path
  arrives with the local engine.
- `--fps`, `--duration` and `--transition` fail: the backend video task accepts
  no parameters.

[0.1.0]: https://github.com/deckflow/deckrender/releases/tag/v0.1.0
