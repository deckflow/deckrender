# Security Policy

## Supported versions

The latest published release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately through [GitHub Security Advisories](https://github.com/deckflow/deckrender/security/advisories/new),
or email security@deckflow.com. We aim to acknowledge within three business days.

Include reproduction steps, affected versions, and impact if you can.

## Handling credentials

DeckRender stores credentials at `~/.deckflow/credentials` with mode `0600`,
inside a directory with mode `0700`. Permissions are enforced on every write.

Secrets are masked wherever they are displayed (`config list`, `auth status`)
and are never written to stdout, logs, or the `--json` envelope.

For CI and containers, prefer the environment (`DECKFLOW_API_KEY`) over a file
on disk.

If you believe a credential has leaked, rotate it in your DeckFlow workspace
settings and run `deckrender auth logout`.

## Rendering untrusted documents

Rendering happens on the DeckFlow backend, not on your machine. DeckRender does
fetch URLs you pass it and sends the resulting HTML to that backend, so treat
`deckrender <url>` as you would any request to an untrusted host.
