# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-07

First release.

### Added

- `deckrender <input>` renders a document to images, PDF or video:

  | Input               | → image | → pdf | → video |
  | ------------------- | ------- | ----- | ------- |
  | `.pptx` `.ppt`      | ✅      | ✅    | ✅      |
  | `.pdf`              | ✅      | ✅    | 🕓      |
  | `.key`              | ✅      | ✅    | 🕓      |
  | `.docx` `.doc`      | ✅      | ✅    | —       |
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

[0.1.0]: https://github.com/deckflow/deckrender/releases/tag/v0.1.0
