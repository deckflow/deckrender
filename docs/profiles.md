# Profiles

A profile is a named bundle of flag defaults. It never changes which backend tasks run — it only pre-fills options, and anything you type wins.

```bash
deckrender deck.pptx --profile web -o frames/
deckrender config set profile web    # make it the default
```

## Built-in profiles

| Profile        | Equivalent to                                                          |
| -------------- | ---------------------------------------------------------------------- |
| `web`          | `--format image --image-format webp --width 1920 --quality medium`     |
| `presentation` | `--format image --image-format png --width 1920 --quality high`        |
| `print`        | `--format pdf`                                                         |
| `thumbnail`    | `--format image --image-format jpg --width 640 --quality low --page 1` |

`print` carries no `--quality` on purpose: PDF routes reject it, and a profile should not ship a default that is guaranteed to be discarded.

## Precedence

Lowest first:

```
profile defaults  <  ~/.deckrender/config.json  <  command-line flags
```

```bash
deckrender deck.pptx --profile web --image-format png
# webp from the profile, png from the flag → png wins
```

## Profile defaults bend, explicit flags do not

Not every option applies to every route. `--pages` is meaningless for HTML, which renders to a single image.

If you type it, that is an error worth surfacing:

```bash
$ deckrender page.html --page 1
Error: --pages is not supported for .html input, which renders to a single image.
  The backend task convertor.html2png produces one full-page image.
```

If it came from a profile, DeckRender drops it and carries on:

```bash
$ deckrender page.html --profile thumbnail -o thumb.jpg
Warning: Ignoring --pages from profile/config: --pages is not supported for .html input...
Warning: Ignoring --image-format from profile/config: --image-format jpg is not supported...
thumb.jpg
```

The distinction is deliberate. Silently discarding what you asked for hides bugs; failing on a default you never typed makes profiles useless. Dropped defaults are always announced on stderr — suppress them with `--quiet`.

## Rolling your own

There is no user-defined profile format yet. Use `config set` for persistent defaults, or a shell alias for a one-off combination:

```bash
alias deck-social='deckrender --format image --image-format webp --width 1200 --quality medium'
```
