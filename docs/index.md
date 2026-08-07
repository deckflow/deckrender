# DeckRender

> Render any document format into visual artifacts.

```bash
deckrender deck.pptx -o deck.png
deckrender deck.pptx -o deck.pdf
deckrender deck.pptx -o deck.mp4
```

DeckRender is a pure render engine: document in, pixels out. It does not parse content, extract text, or edit files — those belong to other DeckFlow tools.

## Documentation

|                                   |                                                           |
| --------------------------------- | --------------------------------------------------------- |
| [Quick start](quickstart.md)      | Install and first render                                  |
| [CLI reference](cli.md)           | Every command and flag                                    |
| [Formats](formats.md)             | What converts to what, and which flags each route accepts |
| [Profiles](profiles.md)           | Named flag presets                                        |
| [Configuration](configuration.md) | Credentials, shared auth, render defaults                 |
| [Errors](errors.md)               | Error codes and exit codes                                |
| [Roadmap](roadmap.md)             | What is coming, and what is blocked upstream              |

## Contracts

Frozen promises that scripts and other tools depend on:

|                                                     |                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| [`cli-output.md`](../contracts/cli-output.md)       | stdout/stderr split, `--json` envelope, exit codes, artifact layout |
| [`render-matrix.md`](../contracts/render-matrix.md) | The full support matrix with citations into `@deckops/sdk`          |
| [`credentials.md`](../contracts/credentials.md)     | The shared DeckFlow credential file format                          |
