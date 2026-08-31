# office2html platform packages

DeckRender Community distributes `office2html` from this repository as four public platform packages:

| Package                              | Platform    | Executable            |
| ------------------------------------ | ----------- | --------------------- |
| `@deckflow/office2html-darwin-arm64` | macOS arm64 | `bin/office2html`     |
| `@deckflow/office2html-darwin-x64`   | macOS x64   | `bin/office2html`     |
| `@deckflow/office2html-linux-x64`    | Linux x64   | `bin/office2html`     |
| `@deckflow/office2html-win32-x64`    | Windows x64 | `bin/office2html.exe` |

The root package declares all four as optional workspace dependencies. The published main tarball contains no `office2html` binaries: `pnpm pack` / `pnpm publish` replaces the workspace references with the matching release version. npm uses each package's `os` and `cpu` metadata to download and install only the matching binary package. An unsupported platform installs none. Users who only need cloud rendering can skip all optional local-render dependencies with `npm install --omit=optional @deckflow/deckrender`.

All four binaries are tracked here because this is also the distribution source repository. A contributor's pnpm workspace may link all four package directories into `node_modules`; these links do not copy four binaries and do not describe what a normal registry installation downloads. Do not add all architectures to pnpm's `supportedArchitectures` in a consumer project unless a multi-platform installation is intentional.

The binaries were refreshed from `internal/office2html` on 2026-08-31. The upstream originals remain untouched; these platform packages are the authoritative release artifacts.

Before release:

1. Run `pnpm verify:office2html` to check package metadata, executable mode, byte length, and SHA-256 for all four artifacts.
2. Run `pnpm build && pnpm test:packaging` (npm >= 10, pnpm, and `tar` required). This packs all five packages without publishing, verifies the main tarball's release dependencies, then uses a temporary loopback registry to prove that each OS/CPU downloads and installs only its own binary. It also tests an unsupported platform and `--omit=optional`; neither downloads a binary.
3. Publish all four platform packages before the same-version `@deckflow/deckrender` package. The release workflow does this in order and skips versions already published. Always use pnpm for publishing so `workspace:*` is rewritten.

The installation check deletes its own temporary files on exit. Set `KEEP_PACKAGING_ARTIFACTS=1` to retain them for inspection. It never contacts npm for package downloads or publishes anything.
