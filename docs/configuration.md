# Configuration

## Authentication is optional

DeckRender renders without any credentials. Guest mode covers casual use; log in for higher quotas and private workspaces.

```bash
deckrender deck.pptx        # works immediately, no setup
deckrender auth login       # opt in when you need more
```

Nothing prompts for credentials up front. If the backend returns `401` mid-render, the browser login opens and the request retries automatically.

## Credentials are shared across DeckFlow

Credentials live in `~/.deckflow/credentials` and are shared by every DeckFlow CLI. Log in through DeckRender and DeckHTML uses the same token; log in through DeckHTML and DeckRender picks it up.

```bash
deckrender auth login
deckrender config set api-key sk-...
```

Both write to the shared file. Writes are merged, so keys another tool stored there are preserved.

If your machine is already configured for another DeckFlow tool, DeckRender finds it:

- `DECKHTML_API_KEY` in the environment
- a token stored by `deckops login` in `~/.deckops/config.json` (read-only — DeckRender never writes there)

## Resolution order

Each field resolves independently, first match wins:

|     | Source                                                   |
| --- | -------------------------------------------------------- |
| 1   | Explicit argument (`--api-key`, `--token`, `--api-base`) |
| 2   | Environment variables                                    |
| 3   | `~/.deckflow/credentials`                                |
| 4   | `~/.deckops/config.json` (read-only)                     |
| 5   | Built-in default                                         |

Environment variables, in order:

| Field    | Variables                                                      |
| -------- | -------------------------------------------------------------- |
| API key  | `DECKRENDER_API_KEY` → `DECKFLOW_API_KEY` → `DECKHTML_API_KEY` |
| Token    | `DECKRENDER_TOKEN` → `DECKFLOW_TOKEN`                          |
| Space    | `DECKRENDER_SPACE_ID` → `DECKFLOW_SPACE_ID`                    |
| API base | `DECKRENDER_API_BASE` → `DECKFLOW_API_BASE`                    |

Independent resolution means an API key from the environment can combine with a `spaceId` left behind by a `deckops` login.

## Seeing what is in effect

When something authenticates as the wrong account, this is the command that answers why:

```bash
$ deckrender config list
Credentials
  api-key   sk-a************wxyz  (env:DECKHTML_API_KEY)
  token     (unset)
  space-id  space_abc             (file:~/.deckops/config.json)
  api-base  https://app.deckflow.com/v1  (default)

Render defaults
  profile      web
  format       (unset)
  ...

Files
  shared credentials  ~/.deckflow/credentials
  render defaults     ~/.deckrender/config.json
  deckops (read-only) ~/.deckops/config.json
```

Secrets are always masked. `--json` gives the same data for scripts.

```bash
deckrender auth status      # also verifies the credential against the backend
```

## Render defaults

Preferences you do not want to retype go in `~/.deckrender/config.json`, kept separate from credentials so changing a default never rewrites a file other tools read.

```bash
deckrender config set profile web
deckrender config set image-format webp
deckrender config set width 2560
deckrender config unset width
```

| Key                       | Values                                      |
| ------------------------- | ------------------------------------------- |
| `profile`                 | `web`, `presentation`, `print`, `thumbnail` |
| `format`                  | `image`, `pdf`, `video`                     |
| `image-format`            | `png`, `jpg`, `webp`                        |
| `quality`                 | `low`, `medium`, `high`                     |
| `width` `scale` `timeout` | numbers                                     |

Precedence, lowest first:

```
profile defaults  <  ~/.deckrender/config.json  <  command-line flags
```

A stored default that a particular route cannot honour is dropped with a warning, not an error — only a flag you typed produces `unsupported_option`. So `config set image-format webp` will not break `deckrender notes.md`.

## CI, Docker, and agents

Use the environment; nothing is written to disk:

```bash
export DECKFLOW_API_KEY=sk-...
deckrender deck.pptx --json --quiet
```

Redirect config to a scratch directory when you need isolation:

```bash
export DECKFLOW_CONFIG_DIR=/tmp/deckflow
export DECKRENDER_CONFIG_DIR=/tmp/deckrender
```

## File permissions

| Path                      | Mode   |
| ------------------------- | ------ |
| `~/.deckflow/`            | `0700` |
| `~/.deckflow/credentials` | `0600` |

Enforced on every write, including to files that already exist.

## The credential file format

Anyone implementing another DeckFlow tool reads and writes the same file, so the format is specified rather than left to whatever DeckRender happens to do.

`~/.deckflow/credentials` is JSON. Every field is optional.

```json
{
  "apiKey": "sk-...",
  "token": "...",
  "spaceId": "...",
  "apiBase": "https://app.deckflow.com/v1"
}
```

| Field     | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| `apiKey`  | Long-lived key, sent as `Authorization: Bearer`                   |
| `token`   | Session token from the browser login flow, sent as `X-Auth-Token` |
| `spaceId` | Default workspace                                                 |
| `apiBase` | API root. Defaults to `https://app.deckflow.com/v1`               |

Rules for implementors:

1. **Read-merge-write.** Never rewrite the file wholesale. Unknown keys belong to another tool and must survive.
2. **Tolerate malformed content.** A corrupt or partially written file resolves to "no credentials", never a crash.
3. **Never write another tool's config.** `~/.deckops/config.json` is readable as a fallback but is owned by the DeckOps CLI.
4. **Keep tool-specific settings out.** Render defaults and the like belong in the tool's own directory.

### Login flow

Byte-for-byte compatible with the DeckOps CLI, so a token obtained by any tool works in all of them:

```
GET {apiBase minus /v1}/cli/auth?redirect_url=http://localhost:3737
      ↓ browser completes login, redirects back
GET http://localhost:3737/?token=<token>&spaceId=<spaceId>
```

The callback server accepts `spaceId` or `space_id`, listens on port 3737 by default, and times out after five minutes. Checkout, for a `402 Payment Required`, follows the same shape at `/cli/checkout`.

### Guest mode

Credentials are optional. Without them the backend creates tasks in a pending state that need an explicit `PUT /tools/tasks/:id/start`. Clients must issue that call when unauthenticated; authenticated tasks start on their own.

Nothing should demand credentials up front — a `401` mid-request is the right trigger for an interactive login, which then retries the original request.
