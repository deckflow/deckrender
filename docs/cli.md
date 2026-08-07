# CLI Reference

```bash
deckrender <input> [options]
deckrender <command> [options]
```

`<input>` is a file path, an `http(s)` URL, or `-` for stdin. One input per invocation.

## Render options

| Flag                   | Description                                       | Default                        |
| ---------------------- | ------------------------------------------------- | ------------------------------ |
| `-o, --output <path>`  | Output file, directory, `.zip`, or `-` for stdout | Derived from the input         |
| `--format <format>`    | `image`, `pdf`, `video`                           | `image`, or inferred from `-o` |
| `--image-format <fmt>` | `png`, `jpg`, `webp`                              | `png`                          |
| `--from <format>`      | Source format. Required for stdin                 | From the file extension        |
| `--pages <ranges>`     | Pages to keep: `1-5`, `3`, `1,3,5-7`              | All                            |
| `--page <n>`           | A single page. Conflicts with `--pages`           | —                              |
| `--width <px>`         | Target long edge in pixels                        | Backend default                |
| `--scale <n>`          | Multiply the default long edge                    | —                              |
| `--quality <level>`    | `low`, `medium`, `high`                           | —                              |
| `--profile <name>`     | `web`, `presentation`, `print`, `thumbnail`       | —                              |
| `--embed-fonts`        | Embed fonts on routes passing through HTML→PPTX   | Off                            |
| `--timeout <seconds>`  | Task wait timeout                                 | `300`                          |
| `--json`               | Machine-readable result on stdout                 | Off                            |
| `--quiet`              | Suppress progress and warnings                    | Off                            |
| `-v, --verbose`        | Detailed logs on stderr                           | Off                            |
| `--version`            | Print the version                                 | —                              |
| `-h, --help`           | Show help                                         | —                              |

`--quiet` and `--verbose` conflict.

Not every flag applies to every route — `--width` on Keynote input, for example, has no backend parameter to land on. Those cases fail with `unsupported_option` and an explanation rather than being ignored. See [formats.md](formats.md).

## Input forms

```bash
deckrender deck.pptx                          # local file
deckrender https://example.com/page.html      # URL
cat page.html | deckrender - --from html      # stdin
```

Stdin has no filename to infer from, so `--from` is required.

A URL is fetched locally and given a `<base href>` so relative assets resolve. The resulting HTML is uploaded as the cloud task's source file. Scripts still run — the page is rendered in a real browser.

## Choosing the output format

`--format` and the `-o` extension both work; if they disagree, `--format` wins and a warning is printed.

| `-o` extension                | Format                             |
| ----------------------------- | ---------------------------------- |
| `.png` `.jpg` `.jpeg` `.webp` | `image`, and sets `--image-format` |
| `.pdf`                        | `pdf`                              |
| `.mp4`                        | `video`                            |
| `.zip`                        | Keeps `--format`, packs the result |
| none                          | Treated as a directory             |

## Where the output lands

`-o` and the number of rendered frames together decide the shape of the output.

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

`-o -` writes the artifact's raw bytes to stdout and nothing else, so it cannot be combined with `--json`.

## Sizing

`--width` sets the long edge directly. `--scale` multiplies the route's own base — 1920 for slides, 1080 for PDF.

`convertor.ppt2image` only accepts 1080, 1920 or 2560, so other values snap to the nearest tier and the chosen value is reported on stderr:

```
Warning: Resolution 2000 snapped to 1920: convertor.ppt2image accepts only 1080/1920/2560.
```

`--quality` is a shorthand for a (long edge, encoding) pair on image routes. It is not accepted on PDF or video, where the backend has no quality parameters at all.

| `--quality` | Slides | PDF  | Encoding |
| ----------- | ------ | ---- | -------- |
| `low`       | 1080   | 1080 | jpg      |
| `medium`    | 1920   | 1600 | png      |
| `high`      | 2560   | 2560 | png      |

An explicit `--width`, `--scale` or `--image-format` overrides the preset.

## Page selection

```bash
deckrender report.pdf --pages 1-5
deckrender report.pdf --pages 1,3,5-7
deckrender deck.pptx --page 3
```

Pages are 1-based and ranges are inclusive. Requesting a page past the end of the document is an error.

`--pages` filters at download time — **the backend still renders every page**, so this saves bandwidth and disk, not compute or cost. It does not apply to single-file output (pdf, video) or to HTML and Markdown, which produce one image.

On chained webp routes the filter is applied before the per-frame conversion, so unwanted frames are never converted.

## Commands

### `deckrender auth`

| Command       | Description                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `auth login`  | Browser login; stores the token in the shared DeckFlow credential file |
| `auth status` | Verify credentials against the backend and show their source           |
| `auth logout` | Clear stored credentials                                               |
| `auth path`   | Print the credential file path                                         |

`auth login` accepts `--port <n>` (default `3737`).

### `deckrender config`

| Command                    | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `config set <key> <value>` | Store a value                                    |
| `config unset <key>`       | Remove a value                                   |
| `config list`              | Show effective settings and where each came from |
| `config path`              | Print the config file paths                      |

| Key                                                                   | Goes to                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `api-key`                                                             | `~/.deckflow/credentials` — shared with every DeckFlow tool |
| `profile` `format` `image-format` `quality` `width` `scale` `timeout` | `~/.deckrender/config.json`                                 |

### `deckrender formats`

Prints the input/output matrix. `--json` gives the machine-readable form, including the exact backend task chain for each route.

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Success                                                |
| `1`  | Render or conversion failure                           |
| `2`  | Usage error, unsupported format, or unsupported option |
| `3`  | Authentication error                                   |

## Examples

```bash
deckrender deck.pptx
deckrender deck.pptx -o deck.pdf
deckrender deck.pptx -o deck.mp4
deckrender deck.pptx --profile web -o frames/
deckrender deck.pptx --pages 1-5 --image-format webp -o frames.zip
deckrender report.pdf --page 1 --width 640 -o thumb.png
deckrender page.html -o shot.png
deckrender https://example.com -o shot.png
cat page.html | deckrender - --from html -o shot.png
deckrender deck.pptx --json | jq -r '.outputs[].file'
deckrender deck.pptx --json | jq -r '.route | join(" -> ")'
```
