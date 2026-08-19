import chalk from 'chalk';
import { Command } from 'commander';
import { createDeck } from '@deckops/sdk';
import { runLoginFlow } from '../../auth/login.js';
import { mapSdkError } from '../../errors/index.js';
import {
  credentialsPath,
  describeCredentialOrigin,
  displayPath,
  hasCredentials,
  maskSecret,
  resolveCredentials,
  writeSharedCredentials,
} from '../../config/index.js';
import { addOutputFlags, Reporter, type OutputMode } from '../output.js';

export function registerAuthCommands(program: Command, modeOf: (cmd: Command) => OutputMode): void {
  const auth = program.command('auth').description('Manage DeckFlow credentials');

  addOutputFlags(auth.command('login'))
    .description('Log in through the browser and store the token for all DeckFlow tools')
    .option('--port <n>', 'Local callback port', '3737')
    .action(async function (this: Command, options: { port: string }) {
      const reporter = new Reporter(modeOf(this));
      try {
        const credentials = await resolveCredentials();
        const result = await runLoginFlow({
          apiBase: credentials.apiBase,
          port: Number(options.port),
          onUrl: (url) => reporter.note(`Opening browser to ${url}`),
        });

        const file = await writeSharedCredentials({
          token: result.token,
          ...(result.spaceId ? { spaceId: result.spaceId } : {}),
        });

        reporter.say(
          `${chalk.green('Logged in.')} Token stored at ${displayPath(file)} and shared with every DeckFlow CLI.`,
          { ok: true, stored: displayPath(file), spaceId: result.spaceId }
        );
      } catch (error) {
        reporter.error(error);
      }
    });

  addOutputFlags(auth.command('status'))
    .description('Show which credentials are in effect and where they came from')
    .action(async function (this: Command) {
      const reporter = new Reporter(modeOf(this));
      try {
        const credentials = await resolveCredentials();

        if (!hasCredentials(credentials)) {
          reporter.say(
            [
              chalk.yellow('Not authenticated.'),
              'DeckRender still works in guest mode; log in for higher quotas and private spaces.',
              '  deckrender auth login',
            ].join('\n'),
            { ok: true, authenticated: false, apiBase: credentials.apiBase }
          );
          return;
        }

        // A stored credential proves nothing until the backend accepts it.
        const client = createDeck({
          root: credentials.apiBase,
          ...(credentials.token ? { token: credentials.token } : {}),
          ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
          ...(credentials.spaceId ? { spaceId: credentials.spaceId } : {}),
        });

        try {
          await client.tasks.list({ maxResults: 1 });
        } catch (error) {
          const origin = describeCredentialOrigin(credentials);
          throw mapSdkError(error, 'render_error', origin ? { credentialOrigin: origin } : {});
        }

        const lines = [chalk.green('Authenticated.')];
        if (credentials.apiKey) {
          lines.push(`  api key   ${maskSecret(credentials.apiKey)}  (${credentials.sources.apiKey})`);
        }
        if (credentials.token) {
          lines.push(`  token     ${maskSecret(credentials.token)}  (${credentials.sources.token})`);
        }
        if (credentials.spaceId) {
          lines.push(`  space     ${credentials.spaceId}  (${credentials.sources.spaceId})`);
        }
        lines.push(`  api base  ${credentials.apiBase}  (${credentials.sources.apiBase})`);

        reporter.say(lines.join('\n'), {
          ok: true,
          authenticated: true,
          apiBase: credentials.apiBase,
          sources: credentials.sources,
          spaceId: credentials.spaceId,
        });
      } catch (error) {
        reporter.error(error);
      }
    });

  addOutputFlags(auth.command('logout'))
    .description('Remove stored credentials from the shared DeckFlow credential file')
    .action(async function (this: Command) {
      const reporter = new Reporter(modeOf(this));
      try {
        const file = await writeSharedCredentials({ token: null, apiKey: null, spaceId: null });
        reporter.say(`Cleared credentials in ${displayPath(file)}.`, {
          ok: true,
          cleared: displayPath(file),
        });

        const remaining = await resolveCredentials();
        if (hasCredentials(remaining)) {
          const source = remaining.sources.apiKey ?? remaining.sources.token;
          reporter.warn(`Credentials are still active from ${source}. Unset it to fully log out.`);
        }
      } catch (error) {
        reporter.error(error);
      }
    });

  addOutputFlags(auth.command('path'))
    .description('Print the shared credential file path')
    .action(function (this: Command) {
      const reporter = new Reporter(modeOf(this));
      const file = credentialsPath();
      reporter.say(displayPath(file), { path: file });
    });
}
