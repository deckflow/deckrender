# DeckRender

> Render PPTX, PDF, DOCX, Keynote, HTML and Markdown into images, PDF or video.

```bash
deckrender deck.pptx -o deck.png
deckrender deck.pptx -o deck.pdf
deckrender deck.pptx -o deck.mp4
```

DeckRender is a pure render engine: document in, pixels out. It does not parse content, extract text, or edit files — those belong to other DeckFlow tools.

What it renders is what the DeckFlow cloud can convert — see [Formats](formats.md) for the matrix, holes included.

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
