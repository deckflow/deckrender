# Quick Start

## Install

```bash
npx -y @deckflow/deckrender@latest deck.pptx
```

Or install it on your PATH:

```bash
npm install -g @deckflow/deckrender
deckrender --version
```

Requires Node.js 18 or newer. No credentials needed to start.

The compatible default is cloud guest mode. For Community rendering on your machine, install/configure Chrome, then select local. The matching `office2html` platform package is installed automatically:

```bash
deckrender config set engine local
deckrender deck.pptx -o frames/
```

See [engines.md](engines.md) for dependency resolution and privacy details.

## Render a deck

```bash
$ deckrender presentation.pptx
presentation
```

```
presentation/
├── 001.png
├── 002.png
└── 003.png
```

With no `-o`, DeckRender writes a directory named after the input.

## Pick a format

The output extension is enough:

```bash
deckrender deck.pptx -o deck.pdf
deckrender deck.pptx -o deck.mp4
deckrender deck.pptx -o slide.png
```

Or say it explicitly:

```bash
deckrender deck.pptx --format pdf -o out/report.pdf
```

## Control size and pages

```bash
deckrender report.pdf --pages 1-5 --width 2560 -o pages/
deckrender report.pdf --page 1 --width 640 -o thumb.png
```

On cloud routes `--pages` filters downloads after rendering. On local PPTX/PDF image routes only the selected pages are captured, so it also saves compute.

## Other inputs

```bash
deckrender page.html -o shot.png
deckrender https://example.com -o shot.png
cat page.html | deckrender - --from html -o shot.png
deckrender notes.md -o notes.png
```

Stdin has no filename to infer from, so `--from` is required there.

## Use a profile

Profiles are named bundles of flags:

```bash
deckrender deck.pptx --profile web -o frames/
```

`web` means `--format image --image-format webp --width 1920 --quality medium`. See [profiles.md](profiles.md).

## Script it

```bash
$ deckrender deck.pptx --json
{
  "ok": true,
  "input": "deck.pptx",
  "format": "image",
  "engine": "cloud",
  "route": ["convertor.ppt2image"],
  "pages": 3,
  "outputs": [
    { "page": 1, "file": "deck/001.png", "width": 1920, "height": 1080, "bytes": 184320 }
  ],
  "durationMs": 8123
}
```

stdout carries only the JSON; progress and warnings go to stderr, so pipelines stay clean:

```bash
FIRST=$(deckrender deck.pptx --json | jq -r '.outputs[0].file')
```

Branch on the exit code: `0` success, `1` render failure, `2` usage, `3` auth. See [errors.md](errors.md).

## Log in (optional)

```bash
deckrender auth login
deckrender auth status
```

The token is stored in `~/.deckflow/credentials` and shared with every DeckFlow CLI — DeckHTML included. If your machine already has `DECKHTML_API_KEY` set, or you have run `deckops login`, DeckRender already uses it.

```bash
deckrender config list    # shows every value and where it came from
```

## Next

- [CLI reference](cli.md) — every command and flag
- [Formats](formats.md) — what converts to what, and which flags each route accepts
- [Engines](engines.md) — Community/local and cloud setup and boundaries
- [Configuration](configuration.md) — credentials and render defaults
