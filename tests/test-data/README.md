# Conformance fixtures

`scripts/conformance.mjs` renders every document in this directory through every
output format and diffs the result against the matrix in
[`docs/formats.md`](../../docs/formats.md).

The documents themselves are **not** in the repository — they are large, and the
ones that exercise the matrix well tend to be real work files. Bring your own.

## What to put here

One file per extension you want covered. The script picks the first file it
finds for each and ignores the rest.

| File           | Covers                                                   |
| -------------- | -------------------------------------------------------- |
| `test.pptx`    | `ppt2image`, `ppt2pdf`, `ppt2video`                      |
| `test.pdf`     | `pdf2image`, and the pdf-to-pdf passthrough              |
| `test.docx`    | the `doc2pdf → pdf2image` chain                          |
| `test.key`     | `keynote2image`, `keynote2pdf`                           |
| `test.html`    | `html2png`, and the `html2pptx → ppt2*` chains           |
| `test.pages`   | the local iWork preview extractor                        |
| `test.numbers` | the same, from a spreadsheet                             |
| `test.xlsx`    | asserts that spreadsheets still report `not_implemented` |

A `.pages` **directory bundle** is as valid as a single `.pages` file — the two
shapes take different code paths, so testing both is worthwhile.

Multi-page documents are more useful than single-page ones: page counts,
`--pages` filtering and frame naming only get exercised when there is more than
one page.

## Running it

```bash
pnpm build
pnpm test:conformance
```

It needs credentials (`deckrender auth login`) and spends backend quota, so it
is not part of `pnpm test`.
