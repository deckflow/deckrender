# Contract: Shared DeckFlow Credentials

> Frozen contract. Changing anything here needs coordination with the other DeckFlow tools that read the same file.

## Purpose

Every DeckFlow CLI authenticates against the same backend, so a user should log in once. This document defines the shared credential file so DeckRender, DeckHTML and future tools interoperate.

DeckHTML's documentation names the path (`~/.deckflow/credentials`) but ships no implementation, so DeckRender is the first writer and this file records the format it established.

## Location

```
~/.deckflow/credentials
```

Override the directory with `DECKFLOW_CONFIG_DIR` — useful in CI and tests.

| Path                      | Mode   |
| ------------------------- | ------ |
| `~/.deckflow/`            | `0700` |
| `~/.deckflow/credentials` | `0600` |

Permissions are enforced on every write, including to a pre-existing file.

## Format

JSON. Every field optional.

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

## Rules for implementors

1. **Read-merge-write.** Never rewrite the file wholesale. Unknown keys belong to another tool and must survive. DeckRender preserves them; so must you.
2. **Tolerate malformed content.** A corrupt or partially written file resolves to "no credentials", never a crash.
3. **Never write another tool's config.** `~/.deckops/config.json` is readable as a fallback but is owned by the DeckOps CLI.
4. **Keep tool-specific settings out.** Render defaults, output preferences and the like belong in the tool's own directory (`~/.deckrender/config.json` for DeckRender).

## Resolution order

Each field resolves independently, first match wins:

1. Explicit argument (`--api-key`, `--token`, `--api-base`)
2. Environment:
   - api key: `DECKRENDER_API_KEY` → `DECKFLOW_API_KEY` → `DECKHTML_API_KEY`
   - token: `DECKRENDER_TOKEN` → `DECKFLOW_TOKEN`
   - space: `DECKRENDER_SPACE_ID` → `DECKFLOW_SPACE_ID`
   - api base: `DECKRENDER_API_BASE` → `DECKFLOW_API_BASE`
3. `~/.deckflow/credentials`
4. `~/.deckops/config.json` — read-only fallback
5. Built-in default (`apiBase` only)

`DECKHTML_API_KEY` is in the chain deliberately: a machine already set up for DeckHTML must work with DeckRender untouched.

Because fields resolve independently, an API key from the environment can combine with a `spaceId` left behind by a `deckops` login.

`deckrender config list` prints the source of every value.

## Login flow

Byte-for-byte compatible with the DeckOps CLI, so a token obtained by any tool works in all of them:

```
GET {apiBase minus /v1}/cli/auth?redirect_url=http://localhost:3737
      ↓ browser completes login, redirects back
GET http://localhost:3737/?token=<token>&spaceId=<spaceId>
```

The callback server accepts `spaceId` or `space_id`, listens on port 3737 by default, and times out after 5 minutes.

Checkout, for a `402 Payment Required`, follows the same shape at `/cli/checkout`.

## Guest mode

Credentials are optional. Without them the backend creates tasks in a pending state that require an explicit `PUT /tools/tasks/:id/start`. Clients must issue that call when unauthenticated; authenticated tasks start on their own.

Nothing should demand credentials up front. A `401` mid-request is the correct trigger for an interactive login, which then retries the original request.
