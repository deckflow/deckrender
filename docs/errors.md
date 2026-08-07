# Errors

Errors go to stderr. Scripts should branch on the exit code first and parse the JSON only when they need the detail.

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Success                                                |
| `1`  | Render or conversion failure                           |
| `2`  | Usage error, unsupported format, or unsupported option |
| `3`  | Authentication error                                   |

## Error codes

| Code                 | Meaning                                                      | Exit |
| -------------------- | ------------------------------------------------------------ | ---- |
| `usage_error`        | Invalid flags, missing input, conflicting flags              | 2    |
| `unsupported_format` | No route exists for this input/output pair                   | 2    |
| `unsupported_option` | The route exists, but this flag cannot reach the backend     | 2    |
| `not_implemented`    | Planned, but not built yet                                   | 2    |
| `auth_error`         | Credentials required, missing, or rejected                   | 3    |
| `render_error`       | The render itself failed                                     | 1    |
| `conversion_error`   | Rendered, but the artifact could not be retrieved or written | 1    |

## JSON form

```bash
$ deckrender report.pdf --format video --json
```

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

Written to stderr, so stdout stays empty on failure. `requestId` is included when the failure came from the backend — quote it in bug reports.

## The three DeckRender-specific codes

The render matrix has real holes, so these exist to tell apart "impossible", "not yet", and "that knob does not exist here".

### `unsupported_format`

No route at all. The message lists what the input _can_ become:

```
Error: Cannot render .pdf to video.
  Supported outputs for .pdf: image, pdf
  Video rendering is available for .ppt/.pptx only. See docs/roadmap.md.
```

Run `deckrender formats` for the whole matrix.

### `unsupported_option`

The conversion works; that particular flag has nowhere to land. The message names the backend task responsible and, where one exists, a workaround:

```
Error: --width is not supported for .key input.
  The backend task convertor.keynote2image accepts no resolution parameters.
  Workaround: render to PDF first, then run deckrender on the PDF.
```

DeckRender never accepts a flag and quietly ignores it — silently rendering something other than what you asked for is worse than failing.

The exception is options inherited from a profile or config file, which are dropped with a warning instead. See [profiles.md](profiles.md).

### `not_implemented`

Planned, but not built. The message says "coming soon" and names what is blocking it:

```
Error: Rendering .xlsx to pdf is coming soon — not supported yet.
  Spreadsheet rendering needs a layout engine DeckRender does not have yet.
  Track it in docs/roadmap.md.
```

The distinction from `unsupported_format` matters: one is worth waiting for, the
other means find another approach. `deckrender formats` marks these `soon`.

## Common cases

| Message                                                 | Cause                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Reading from stdin requires an explicit source format` | Add `--from html` (or whichever format)                                     |
| `Unrecognized input extension`                          | Set `--from` explicitly                                                     |
| `--quiet conflicts with --verbose`                      | Pick one                                                                    |
| `--pages conflicts with --page`                         | Pick one                                                                    |
| `Requested page 9 but the document rendered 3 pages`    | Out-of-range `--pages`                                                      |
| `--fps is not supported yet`                            | The video task accepts no parameters — see the [roadmap](roadmap.md)        |
| `unknown option '--x'`                                  | Typo, or a flag that no longer exists — `--mode` was removed in v0.1        |
| `... is coming soon`                                    | Planned combination; see `deckrender formats` and the [roadmap](roadmap.md) |
| `This iWork document has no embedded preview`           | Re-save from Pages/Numbers with previews enabled, or export to PDF          |
| `Invalid value for quality: ultra`                      | `config set` rejected the value; the message lists what is allowed          |
| `Authentication failed`                                 | `deckrender auth login`, or set `DECKFLOW_API_KEY`                          |

## Authentication failures

DeckRender does not ask for credentials up front — guest mode covers most use. A `401` mid-render opens the browser login and retries automatically.

`auth_error` means that could not happen: an invalid or expired key, or a non-interactive session (no TTY, or `--json`) where the backend rejected the guest request.

```bash
deckrender auth status    # verifies against the backend and shows the source
deckrender config list    # shows which credential is winning, and from where
```

`config list` is usually the fastest way to answer "why is it not using the key I just set?".

## Retries

Transient network and upstream failures are retried automatically, both for backend calls and artifact downloads. Explicit failures — 401, 403, 404 — fail immediately rather than stalling behind retries.

### Intermittent Keynote failures

Large Keynote files fail intermittently on the backend, with no detail beyond
`Unknown error`. During development `.key` conversions succeeded roughly two runs
in three on an 8.7 MB deck, producing a valid result when they did, and the same
file's image render ranged from 20s to 150s — which points at load or an internal
timeout rather than the document.

DeckRender does **not** retry a failed conversion: the backend has already spent
the work, and a second attempt would spend it again on what might be a genuine
failure. Retry it yourself when the message carries no detail:

```bash
deckrender deck.key --format pdf -o deck.pdf || deckrender deck.key --format pdf -o deck.pdf
```

`scripts/conformance.mjs` retries once and labels the result flaky, so the
project's own matrix check tolerates this without hiding it.

A backend task that ends in `failed` surfaces as `render_error` with the backend's own message and the task id:

```
Error: Task convertor.ppt2image failed: unsupported embedded font
  Inspect the task with: deckops task get task_abc123
```
