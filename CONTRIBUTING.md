# Contributing

## Setup

```bash
pnpm install
pnpm check     # typecheck + lint + unit + integration
```

| Command                 | What it does                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`            | Bundle to `dist/` with tsup                                                                                                               |
| `pnpm typecheck`        | `tsc --noEmit`                                                                                                                            |
| `pnpm lint`             | ESLint over `src` and `tests`                                                                                                             |
| `pnpm format`           | Prettier write                                                                                                                            |
| `pnpm test:unit`        | Pure logic, no I/O                                                                                                                        |
| `pnpm test:integration` | Full pipeline against a fake `DeckClient`, no network                                                                                     |
| `pnpm test:e2e`         | Drives the built CLI — run `pnpm build` first                                                                                             |
| `pnpm test:cloud`       | Guest-mode smoke test against the live backend; needs `DECKRENDER_E2E=1`                                                                  |
| `pnpm test:conformance` | Renders every file in `tests/test-data/` through every output and diffs against the documented matrix; needs credentials and spends quota |

Node.js 18 or newer.

## Layout

```
src/
├── cli.ts            bin entry
├── cli/              flags, profiles, output, commands
├── core/             renderer, plan, route table, page selection
├── engines/          RenderEngine interface + CloudEngine
├── input/            file / URL / stdin resolution
├── output/           artifact writing, naming, zip
├── config/           credentials and render defaults
├── auth/             browser login
└── errors/           codes and DeckRenderError
```

The pipeline runs `resolve → plan → execute → write`. Everything except `engines/` is backend-agnostic — that separation is what lets the local engine land in v0.2 without touching the rest.

## Where things go

**Adding a route.** Edit `ROUTES` in `src/core/routes.ts`, add the task's capabilities to `TASK_CAPABILITIES`, then update `contracts/render-matrix.md` with a source citation. Every claim in that table has to be checkable against `@deckops/sdk`.

Probe the backend before writing the route down. Several formats look like they should work and do not — `doc2pdf` rejects `.xlsx`, and no task accepts `.pages` or `.numbers` — so a route added from the type definitions alone can be wrong. Then run `pnpm test:conformance` to confirm it end to end.

**Deciding between `unsupported_format` and `not_implemented`.** If a combination could reasonably ship later, add it to `NOT_IMPLEMENTED` with a sentence naming what blocks it; the CLI then says "coming soon" instead of "cannot". If nothing is planned, leave it out of both tables and it falls through to `unsupported_format`.

**Adding a flag.** Register it in `src/cli/commands/render.ts`, map it in `src/core/plan.ts`, and — this is the important part — make it fail with `unsupported_option` on routes that cannot honour it. Silently ignoring a flag renders something other than what the user asked for, which is worse than an error.

If the flag can also come from a profile or config, add it to `SOFT_OPTION_KEYS` so an inherited value is dropped with a warning instead of failing. See `docs/profiles.md`.

**Touching credentials.** `contracts/credentials.md` is shared with other DeckFlow tools. Changing the file format or the resolution chain needs an RFC update and coordination, and `tests/unit/credentials.test.ts` must keep passing — it guards the PRD requirement that DeckHTML and DeckRender share auth.

## Contracts

Files under `contracts/` are frozen. They describe promises other people's scripts depend on: the `--json` envelope, exit codes, the render matrix, the credential format. Changing one is a breaking change — say so in the PR description and update `CHANGELOG.md` in the same commit.

## Testing

Integration tests inject a fake client through `createRenderer({ client })`, so the real plan, chaining and writer code all run without network. Prefer them over mocking internals.

A route change should assert the resulting `route` array. A flag change should assert both that it lands in the right task parameters and that it errors on routes that cannot take it.

## Style

Prettier and ESLint are enforced in CI; run `pnpm format` before pushing.

Comments should explain _why_, especially where the code works around a backend limitation. Several odd-looking pieces here — resolution snapping, download-and-re-upload chaining, page filtering before per-frame conversion — exist because of specific constraints in `@deckops/sdk`. Losing that context is how someone later "simplifies" a workaround back into a bug.

## Pull requests

- One concern per PR
- `pnpm check` green
- New behaviour comes with tests
- User-facing changes update the relevant page in `docs/`
- Contract changes update `contracts/` and `CHANGELOG.md`
