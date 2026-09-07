import os from 'node:os';
import path from 'node:path';

/**
 * Config locations.
 *
 * Two directories, on purpose:
 *
 * - `~/.deckflow/` is the **organization-wide** store. Credentials written here
 *   are shared with DeckHTML and any other DeckFlow tool, which is the whole
 *   point of `deckrender auth login` (see docs/configuration.md).
 * - `~/.deckrender/` holds render defaults that are ours alone, so profile and
 *   image-format preferences never pollute the shared credential file.
 *
 * Product configuration from DeckTools or DeckTools is not a credential source.
 */
export const DECKFLOW_DIR_ENV = 'DECKFLOW_CONFIG_DIR';
export const DECKRENDER_DIR_ENV = 'DECKRENDER_CONFIG_DIR';

export function deckflowDir(): string {
  return process.env[DECKFLOW_DIR_ENV] ?? path.join(os.homedir(), '.deckflow');
}

export function deckrenderDir(): string {
  return process.env[DECKRENDER_DIR_ENV] ?? path.join(os.homedir(), '.deckrender');
}

/** Shared credential file. Format defined in docs/configuration.md. */
export function credentialsPath(): string {
  return path.join(deckflowDir(), 'credentials');
}

/** DeckRender's own render defaults. */
export function configPath(): string {
  return path.join(deckrenderDir(), 'config.json');
}

/** Directory mode for config dirs — matches what other DeckFlow tools create. */
export const DIR_MODE = 0o700;
/** File mode for anything holding a secret. */
export const SECRET_FILE_MODE = 0o600;
