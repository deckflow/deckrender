# Formats

```bash
deckrender formats          # print this matrix in your terminal
deckrender formats --json   # machine-readable, includes the backend task chain
```

## What converts to what

| Input                   | → image  | → pdf      | → video    |
| ----------------------- | -------- | ---------- | ---------- |
| `.pptx` `.ppt`          | ✅       | ✅         | ✅         |
| `.pdf`                  | ✅       | copy       | 🕓         |
| `.key`                  | ✅       | ✅         | 🕓         |
| `.docx` `.doc`          | chained  | ✅         | —          |
| `.xlsx`                 | 🕓       | 🕓         | —          |
| `.pages`                | local ⚠️ | local ⚠️   | —          |
| `.numbers`              | local ⚠️ | local ⚠️   | —          |
| `.html` `.htm` and URLs | ✅       | chained ⚠️ | chained ⚠️ |
| `.md`                   | ✅       | —          | —          |

Image output supports `png`, `jpg` and `webp`.

**chained** means more than one backend task runs. It is slower, and `--json`'s `route` always shows the exact chain:

```json
"route": ["convertor.doc2pdf", "convertor.pdf2image"]
```

**copy** means the input is already in the target format, so DeckRender copies it rather than re-rendering.

**local** means it runs on this machine — no network, no credentials.

**🕓** means planned but not built. Those fail with `not_implemented` and a message naming what is blocking them, rather than pretending the combination is impossible.

An unsupported pair fails immediately with the alternatives spelled out:

```
Error: Cannot render .pdf to video.
  Supported outputs for .pdf: image, pdf
  Video rendering is available for .ppt/.pptx only. See docs/roadmap.md.
```

## Which flags each route accepts

Sizing and encoding options land on whichever backend task actually produces the image. For chained routes that is the last one — which is why `docx → image` accepts `--width` while `docx → pdf` does not.

| Input → image       | `--width` / `--scale`        | `--image-format` | `--pages`   |
| ------------------- | ---------------------------- | ---------------- | ----------- |
| `.pptx` `.ppt`      | ✅ snapped to 1080/1920/2560 | png, jpg, webp   | ✅          |
| `.pdf`              | ✅ any value                 | png, jpg, webp   | ✅          |
| `.docx` `.doc`      | ✅ any value                 | png, jpg, webp   | ✅          |
| `.key`              | ✗                            | png, webp        | ✅          |
| `.html` and URLs    | ✅                           | png, webp        | ✗ one image |
| `.md`               | ✅                           | png, webp        | ✗ one image |
| `.pages` `.numbers` | ✗                            | jpg only         | ✗ one image |

`webp` works everywhere: it is produced by a separate conversion step rather than by the renderer itself.

PDF and video output accept no sizing, encoding, quality or page options — the backend tasks have no such parameters.

## Notes on specific routes

### html → pdf ⚠️

HTML is rebuilt as PPTX before PDF export, so layout is constrained by the slide model. DeckRender warns on stderr and reports a `caveat` in `--json`.

For a faithful HTML→PDF today, render to image instead. A native path arrives with the local engine in v0.2.

### URLs

The page is fetched by DeckRender and given a `<base href>` so relative assets resolve. The resulting HTML is uploaded as the cloud task's source file. Scripts still execute — the backend renders in a real browser.

### webp

Each frame becomes its own conversion task, four at a time. A 40-slide deck rendered to webp creates 41 tasks. Combining with `--pages` filters first, so `--pages 1-2` on that deck creates 3 tasks rather than 41.

### Pages and Numbers ⚠️

DeckOps has no converter for these. Every iWork document embeds a `preview.jpg` of its **first page**, so DeckRender extracts that instead of refusing the format — no network, no credentials, no dependencies.

It is a preview, not a render: one page, at whatever resolution iWork saved, so `--width`, `--scale`, `--quality` and `--image-format` have nothing to act on. `--format pdf` wraps that JPEG in a single-page PDF.

Both shapes iWork writes are accepted — a single file, and the directory bundle Finder shows as one document:

```bash
deckrender report.pages -o preview.jpg
deckrender ~/Documents/report.pages -o preview.pdf   # directory bundle
```

Keynote does **not** use this path — `.key` has real cloud converters and renders every slide.

### Spreadsheets 🕓

`.xlsx` has no cloud converter, and rendering a workbook locally needs a real layout pass. It reports `not_implemented` rather than failing silently. `.numbers` falls back to the embedded preview above.

### Video

`.pptx`, `.ppt` and `.html` convert to video. The backend accepts no video parameters, so `--fps`, `--duration` and `--transition` fail with an explanation rather than being quietly ignored. PDF and Keynote to video are planned and need local frame assembly. See the [roadmap](roadmap.md).

### No SVG

DeckOps has no task that emits SVG, so `--image-format svg` is not offered. Offering a value that always fails would be worse than leaving it out.

## Behind the matrix

Every cloud route maps to a task type in [`@deckops/sdk`](https://www.npmjs.com/package/@deckops/sdk); `deckrender formats --json` names the exact task chain for each one. The matrix is verified end to end by `scripts/conformance.mjs`, which renders a real document through every combination and diffs the result against this page.
