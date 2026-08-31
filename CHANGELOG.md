# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Refresh all four bundled office2html binaries from the 2026-08-31 build.
- Render the new lazy-slides output directly from its validated, zero-based `slide-meta` manifest. PNG/JPEG and PDF use a bounded four-page worker pool while preserving public one-based page numbers and offline rendering.
- Accept both the new `pages:` and legacy `Slides:` conversion summaries; retain legacy embedded-deck compatibility.

### Fixed

- Prevent the one-based filename assumption in the capture reference from skipping the first slide of zero-based converter output.
- Add real-tarball installation checks proving each supported OS/CPU downloads and installs only one office2html package; unsupported platforms and `--omit=optional` download none.
- Publish platform packages before the main package in the release workflow so optional dependencies are available at install time.

## [0.3.0] - 2026-08-25

### Added

- Community/local engine with independent PPTX→image/PDF, PDF→image/PDF and HTML/URL→image routes.
- `--engine local|cloud|auto`, `DECKRENDER_ENGINE`, and persisted `engine` configuration. `auto` is local-first and warns before choosing cloud; explicit local never uploads or falls back.
- Local PPTX conversion via `office2html`, strict Chromium capture, CJK-safe PDF printing, numeric page merge, and only-selected-page image capture.
- Local PDF rasterization through PDF.js in Chromium, including packaged CMaps and standard fonts.
- Chrome/Chromium and office2html executable resolution with environment/config escape hatches.
- Four repository-owned `@deckflow/office2html-<platform>` optional packages (macOS arm64/x64, Linux x64, Windows x64), with platform metadata and artifact hash verification.
- `deckrender formats --engine ...` and engine-aware JSON capability matrices.

### Changed

- `RenderOptions.engine` accepts built-in engine names. The existing custom-engine API remains compatible through `createRenderer({ engine })`; one-shot `render()` accepts either form, and `customEngine` is available as an unambiguous spelling.
- Local dependencies are optional and kept external to the CLI bundle, so cloud-only installs may use `--omit=optional`.
- Engine artifacts may provide a cleanup callback. The common renderer consumes local files first and then cleans them on success or failure.
- Engine output validation sorts artifacts by numeric page and rejects duplicates, preventing the 1/10/2 filename-order trap.

### Security

- Local PPTX/PDF routes do not resolve credentials or contact the DeckFlow API. The PPTX fast path blocks the CDN references currently emitted by office2html and uses local CSS/system-font fallbacks.

## [0.2.1] - 2026-08-21

### Fixed

- Pin `@deckops/sdk` to `0.7.3`, which is installable. `0.7.4` declares a dependency on
  `@deckflow/presentation@^0.3.5`, and that package is not on npm — so `npm install` and
  `npx @deckflow/deckrender` failed with `E404` for anyone whose cache did not already hold an
  older resolution. The `^0.7.3` range meant every published version of DeckRender inherited this,
  not just the latest. The pin comes off once a resolvable `@deckops/sdk` is released.

## [0.2.0] - 2026-08-21

### Removed

- **Breaking:** the local render path. Rendering happens in the DeckFlow cloud, and only there.
  `.pages` and `.numbers` were the only formats it served, by extracting the first-page preview
  iWork embeds in every document — a thumbnail reported as a successful render. Both now report
  `not_implemented` and name the missing backend converter, and come back when the cloud can
  actually convert them. Supporting a format by approximating it locally hid the gap from the
  backend that should close it.
- **Breaking:** `LocalEngine`, `extractIworkPreview`, `jpegToPdf`, `readJpegSize`,
  `listZipEntries`, `readZipEntry` and `ZipEntryInfo` are no longer exported — they existed only
  to serve that path.
- **Breaking:** `RouteKind` no longer includes `'local'`, and `RenderStepTask` no longer includes
  `'local:iwork-preview'`. `--json` can therefore no longer report `"engine": "local"`; the
  remaining values are `cloud` and `passthrough`.
- **Breaking:** directory-bundle input. iWork can save a document as a directory that Finder
  shows as one file; there is nothing to upload in that shape, and repackaging it here would be
  local logic standing in for a backend that never sees it. It now fails with a `usage_error`
  saying how to re-save the document as a single file.

### Fixed

- A rejected credential no longer fails the render. An invalid credential is not a credential, so
  DeckRender now drops it and retries in guest mode, warning on stderr. Credentials resolve from
  files this tool did not write — `~/.deckops/config.json`, `$DECKHTML_API_KEY` — so a machine set
  up for `deckops` was not in guest mode even when nothing was configured for DeckRender, and an
  expired one turned a render guest mode would have completed into an `auth_error`. Scripts and
  agents saw this where an interactive terminal did not. The `spaceId` is dropped with the
  credential it belongs to, and a `403` naming the caller's own data — a workspace that outlived
  its login — is treated the same way as a `401`. A `402 Payment Required` is never retried: a
  workspace out of balance is a real answer about the account.
- The interactive browser login now answers a refused *guest* request rather than a refused
  credential, so a stale token is retried as a guest instead of interrupting the user for a login.
  `credentialsRejected` is exported.

### Changed

- Guest tasks are started explicitly on the fallback path too, matching the rule that only an
  unauthenticated caller issues `tasks.start` — a task the backend already started rejects a second
  start.
- Drop "any document format" from the tagline, the CLI description and the package description.
  The matrix has real holes and just gained two more; naming the formats that work is the claim
  the tool can actually keep.
- `not_implemented` messages name the missing backend task rather than describing the gap as
  DeckRender's own. Every `soon` cell in the matrix is now an upstream ask.
- `docs/roadmap.md` drops the planned local engine milestone and states the boundary instead:
  DeckRender is a client, a format the cloud cannot convert is not supported, and no local logic
  is added to widen the matrix.


## [0.1.2] - 2026-08-19

### Added

- Name the credential in `auth_error` hints. Credentials resolve from files other DeckFlow
  tools write, so a stale `~/.deckops/config.json` token fails a render that guest mode would
  have completed, with nothing pointing at the file to clean up. The 401 hint now reports which
  credential was sent and where it came from. `describeCredentialOrigin` is exported, and
  `mapSdkError` takes an optional `SdkErrorContext` third argument.
- Document where each route runs. `README.md` and `docs/formats.md` list which routes upload the
  document to the DeckFlow cloud and which stay on the machine, instead of calling the split an
  implementation detail.

### Fixed

- Correct the error examples in `docs/errors.md` and `docs/formats.md`: `.pdf` to video is
  `not_implemented`, not `unsupported_format`, and the `unsupported_option` hint no longer quotes
  a message the CLI does not emit.
- Link the 🕓 matrix entries to the roadmap section listing what blocks each one.

## [0.1.1] - 2026-08-13

### Fixed

- Publish declarations with an explicit Node type reference so strict TypeScript 7 consumers can
  resolve the public `Buffer` APIs without changing their compiler options.
- Validate SDK render options, plan inputs and custom engine output at runtime, returning
  `DeckRenderError` instead of forwarding invalid values or exposing Node argument errors.
- Isolate DeckRender, DeckFlow and DeckOps configuration plus credential environment variables in
  CLI end-to-end tests.
- Correct the legacy Office support matrix: `.doc` is unsupported, while `.ppt` supports image and
  video output; `.ppt` to PDF remains planned pending a `.pptx` normalization step.

## [0.1.0] - 2026-08-07

First release.

### Added

- `deckrender <input>` renders a document to images, PDF or video:

  | Input               | → image | → pdf | → video |
  | ------------------- | ------- | ----- | ------- |
  | `.pptx`             | ✅      | ✅    | ✅      |
  | `.ppt`              | ✅      | 🕓    | ✅      |
  | `.pdf`              | ✅      | ✅    | 🕓      |
  | `.key`              | ✅      | ✅    | 🕓      |
  | `.docx`             | ✅      | ✅    | —       |
  | `.doc`              | —       | —     | —       |
  | `.xlsx`             | 🕓      | 🕓    | —       |
  | `.pages` `.numbers` | ✅      | ✅    | —       |
  | `.html` and URLs    | ✅      | ✅    | ✅      |
  | `.md`               | ✅      | —     | —       |

- Input from a file, an `http(s)` URL, or stdin. iWork documents are accepted
  both as a single file and as the directory bundle Finder shows as one document.
- Page selection (`--pages`, `--page`), sizing (`--width`, `--scale`), encoding
  (`--image-format png|jpg|webp`) and `--quality` presets.
- Profiles: `web`, `presentation`, `print`, `thumbnail`.
- Output as a directory, a single file, numbered frames, a zip, or stdout.
- `--json` result envelope, `--quiet`, `--verbose`, and exit codes 0/1/2/3.
- `deckrender formats` prints the support matrix; `--json` adds the detail
  tooling needs.
- Credentials shared with the other DeckFlow CLIs through
  `~/.deckflow/credentials`, resolved through a five-level chain that
  `deckrender config list` reports the source of.
- Guest mode: rendering works with no credentials at all. A `401` triggers
  browser login and retries the request.
- Programmatic API (`render`, `createRenderer`) exported from the same package.

### Notes

- Pages and Numbers render the preview embedded in the document, which covers
  the **first page only**. Everything else renders in full.
- HTML to PDF and video is laid out as slides rather than by a browser. The
  result carries a `caveat` in `--json` and a warning on stderr.
- 🕓 combinations report `not_implemented` with a message naming what is
  blocking them, so "not yet" is distinguishable from "never".
- An option the backend cannot honour fails with `unsupported_option` instead of
  being silently dropped — rendering something other than what was asked for is
  worse than an error. Values inherited from a profile or config file are the
  exception: those are dropped with a warning.
- `--fps`, `--duration` and `--transition` are not accepted yet; there are no
  video parameters to map them onto.

### Verification

Every combination in the matrix above was confirmed end to end against the live
backend by `scripts/conformance.mjs`, which renders real documents through every
output and diffs the result against the documented matrix. Several conversions
that looked plausible from the type definitions turned out not to work, so the
matrix reflects measurement rather than inference.

[Unreleased]: https://github.com/deckflow/deckrender/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/deckflow/deckrender/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/deckflow/deckrender/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/deckflow/deckrender/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/deckflow/deckrender/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/deckflow/deckrender/releases/tag/v0.1.0
