import chalk from 'chalk';
import { Command } from 'commander';
import { DeckRenderError } from '../../errors/index.js';
import {
  CONFIG_KEYS,
  configPath,
  credentialsPath,
  deckopsConfigPath,
  displayPath,
  isConfigKey,
  maskSecret,
  readConfig,
  resolveCredentials,
  setConfigValue,
  unsetConfigValue,
  writeSharedCredentials,
} from '../../config/index.js';
import { addOutputFlags, Reporter, type OutputMode } from '../output.js';

const API_KEY = 'api-key';

export function registerConfigCommands(program: Command, modeOf: (cmd: Command) => OutputMode): void {
  const config = program.command('config').description('Manage render defaults and stored credentials');

  addOutputFlags(config.command('set <key> <value>'))
    .description(`Set a value. Keys: ${API_KEY}, ${CONFIG_KEYS.join(', ')}`)
    .action(async function (this: Command, key: string, value: string) {
      const reporter = new Reporter(modeOf(this));
      try {
        // The API key belongs in the shared file so DeckHTML and DeckOps see it;
        // render defaults belong to DeckRender alone.
        if (key === API_KEY) {
          const file = await writeSharedCredentials({ apiKey: value });
          reporter.say(`Stored api-key in ${displayPath(file)} (shared with all DeckFlow tools).`, {
            ok: true,
            key,
            file: displayPath(file),
          });
          return;
        }

        if (!isConfigKey(key)) {
          throw DeckRenderError.usage(`Unknown config key: ${key}`, {
            hint: `Valid keys: ${API_KEY}, ${CONFIG_KEYS.join(', ')}`,
          });
        }

        const file = await setConfigValue(key, value);
        reporter.say(`Set ${key} = ${value} in ${displayPath(file)}.`, {
          ok: true,
          key,
          value,
          file: displayPath(file),
        });
      } catch (error) {
        reporter.error(error);
      }
    });

  addOutputFlags(config.command('unset <key>'))
    .description('Remove a stored value')
    .action(async function (this: Command, key: string) {
      const reporter = new Reporter(modeOf(this));
      try {
        if (key === API_KEY) {
          const file = await writeSharedCredentials({ apiKey: null });
          reporter.say(`Removed api-key from ${displayPath(file)}.`, { ok: true, key });
          return;
        }
        if (!isConfigKey(key)) {
          throw DeckRenderError.usage(`Unknown config key: ${key}`, {
            hint: `Valid keys: ${API_KEY}, ${CONFIG_KEYS.join(', ')}`,
          });
        }
        const file = await unsetConfigValue(key);
        reporter.say(`Removed ${key} from ${displayPath(file)}.`, { ok: true, key });
      } catch (error) {
        reporter.error(error);
      }
    });

  addOutputFlags(config.command('list'))
    .description('Show effective settings and where each value came from')
    .action(async function (this: Command) {
      const reporter = new Reporter(modeOf(this));
      try {
        const stored = await readConfig();
        const credentials = await resolveCredentials();

        // Naming the source is the whole point: it answers "why is it not using
        // the key I just set?" without guesswork.
        const lines = [chalk.bold('Credentials')];
        lines.push(
          `  api-key   ${credentials.apiKey ? maskSecret(credentials.apiKey) : chalk.dim('(unset)')}  ${dim(credentials.sources.apiKey)}`
        );
        lines.push(
          `  token     ${credentials.token ? maskSecret(credentials.token) : chalk.dim('(unset)')}  ${dim(credentials.sources.token)}`
        );
        lines.push(
          `  space-id  ${credentials.spaceId ?? chalk.dim('(unset)')}  ${dim(credentials.sources.spaceId)}`
        );
        lines.push(`  api-base  ${credentials.apiBase}  ${dim(credentials.sources.apiBase)}`);

        lines.push('', chalk.bold('Render defaults'));
        for (const key of CONFIG_KEYS) {
          const field = key === 'image-format' ? 'imageFormat' : key;
          const value = (stored as Record<string, unknown>)[field];
          lines.push(`  ${key.padEnd(12)} ${value === undefined ? chalk.dim('(unset)') : String(value)}`);
        }

        lines.push('', chalk.bold('Files'));
        lines.push(`  shared credentials  ${displayPath(credentialsPath())}`);
        lines.push(`  render defaults     ${displayPath(configPath())}`);
        lines.push(`  deckops (read-only) ${displayPath(deckopsConfigPath())}`);

        reporter.say(lines.join('\n'), {
          credentials: {
            apiKey: credentials.apiKey ? maskSecret(credentials.apiKey) : null,
            token: credentials.token ? maskSecret(credentials.token) : null,
            spaceId: credentials.spaceId ?? null,
            apiBase: credentials.apiBase,
            sources: credentials.sources,
          },
          defaults: stored,
          files: {
            credentials: credentialsPath(),
            config: configPath(),
            deckops: deckopsConfigPath(),
          },
        });
      } catch (error) {
        reporter.error(error);
      }
    });

  addOutputFlags(config.command('path'))
    .description('Print the config file paths')
    .action(function (this: Command) {
      const reporter = new Reporter(modeOf(this));
      reporter.say(
        [
          `shared credentials  ${displayPath(credentialsPath())}`,
          `render defaults     ${displayPath(configPath())}`,
          `deckops (read-only) ${displayPath(deckopsConfigPath())}`,
        ].join('\n'),
        {
          credentials: credentialsPath(),
          config: configPath(),
          deckops: deckopsConfigPath(),
        }
      );
    });
}

function dim(source: string | undefined): string {
  return source ? chalk.dim(`(${source})`) : '';
}
