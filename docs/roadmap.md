# Roadmap

## v0.1 — shipped

- `pptx` `pdf` `key` `docx` `html` `md` and URLs → image and PDF
- `ppt` → image and video
- `pptx` → video
- Cloud engine over `@deckops/sdk`
- Profiles, `--json` envelope, page selection, zip and stdout output
- Credentials shared with DeckHTML and DeckOps; guest mode without login

## Rendering is the cloud's job

DeckRender is a client. Every conversion runs in the DeckFlow cloud, and that is
a deliberate boundary rather than a stage on the way to something else:

- **No local render path.** There is no local engine, and one is not planned.
  The earlier milestone for a `LocalEngine` — Playwright for HTML, pdfium for
  PDF — is dropped, which is why the version numbers below shift up by one.
- **A format the cloud cannot convert is not supported.** It reports
  `not_implemented` and names the missing backend task. The fix is a converter
  upstream, tracked under [Upstream asks](#upstream-asks-for-deckops).
- **No local logic to widen the matrix.** No format is answered with something
  approximate — an embedded thumbnail, a partial extraction — because that is
  easier than waiting for the backend. Supported means the real conversion.

`RendererOptions.engine` still lets a *caller* substitute their own backend. That
is their choice to make; it is not DeckRender shipping one.

Also planned: switch URL input to the backend's `html.getByURL` once it reaches a
published SDK release, for true runtime-DOM capture instead of a local fetch.

## Coming soon

Combinations the CLI marks `soon` and reports as `not_implemented`. Every one is a missing backend task, and every one is fixed upstream:

| Combination             | Blocked on                                                                        |
| ----------------------- | --------------------------------------------------------------------------------- |
| `.ppt` → pdf            | A task that normalizes the legacy binary file to `.pptx` before the PDF converter |
| `.xlsx` → image, pdf    | A spreadsheet converter — a workbook needs a real layout pass                     |
| `.pages` → image, pdf   | A Pages converter                                                                 |
| `.numbers` → image, pdf | A Numbers converter                                                               |
| `.pdf` → video          | A `convertor.pdf2video` task                                                      |
| `.key` → video          | A `convertor.keynote2video` task                                                  |

`.pages` and `.numbers` were briefly answered with the first-page preview every iWork document embeds. That was removed: a thumbnail reported as a successful render is worse than a clear "not yet". They come back when the backend can convert them.

## v0.2 — video parameters

`--fps`, `--duration` and `--transition`. **Blocked upstream**: `convertor.ppt2video` currently accepts no parameters at all (`ConvertPptToVideoParams = Record<never, never>`), so the flags fail today rather than silently rendering backend defaults.

## v0.3 — throughput

- Batch rendering across many inputs
- `--watch`
- Render cache keyed on input hash plus parameter hash

## v1.0 — frozen contracts

The CLI output contract — the `--json` envelope, error codes, exit codes and artifact layout — becomes stable under semver.

The agent-oriented view — images plus element bounding boxes — is composed at the DeckFlow level from DeckProbe's structural output and DeckRender's images. DeckRender will not parse documents to produce it; that would cross the boundary this tool is built around. Its only obligation is that page numbers in `--json` match DeckProbe's.

## Upstream asks for DeckOps

Several limits here are not DeckRender's to fix:

| Ask                                                                                                   | Unlocks                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Fix `@deckops/sdk` `package.json`: `types` points at `./src/index.ts`, which `files` does not publish | Removes the tsconfig `paths` workaround every TypeScript consumer currently needs |
| Publish `html.getByURL` in a released SDK                                                             | Runtime-DOM capture for URL input                                                 |
| Parameters for `convertor.ppt2video` (`fps`, `durationPerSlide`, `transition`)                        | v0.2                                                                              |
| Resolution and format parameters for `convertor.keynote2image`                                        | `--width` and `--image-format jpg` on Keynote input                               |
| Page ranges on conversion tasks                                                                       | Makes `--pages` save compute and cost, not just bandwidth                         |
| Task chaining by upstream task id                                                                     | Removes the download/upload round-trip in every derived route                     |
| A `convertor.html2pdf` task                                                                           | Removes the HTML→PDF fidelity caveat                                             |
| Pages and Numbers converters                                                                          | `.pages` and `.numbers` input                                                    |
| `convertor.pdf2video` and `convertor.keynote2video` tasks                                             | `.pdf` and `.key` to video                                                       |

## Out of scope

DeckRender renders. It does not parse content, extract text, understand structure, or edit files. Those belong to DeckProbe, DeckUse and DeckOps.

It also does not render locally. Bundling a browser, a PDF rasterizer or a format-specific extractor would make this a second renderer competing with the backend, and every format it could reach that way would be one the cloud never got asked to support.

Those boundaries are what keep the CLI small: one command, a document in, pixels out.
