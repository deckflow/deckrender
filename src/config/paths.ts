import os from 'node:os';
import path from 'node:path';

/**
 * Config locations.
 *
 * Two directories, on purpose:
 *
 * - `~/.deckflow/` is the **organization-wide** store. Credentials written here
 *   are shared with DeckHTML and any other DeckFlow tool, which is the whole
 *   point of `deckrender auth login` (see contracts/credentials.md).
 * - `~/.deckrender/` holds render defaults that are ours alone, so profile and
 *   image-format preferences never pollute the shared credential file.
 *
 * `~/.deckops/config.json` is read as a fallback but **never** written — it is
 * the DeckOps CLI's own state.
 */
export const DECKFLOW_DIR_ENV = 'DECKFLOW_CONFIG_DIR';
export const DECKRENDER_DIR_ENV = 'DECKRENDER_CONFIG_DIR';
export const DECKOPS_DIR_ENV = 'DECKOPS_CONFIG_DIR';

export function deckflowDir(): string {
  return process.env[DECKFLOW_DIR_ENV] ?? path.join(os.homedir(), '.deckflow');
}

export function deckrenderDir(): string {
  return process.env[DECKRENDER_DIR_ENV] ?? path.join(os.homedir(), '.deckrender');
}

export function deckopsDir(): string {
  return process.env[DECKOPS_DIR_ENV] ?? path.join(os.homedir(), '.deckops');
}

/** Shared credential file. Format defined in contracts/credentials.md. */
export function credentialsPath(): string {
  return path.join(deckflowDir(), 'credentials');
}

/** DeckRender's own render defaults. */
export function configPath(): string {
  return path.join(deckrenderDir(), 'config.json');
}

/** DeckOps CLI config, read-only fallback. */
export function deckopsConfigPath(): string {
  return path.join(deckopsDir(), 'config.json');
}

/** Directory mode for config dirs — matches what other DeckFlow tools create. */
export const DIR_MODE = 0o700;
/** File mode for anything holding a secret. */
export const SECRET_FILE_MODE = 0o600;
