# Roadmap

## v0.1 — shipped

- `pptx` `ppt` `pdf` `key` `docx` `doc` `html` `md` and URLs → image and PDF
- `pptx` `ppt` → video
- Cloud engine over `@deckops/sdk`
- Profiles, `--json` envelope, page selection, zip and stdout output
- Credentials shared with DeckHTML and DeckOps; guest mode without login

## v0.2 — local engine

`LocalEngine`: Playwright for HTML, pdfium for PDF. The `RenderEngine` interface is already the only thing the pipeline talks to, so this is an additive change.

How engine selection is exposed is deliberately undecided. v0.1 removed the `--mode` flag rather than shipping a switch with one working position; the flag returns only once there is a second engine to switch to.

This also replaces the chained `html → pdf` route with a native `page.pdf()`, removing today's fidelity caveat.

Also planned: switch URL input to the backend's `html.getByURL` once it reaches a published SDK release, for true runtime-DOM capture instead of a local fetch.

## Coming soon

Combinations the CLI marks `soon` and reports as `not_implemented`:

| Combination          | Blocked on                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.xlsx` → image, pdf | A spreadsheet layout engine. DeckOps has no converter, and a workbook needs a real layout pass — not something to fake from an embedded preview. |
| `.pdf` → video       | Local frame assembly (ffmpeg), not bundled.                                                                                                      |
| `.key` → video       | Local frame assembly (ffmpeg), not bundled.                                                                                                      |

`.pages` and `.numbers` reached coverage a different way: they have no cloud converter either, but every iWork document embeds a first-page `preview.jpg`, and extracting that needs only a ZIP reader. That ships today as the `local` engine, labelled as a preview rather than a render. A real renderer for them stays on this list in spirit — the preview is a floor, not the goal.

## v0.3 — video parameters

`--fps`, `--duration` and `--transition`. **Blocked upstream**: `convertor.ppt2video` currently accepts no parameters at all (`ConvertPptToVideoParams = Record<never, never>`), so the flags fail today rather than silently rendering backend defaults.

## v0.4 — throughput

- Batch rendering across many inputs
- `--watch`
- Render cache keyed on input hash plus parameter hash

## v1.0 — frozen contracts

`contracts/` becomes stable under semver.

The agent-oriented view — images plus element bounding boxes — is composed at the DeckFlow level from DeckProbe's structural output and DeckRender's images. DeckRender will not parse documents to produce it; that would cross the boundary this tool is built around. Its only obligation is that page numbers in `--json` match DeckProbe's.

## Upstream asks for DeckOps

Several limits here are not DeckRender's to fix:

| Ask                                                                                                   | Unlocks                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Fix `@deckops/sdk` `package.json`: `types` points at `./src/index.ts`, which `files` does not publish | Removes the tsconfig `paths` workaround every TypeScript consumer currently needs |
| Publish `html.getByURL` in a released SDK                                                             | Runtime-DOM capture for URL input                                                 |
| Parameters for `convertor.ppt2video` (`fps`, `durationPerSlide`, `transition`)                        | v0.3                                                                              |
| Resolution and format parameters for `convertor.keynote2image`                                        | `--width` and `--image-format jpg` on Keynote input                               |
| Page ranges on conversion tasks                                                                       | Makes `--pages` save compute and cost, not just bandwidth                         |
| Task chaining by upstream task id                                                                     | Removes the download/upload round-trip in every derived route                     |
| A `convertor.html2pdf` task                                                                           | Removes the HTML→PDF fidelity caveat without waiting for the local engine         |

## Out of scope

DeckRender renders. It does not parse content, extract text, understand structure, or edit files. Those belong to DeckProbe, DeckUse and DeckOps.

Those boundaries are what keep the CLI small: one command, a document in, pixels out.
