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
| `not_implemented`    | The DeckFlow cloud cannot convert this pair yet              | 2    |
| `auth_error`         | Credentials required, missing, or rejected                   | 3    |
| `render_error`       | The render itself failed                                     | 1    |
| `conversion_error`   | Rendered, but the artifact could not be retrieved or written | 1    |

## JSON form

```bash
$ deckrender report.docx --format video --json
```

```json
{
  "ok": false,
  "error": {
    "code": "unsupported_format",
    "message": "Cannot render .docx to video. Supported outputs for .docx: image, pdf.",
    "hint": "Run `deckrender formats` or see docs/formats.md for the full support matrix."
  }
}
```

Written to stderr, so stdout stays empty on failure. `requestId` is included when the failure came from the backend — quote it in bug reports.

## The three DeckRender-specific codes

The render matrix has real holes, so these exist to tell apart "impossible", "not yet", and "that knob does not exist here".

### `unsupported_format`

No route at all, and none planned. The message lists what the input _can_ become:

```
Error: Cannot render .docx to video. Supported outputs for .docx: image, pdf.
  Run `deckrender formats` or see docs/formats.md for the full support matrix.
```

Run `deckrender formats` for the whole matrix. A combination marked 🕓 there is
`not_implemented` instead — `.pdf` to video, for one.

### `unsupported_option`

The conversion works; that particular flag has nowhere to land. The message says why, and offers a workaround where one exists:

```
Error: --width is not supported for .key input.
  Rendering .key offers no resolution control. Workaround: render to PDF first, then run deckrender on the PDF.
```

DeckRender never accepts a flag and quietly ignores it — silently rendering something other than what you asked for is worse than failing.

The exception is options inherited from a profile or config file, which are dropped with a warning instead. See [profiles.md](profiles.md).

### `not_implemented`

The DeckFlow cloud cannot do this conversion yet. The message says "coming soon" and names the missing backend capability:

```
Error: Rendering .xlsx to pdf is coming soon — not supported yet.
  The DeckFlow cloud has no spreadsheet converter yet.
  Track it in docs/roadmap.md.
```

The distinction from `unsupported_format` matters: one is worth waiting for, the
other means find another approach. `deckrender formats` marks these `soon`.

Rendering happens in the cloud, so this code always points upstream. DeckRender
will not fill the gap locally with an approximation — see
[the roadmap](roadmap.md#rendering-is-the-clouds-job).

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
| `Input is a directory`                                  | An iWork package — re-save it as a single file, or export to PDF           |
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

### A rejected credential falls back to guest mode

Credentials resolve from a [five-level chain](configuration.md), which includes
files written by the other DeckFlow CLIs. A machine that once used `deckops` or
exported `DECKHTML_API_KEY` is **not** in guest mode, even though nothing was
configured for DeckRender.

When the backend rejects whatever was sent, DeckRender treats it as no credential
at all: it drops the credential, retries the render as a guest, and warns on
stderr.

```
Warning: The backend rejected the token from ~/.deckops/config.json, so it is
being ignored and the render retried in guest mode, which is rate-limited. Run
`deckrender auth login` for full access, or `deckrender config list` to see where
that credential came from.
```

An invalid credential is not a credential, and rendering is supposed to work with
no setup at all — so leftover state on a machine must not turn a render guest mode
would have completed into a hard failure. Agents and scripts are what hit this: an
expired token nobody remembers configuring fails on a developer machine where the
same code succeeds in a clean container. The warning names what was dropped, so
the fallback is never silent.

Two things travel with the rejected credential:

- The `spaceId`, which belongs to that credential's workspace. Sending it as a
  guest earns a `403`, so it is left behind too. A `403` that names your own data
  is treated exactly like a `401` for the same reason — the workspace outlived
  the login it belonged to.
- The quota. Guest rendering is rate-limited; `deckrender auth login` restores
  full access.

Only a rejected credential triggers this. A `402 Payment Required` — a workspace
out of balance — is a real answer about your account and is reported as such, not
retried. If guest mode is refused as well, that failure is what you see:

```
Error: Authentication failed: invalid token
  Run `deckrender auth login`, or set DECKFLOW_API_KEY in the environment.
```

At a terminal, that second failure opens the browser login and retries once more.

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
