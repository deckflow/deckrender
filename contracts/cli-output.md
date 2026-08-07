# Contract: CLI Output

> Frozen contract. Changing anything here is a breaking change for the scripts and tools that depend on it.

Aligned field-for-field with the DeckHTML CLI contract so scripts can treat any DeckFlow CLI the same way.

## Streams

| Stream | Content                                                    |
| ------ | ---------------------------------------------------------- |
| stdout | The final result: an output path, or the `--json` envelope |
| stderr | Progress, warnings, verbose logs, errors                   |

Nothing diagnostic ever reaches stdout. This holds under `--json` too, including for errors.

```bash
OUT=$(deckrender deck.pptx --json | jq -r '.outputs[0].file')
```

## Default output

The success line is the artifact path:

```bash
$ deckrender deck.pptx --format pdf -o deck.pdf
deck.pdf
```

For multi-frame output it is the containing directory:

```bash
$ deckrender deck.pptx
deck
```

## `--json` envelope

```json
{
  "ok": true,
  "input": "deck.pptx",
  "format": "image",
  "engine": "cloud",
  "route": ["convertor.ppt2image"],
  "pages": 20,
  "outputs": [{ "page": 1, "file": "deck/001.png", "width": 1920, "height": 1080, "bytes": 184320 }],
  "durationMs": 8123
}
```

| Field        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `ok`         | Always `true` on success                                       |
| `input`      | The input as given: path, URL, or `-`                          |
| `format`     | `image`, `pdf` or `video`                                      |
| `engine`     | `cloud`, `local`, or `passthrough`                             |
| `route`      | Every backend task in order — the render plan, made observable |
| `pages`      | Pages the document rendered to, **before** `--pages` filtering |
| `outputs`    | One entry per written file, in page order                      |
| `durationMs` | Wall clock for the whole render                                |
| `caveat`     | Present only when the route has a known fidelity trade-off     |

`width`, `height` and `bytes` come from the backend's own page geometry and are omitted when it does not report them. They are never guessed.

`route` lists chained tasks in execution order:

```json
"route": ["convertor.doc2pdf", "convertor.pdf2image"]
```

## Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "unsupported_format",
    "message": "Cannot render .pdf to video. Supported outputs for .pdf: image, pdf.",
    "hint": "Video rendering is available for .ppt/.pptx only. See docs/roadmap.md."
  }
}
```

Written to **stderr**, so stdout stays empty on failure. `hint` and `requestId` appear only when relevant.

## stdout is one document; stderr is a stream

Under `--json`:

- **stdout** carries exactly one JSON document — the result envelope — and nothing else. Parse it whole.
- **stderr** carries zero or more newline-delimited JSON documents: any warnings, followed by at most one error envelope.

```
$ deckrender deck.pptx --profile web --json
# stderr:
{"warning":"via convertor.ppt2image → image.convertWebp (2 steps)"}
{
  "ok": false,
  "error": { "code": "render_error", ... }
}
```

Warnings take the shape `{"warning": "..."}`. A consumer that wants the failure detail should read the last document on stderr, or simply branch on the exit code. `--quiet` suppresses warnings and leaves only the error envelope.

## Error codes

| Code                 | Meaning                                                      | Exit |
| -------------------- | ------------------------------------------------------------ | ---- |
| `usage_error`        | Invalid flags, missing input, conflicting flags              | 2    |
| `unsupported_format` | No route for this input/output pair                          | 2    |
| `unsupported_option` | The route exists, but this flag cannot reach the backend     | 2    |
| `not_implemented`    | Planned, but not built yet                                   | 2    |
| `auth_error`         | Credentials required, missing, or rejected                   | 3    |
| `render_error`       | The render itself failed                                     | 1    |
| `conversion_error`   | Rendered, but the artifact could not be retrieved or written | 1    |
| —                    | Success                                                      | 0    |

Scripts should branch on the exit code first, and parse the JSON error only when they need the detail.

Argument-parsing failures — an unknown flag, an invalid enum value, a rejected `config set` value — also exit **2**. There is one usage code, whoever rejected the input.

## Output modes

| Flag            | Effect                                                          |
| --------------- | --------------------------------------------------------------- |
| `--json`        | stdout becomes a single JSON object; diagnostics stay on stderr |
| `--quiet`       | Suppresses progress and warnings                                |
| `-v, --verbose` | Adds detailed logs to stderr                                    |

`--quiet` and `--verbose` conflict and produce a `usage_error`.

All three are available on every command, including `config list --json` and `formats --json`.

## Artifact layout

| Situation                          | Result                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| No `-o`, multiple frames           | Directory named after the input, `001.png`, `002.png`, … |
| No `-o`, single file               | Beside the input, same base name, new extension          |
| `-o dir/` or an extensionless path | That directory, numbered frames                          |
| `-o out.png`, single frame         | Exactly `out.png`                                        |
| `-o out.png`, multiple frames      | `out-001.png`, `out-002.png`, …                          |
| `-o out.zip`                       | A zip of numbered frames                                 |
| `-o -`, single frame               | Bytes on stdout                                          |
| `-o -`, multiple frames            | `usage_error`                                            |

Frame numbers are zero-padded to at least three digits, widening for documents past 999 pages.
