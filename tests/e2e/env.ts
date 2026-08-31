import {
  API_BASE_ENV_VARS,
  API_KEY_ENV_VARS,
  SPACE_ID_ENV_VARS,
  TOKEN_ENV_VARS,
} from '../../src/config/credentials.js';
import { DECKRENDER_ENGINE_ENV } from '../../src/core/engine-selection.js';
import { CHROMIUM_PATH_ENV } from '../../src/engines/local/browser.js';
import { OFFICE2HTML_PATH_ENV } from '../../src/engines/local/binary.js';

const CREDENTIAL_ENV_VARS = [
  ...API_KEY_ENV_VARS,
  ...TOKEN_ENV_VARS,
  ...SPACE_ID_ENV_VARS,
  ...API_BASE_ENV_VARS,
] as const;

/** Build a subprocess environment that cannot inherit developer credentials or config files. */
export function isolatedCliEnv(configDir: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CREDENTIAL_ENV_VARS) {
    delete env[key];
  }
  delete env[DECKRENDER_ENGINE_ENV];
  delete env[CHROMIUM_PATH_ENV];
  delete env[OFFICE2HTML_PATH_ENV];

  return {
    ...env,
    DECKFLOW_CONFIG_DIR: configDir,
    DECKOPS_CONFIG_DIR: configDir,
    DECKRENDER_CONFIG_DIR: configDir,
    NO_COLOR: '1',
    ...overrides,
  };
}
