# Formats

```bash
deckrender formats          # print this matrix in your terminal
deckrender formats --json   # machine-readable, includes the backend task chain
```

## What converts to what

| Input                   | → image | → pdf | → video |
| ----------------------- | ------- | ----- | ------- |
| `.pptx` `.ppt`          | ✅      | ✅    | ✅      |
| `.pdf`                  | ✅      | ✅    | 🕓      |
| `.key`                  | ✅      | ✅    | 🕓      |
| `.docx` `.doc`          | ✅      | ✅    | —       |
| `.xlsx`                 | 🕓      | 🕓    | —       |
| `.pages`                | ✅      | ✅    | —       |
| `.numbers`              | ✅      | ✅    | —       |
| `.html` `.htm` and URLs | ✅      | ✅    | ✅      |
| `.md`                   | ✅      | —     | —       |

Image output supports `png`, `jpg` and `webp`.

**🕓** means planned but not built. Those fail with `not_implemented` and a message naming what is blocking them, rather than pretending the combination is impossible.

How a conversion is produced — one step or several, in the cloud or on this machine — is DeckRender's problem, not yours. `--json` reports the exact route if you want it:

```json
"route": ["convertor.doc2pdf", "convertor.pdf2image"]
```

An unsupported pair fails immediately with the alternatives spelled out:

```
Error: Cannot render .pdf to video.
  Supported outputs for .pdf: image, pdf
  Video rendering is available for .ppt/.pptx only. See docs/roadmap.md.
```

## Which flags each route accepts

Not every option applies everywhere. What a route can honour depends on how the image is produced, which is why `docx → image` accepts `--width` while `docx → pdf` does not.

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

## Per-format notes

Everything in the matrix works. These notes are about what the output _is_ — the
cases where the result differs from a plain full-fidelity render.

### Pages and Numbers — first page only

These render the preview iWork embeds in the document, which covers the **first
page only**, at whatever resolution iWork saved. `--width`, `--scale`,
`--quality` and `--image-format` have nothing to act on; `--format pdf` returns
that single page as a PDF.

Both shapes iWork writes are accepted — a single file, and the directory bundle
Finder shows as one document:

```bash
deckrender report.pages -o preview.jpg
deckrender ~/Documents/report.pages -o preview.pdf   # directory bundle
```

Keynote is unaffected: `.key` renders every slide.

### HTML to PDF and video — laid out as slides

HTML is reconstructed as a slide document before export, so layout follows the
slide model rather than the browser's. The video is a slideshow of that
reconstruction, not a capture of the live page. DeckRender warns on stderr and
reports a `caveat` in `--json`.

For the most faithful HTML output today, render to image.

### URLs

The page is fetched and given a `<base href>` so relative assets resolve.
Scripts still execute — rendering happens in a real browser.

### Video

`.pptx`, `.ppt` and `.html` convert to video. There are no video parameters yet,
so `--fps`, `--duration` and `--transition` fail with an explanation rather than
being quietly ignored. PDF and Keynote to video are on the
[roadmap](roadmap.md).

### webp

Each frame is converted individually, four at a time, so a long deck takes
noticeably longer in webp than in png. `--pages` is applied first, so narrowing
the range also narrows the work.

### No SVG

Nothing in the pipeline emits SVG, so `--image-format svg` is not offered.
Offering a value that always fails would be worse than leaving it out.

## Behind the matrix

`deckrender formats --json` reports how each combination is produced, if you need it. The matrix is verified end to end by `scripts/conformance.mjs`, which renders a real document through every combination and diffs the result against this page.
