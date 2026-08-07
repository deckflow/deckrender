# Contract: Render Matrix

> Frozen contract. Changing anything here is a breaking change for the scripts and tools that depend on it.

Every route below is backed either by a task type that exists in `@deckops/sdk` or by an engine that runs on this machine. Absence from this document is the definition of `unsupported_format`.

Verified against `@deckops/sdk@0.7.3` and confirmed end to end by `scripts/conformance.mjs`, which renders every file in `tests/test-data/` through every output.

## Matrix

| Input                   | → image                            | → pdf                              | → video                              |
| ----------------------- | ---------------------------------- | ---------------------------------- | ------------------------------------ |
| `.pptx` `.ppt`          | `convertor.ppt2image` · direct     | `convertor.ppt2pdf` · direct       | `convertor.ppt2video` · direct       |
| `.pdf`                  | `convertor.pdf2image` · direct     | passthrough                        | 🕓 planned                           |
| `.key`                  | `convertor.keynote2image` · direct | `convertor.keynote2pdf` · direct   | 🕓 planned                           |
| `.docx` `.doc`          | `doc2pdf → pdf2image` · derived    | `convertor.doc2pdf` · direct       | ✗                                    |
| `.xlsx`                 | 🕓 planned                         | 🕓 planned                         | ✗                                    |
| `.pages`                | `local:iwork-preview` ⚠️           | `local:iwork-preview` ⚠️           | ✗                                    |
| `.numbers`              | `local:iwork-preview` ⚠️           | `local:iwork-preview` ⚠️           | ✗                                    |
| `.html` `.htm` and URLs | `convertor.html2png` · direct      | `html2pptx → ppt2pdf` · derived ⚠️ | `html2pptx → ppt2video` · derived ⚠️ |
| `.md`                   | `convertor.markdown2png` · direct  | ✗                                  | ✗                                    |

Route classes:

- **direct** — one backend task.
- **derived** — several. Reported in `--json`'s `route` and announced on stderr.
- **passthrough** — already in the target format; copied without re-rendering.
- **local** — runs on this machine, no network, no credentials.
- **🕓 planned** — `not_implemented`. See [Planned, not built](#planned-not-built).
- **✗** — `unsupported_format`. No path exists and none is planned.

Image output additionally supports `--image-format png|jpg|webp` on every non-local route; `webp` appends a per-frame `image.convertWebp` step.

## Derived chains

Chained routes round-trip through storage: DeckOps offers no way to feed one task's output into another by id, so DeckRender downloads the intermediate artifact and re-uploads it. `files.upload` hashes first and the backend deduplicates, so repeated renders of the same intermediate do not re-transfer bytes.

`image.convertWebp` runs **once per frame**, at concurrency 4. A 40-slide deck rendered to webp creates 41 tasks. Page selection is applied _before_ this step, so `--pages 1-2` on a 40-page deck creates 3 tasks, not 41.

### ⚠️ html → pdf and html → video

Both rebuild the HTML as PPTX first, so layout is constrained by the slide model — the video is a slideshow of the reconstructed page, not a capture of the live document. Both report a `caveat` in `--json` and a warning on stderr. Native HTML rendering arrives with the browser engine on the roadmap.

### ⚠️ local:iwork-preview

DeckOps has no converter for Pages or Numbers. Every iWork document embeds a `preview.jpg` of its **first page**, and extracting it needs nothing but a ZIP reader — so DeckRender does that rather than refusing the format outright.

This is a preview, not a render:

- one page, whatever the document's length;
- whatever resolution iWork saved, so `--width`, `--scale` and `--quality` have nothing to act on;
- `--image-format webp` is not available, since there is no local image converter.

For `--format pdf` the JPEG is wrapped in a single-page PDF through the `DCTDecode` filter — a container swap, not a re-encode.

Both shapes iWork writes are accepted: a single ZIP file, and a directory bundle (which Finder shows as one document). A document saved without a preview fails with `conversion_error` and instructions for re-saving.

`.key` does **not** use this path: Keynote has real cloud converters, so it renders every slide.

### URLs

A URL is fetched by DeckRender, given a `<base href>` so relative assets still resolve, and passed to the backend as inline HTML. Scripts still execute — the backend renders the HTML in a browser.

The DeckOps source tree has an `html.getByURL` task that would capture the runtime DOM server-side, but it is **not in the published SDK** (`DECK_TASK_TYPES` in `dist/index.d.ts` omits it).

## Planned, not built

These raise `not_implemented` with a "coming soon" message naming what blocks them, rather than the flat `unsupported_format`:

| Combination          | Blocked on                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.xlsx` → image, pdf | Spreadsheet layout engine. DeckOps has no converter, and rendering a workbook locally needs a real layout pass. |
| `.pdf` → video       | Local frame assembly (ffmpeg), not bundled.                                                                     |
| `.key` → video       | Local frame assembly (ffmpeg), not bundled.                                                                     |

Everything else missing from the matrix is `unsupported_format`: no backend task, no lightweight local path, and no plan to add one.

## Per-route option support

Which flags a route accepts is determined by the task that actually produces the image — for chained routes, the last one. This is why `docx → image` accepts `--width` (the knob belongs to `convertor.pdf2image` at the end of the chain) while `docx → pdf` cannot.

| Image producer            | `--width` / `--scale`        | `--image-format` | `--pages`      |
| ------------------------- | ---------------------------- | ---------------- | -------------- |
| `convertor.ppt2image`     | ✅ snapped to 1080/1920/2560 | ✅ png, jpg      | ✅             |
| `convertor.pdf2image`     | ✅ any pixel value           | ✅ png, jpg      | ✅             |
| `convertor.keynote2image` | ✗ task takes no parameters   | ✗ png only       | ✅             |
| `convertor.html2png`      | ✅ `width` + `scale`         | ✗ png only       | ✗ single image |
| `convertor.markdown2png`  | ✅ `pageWidth` + `scale`     | ✗ png only       | ✗ single image |
| `local:iwork-preview`     | ✗ preview is a fixed raster  | ✗ jpg only       | ✗ single image |

Non-image targets accept none of these. `--quality` is an alias for a (resolution, encoding) pair and therefore applies to image routes only.

## Options with no backend support

These raise `unsupported_option` rather than being silently ignored:

| Flag                                | Why                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `--fps` `--duration` `--transition` | `ConvertPptToVideoParams = Record<never, never>` — the video task accepts nothing           |
| `--quality` on pdf/video            | `ConvertPptToPdfParams`, `ConvertDocToPdfParams`, `ConvertKeynoteToPdfParams` are all empty |
| `--width` `--scale` on `.key`       | `ConvertKeynoteToImageParams = Record<never, never>`                                        |
| `--pages` on single-file output     | pdf and video are one file                                                                  |
| `--image-format svg`                | No DeckOps task emits SVG; the value is not offered                                         |

An option supplied by a **profile or config file** rather than typed on the command line is dropped with a warning instead of failing. Only an explicit choice produces an error.

## Page selection

`--pages` filters at download time. The backend still renders every page, because no DeckOps conversion task accepts a page range. It saves bandwidth and disk, **not** compute or cost.

Requesting a page beyond the document's length is an error, not a silent empty result.

## Source citations

| Claim                                                  | Source in `@deckops/sdk`                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Task type list                                         | `types.ts:14-46` (`DECK_TASK_TYPES`)                                                                                            |
| ppt2image tiers 1080/1920/2560                         | `types.ts:460-465`                                                                                                              |
| pdf2image arbitrary resolution                         | `types.ts:472-477`                                                                                                              |
| keynote2image takes no parameters                      | `types.ts:479`                                                                                                                  |
| ppt2video takes no parameters                          | `types.ts:470`                                                                                                                  |
| pdf/doc/keynote → pdf take no parameters               | `types.ts:467-480`                                                                                                              |
| html2png: scale, fullPage, width, height, inline html  | `types.ts:487-498`                                                                                                              |
| markdown2png: scale, theme, pageWidth, inline markdown | `types.ts:500-509`                                                                                                              |
| html2pptx: needEmbedFonts, width, height, inline html  | `types.ts:511-520`                                                                                                              |
| image.convertWebp takes no parameters                  | `types.ts:523`                                                                                                                  |
| Result shapes per task                                 | `types.ts:877-909` (`DeckTaskTypeResult`)                                                                                       |
| Page geometry from `bounds`                            | `types.ts:59-86`                                                                                                                |
| No SVG output                                          | absent from `DECK_TASK_TYPES`                                                                                                   |
| No XLSX / PAGES / NUMBERS converter                    | absent from `DECK_TASK_TYPES`, and confirmed by probing the live backend with `doc2pdf`, `keynote2pdf` and `ppt2pdf` — all fail |
| `html.getByURL` missing from the published SDK         | `dist/index.d.ts:7`                                                                                                             |
