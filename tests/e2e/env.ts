import {
  API_BASE_ENV_VARS,
  API_KEY_ENV_VARS,
  SPACE_ID_ENV_VARS,
  TOKEN_ENV_VARS,
} from '../../src/config/credentials.js';

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

  return {
    ...env,
    DECKFLOW_CONFIG_DIR: configDir,
    DECKOPS_CONFIG_DIR: configDir,
    DECKRENDER_CONFIG_DIR: configDir,
    NO_COLOR: '1',
    ...overrides,
  };
}
