import fs from 'node:fs/promises';
import { z } from 'zod';
import { DIR_MODE, configPath, deckrenderDir } from './paths.js';
import { DeckRenderError } from '../errors/DeckRenderError.js';
import { IMAGE_FORMATS, PROFILE_NAMES, QUALITIES, TARGET_FORMATS } from '../types.js';

/**
 * `~/.deckrender/config.json` — render defaults only.
 *
 * Credentials deliberately live elsewhere (`~/.deckflow/credentials`) so that
 * changing a render preference never rewrites a file other DeckFlow tools read.
 */
export const ConfigSchema = z
  .object({
    profile: z.enum(PROFILE_NAMES).optional(),
    format: z.enum(TARGET_FORMATS).optional(),
    imageFormat: z.enum(IMAGE_FORMATS).optional(),
    quality: z.enum(QUALITIES).optional(),
    width: z.number().int().positive().optional(),
    scale: z.number().positive().optional(),
    timeout: z.number().int().positive().optional(),
  })
  .strict();

export type ConfigData = z.infer<typeof ConfigSchema>;

/** Config keys as written on the command line, e.g. `image-format`. */
export const CONFIG_KEYS = [
  'profile',
  'format',
  'image-format',
  'quality',
  'width',
  'scale',
  'timeout',
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

const KEY_TO_FIELD: Record<ConfigKey, keyof ConfigData> = {
  profile: 'profile',
  format: 'format',
  'image-format': 'imageFormat',
  quality: 'quality',
  width: 'width',
  scale: 'scale',
  timeout: 'timeout',
};

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}

export function configFieldFor(key: ConfigKey): keyof ConfigData {
  return KEY_TO_FIELD[key];
}

export async function readConfig(): Promise<ConfigData> {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), 'utf-8'));
    const parsed = ConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function writeConfig(data: ConfigData): Promise<string> {
  const validated = ConfigSchema.parse(data);
  const file = configPath();
  await fs.mkdir(deckrenderDir(), { recursive: true, mode: DIR_MODE });
  await fs.writeFile(file, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
  return file;
}

/** Values each enum-valued key accepts, for validation and for help text. */
const ALLOWED_VALUES: Partial<Record<ConfigKey, readonly string[]>> = {
  profile: PROFILE_NAMES,
  format: TARGET_FORMATS,
  'image-format': IMAGE_FORMATS,
  quality: QUALITIES,
};

const NUMERIC_KEYS: ConfigKey[] = ['width', 'scale', 'timeout'];

export function allowedValuesFor(key: ConfigKey): readonly string[] | undefined {
  return ALLOWED_VALUES[key];
}

/**
 * Set one key and persist. Returns the file path written.
 *
 * Validation happens here rather than being left to the schema so a bad value
 * surfaces as a usage error naming the accepted values, instead of a raw
 * ZodError that the CLI would classify as a render failure.
 */
export async function setConfigValue(key: ConfigKey, rawValue: string): Promise<string> {
  const field = configFieldFor(key);
  const allowed = ALLOWED_VALUES[key];

  let value: unknown = rawValue;

  if (allowed && !allowed.includes(rawValue)) {
    throw DeckRenderError.usage(`Invalid value for ${key}: ${rawValue}`, {
      hint: `Allowed values: ${allowed.join(', ')}`,
    });
  }

  if (NUMERIC_KEYS.includes(key)) {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw DeckRenderError.usage(`Invalid value for ${key}: ${rawValue}`, {
        hint: 'Expected a positive number.',
      });
    }
    value = numeric;
  }

  const current = await readConfig();
  const parsed = ConfigSchema.safeParse({ ...current, [field]: value });
  if (!parsed.success) {
    throw DeckRenderError.usage(`Invalid value for ${key}: ${rawValue}`, {
      hint: parsed.error.issues[0]?.message,
    });
  }

  return writeConfig(parsed.data);
}

export async function unsetConfigValue(key: ConfigKey): Promise<string> {
  const current = await readConfig();
  const next = { ...current };
  delete next[configFieldFor(key)];
  return writeConfig(next);
}
