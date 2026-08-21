# Formats

```bash
deckrender formats          # print this matrix in your terminal
deckrender formats --json   # machine-readable, includes the backend task chain
```

## What converts to what

| Input                   | → image | → pdf | → video |
| ----------------------- | ------- | ----- | ------- |
| `.pptx`                 | ✅      | ✅    | ✅      |
| `.ppt`                  | ✅      | 🕓    | ✅      |
| `.pdf`                  | ✅      | ✅    | 🕓      |
| `.key`                  | ✅      | ✅    | 🕓      |
| `.docx`                 | ✅      | ✅    | —       |
| `.doc`                  | —       | —     | —       |
| `.xlsx`                 | 🕓      | 🕓    | —       |
| `.pages`                | 🕓      | 🕓    | —       |
| `.numbers`              | 🕓      | 🕓    | —       |
| `.html` `.htm` and URLs | ✅      | ✅    | ✅      |
| `.md`                   | ✅      | —     | —       |

Image output supports `png`, `jpg` and `webp`.

**🕓** means the DeckFlow cloud cannot convert it yet. Those fail with `not_implemented` and a message naming the missing backend task, rather than pretending the combination is impossible. What each one waits on is listed under [Coming soon](roadmap.md#coming-soon) in the roadmap.

Every ✅ in this table is a cloud conversion. DeckRender renders nothing itself, so the matrix is exactly what the backend can do — no more, and nothing approximated locally to widen it. See [Where rendering happens](#where-rendering-happens).

A pair with no route at all — and none planned — fails immediately with the alternatives spelled out:

```
Error: Cannot render .docx to video. Supported outputs for .docx: image, pdf.
  Run `deckrender formats` or see docs/formats.md for the full support matrix.
```

`--json` reports the exact route a conversion took, including the intermediate steps of a chained one:

```json
"route": ["convertor.doc2pdf", "convertor.pdf2image"]
```

## Which flags each route accepts

Not every option applies everywhere. What a route can honour depends on how the image is produced, which is why `docx → image` accepts `--width` while `docx → pdf` does not.

| Input → image    | `--width` / `--scale`        | `--image-format` | `--pages`   |
| ---------------- | ---------------------------- | ---------------- | ----------- |
| `.pptx` `.ppt`   | ✅ snapped to 1080/1920/2560 | png, jpg, webp   | ✅          |
| `.pdf`           | ✅ any value                 | png, jpg, webp   | ✅          |
| `.docx`          | ✅ any value                 | png, jpg, webp   | ✅          |
| `.key`           | ✗                            | png, webp        | ✅          |
| `.html` and URLs | ✅                           | png, webp        | ✗ one image |
| `.md`            | ✅                           | png, webp        | ✗ one image |

`webp` works everywhere: it is produced by a separate conversion step rather than by the renderer itself.

PDF and video output accept no sizing, encoding, quality or page options — the backend tasks have no such parameters.

## Where rendering happens

**Rendering happens in the DeckFlow cloud.** The document is uploaded over HTTPS, converted there, and the resulting artifacts are downloaded back. There is no local render path and no local fallback: if the backend cannot convert something, DeckRender says so instead of approximating it here.

| Route                    | Where          | What leaves your machine                    |
| ------------------------ | -------------- | ------------------------------------------- |
| everything in the matrix | DeckFlow cloud | the document, and any intermediate artifact |
| `.pdf` → pdf             | your machine   | nothing — the file is copied as-is          |

`.pdf → pdf` is the single exception, and it is not a render: the input is already in the target format, so the file is copied. No backend has a task for it, and uploading a PDF to get the same PDF back would be pure waste.

A chained route uploads each intermediate too: `.docx → image` runs `convertor.doc2pdf`, downloads the PDF, and uploads it again for `convertor.pdf2image`. URL input is fetched by DeckRender on your machine, and it is that fetched HTML — not the URL — that is uploaded.

`--json` reports which engine ran, so this is checkable rather than something to take on faith:

```bash
$ deckrender deck.pptx -o out/ --json | jq -r .engine
cloud
```

`cloud` means the bytes were uploaded; `passthrough` means they were not. What DeckFlow does with an uploaded document — retention, processing, deletion — is the cloud service's policy, not this client's: see [deckflow.com](https://app.deckflow.com). **If a document may not leave your machine, DeckRender is not the tool for it** — settle that before adopting it.

## Per-format notes

Everything marked ✅ in the matrix works. These notes are about what the output _is_ — the
cases where the result differs from a plain full-fidelity render.

### Legacy Office formats

Legacy PowerPoint `.ppt` files render to images and video. PDF output waits on the backend: the
reliable route normalizes `.ppt` to `.pptx` before PDF conversion, and no task does that today.

Legacy Word `.doc` files have no backend converter at all. Save them as `.docx` or export
them to PDF before rendering.

### Pages and Numbers — not yet

`.pages` and `.numbers` are recognized but not renderable: the DeckFlow cloud has
no converter for either, so both report `not_implemented`.

They are deliberately not backed by the first-page preview iWork embeds in every
document. That preview is a thumbnail, not a render — one page, at whatever size
iWork happened to save — and answering `--format pdf` with it would report
success for something the user did not ask for. A converter upstream is the only
fix, and it is on the [roadmap](roadmap.md#coming-soon).

In the meantime, export to PDF, PPTX or DOCX from Pages or Numbers and render that.

Keynote is unaffected: `.key` has a cloud converter and renders every slide.

iWork can also save a document as a *directory bundle* that Finder shows as a
single file. There is nothing to upload in that shape, so DeckRender rejects it
and says how to re-save it as a single file.

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
