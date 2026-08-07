import { Command, Option } from 'commander';
import { DeckRenderError } from '../../errors/index.js';
import { createRenderer } from '../../core/renderer.js';
import { readConfig } from '../../config/config.js';
import { hasCredentials, resolveCredentials, writeSharedCredentials } from '../../config/credentials.js';
import { runCheckoutFlow, runLoginFlow } from '../../auth/login.js';
import { inferFromOutputPath } from '../../output/naming.js';
import { layerOptions, PROFILES } from '../profiles.js';
import { addOutputFlags, Reporter, type OutputMode } from '../output.js';
import {
  IMAGE_FORMATS,
  PROFILE_NAMES,
  QUALITIES,
  SOURCE_FORMATS,
  TARGET_FORMATS,
  type ImageFormat,
  type ProfileName,
  type Quality,
  type SourceFormat,
  type TargetFormat,
} from '../../types.js';

interface RenderCliOptions {
  from?: SourceFormat;
  format?: TargetFormat;
  imageFormat?: ImageFormat;
  output?: string;
  pages?: string;
  page?: string;
  width?: string;
  scale?: string;
  quality?: Quality;
  profile?: ProfileName;
  embedFonts?: boolean;
  timeout?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  // Accepted so the error can explain *why* they do not work, instead of
  // commander rejecting them as unknown flags.
  fps?: string;
  duration?: string;
  transition?: string;
}

export function registerRenderCommand(program: Command): void {
  addOutputFlags(program)
    .argument('[input]', 'File path, http(s) URL, or - for stdin')
    .option('-o, --output <path>', 'Output file, directory, .zip, or - for stdout')
    .addOption(new Option('--format <format>', 'Output format').choices([...TARGET_FORMATS]))
    .addOption(new Option('--image-format <format>', 'Image encoding').choices([...IMAGE_FORMATS]))
    .addOption(
      new Option('--from <format>', 'Source format (required for stdin)').choices([...SOURCE_FORMATS])
    )
    .option('--pages <ranges>', 'Pages to keep, e.g. 1-5 or 1,3,5-7')
    .option('--page <n>', 'Single page to keep')
    .option('--width <px>', 'Target long edge in pixels')
    .option('--scale <n>', 'Multiply the default long edge')
    .addOption(new Option('--quality <level>', 'Quality preset').choices([...QUALITIES]))
    .addOption(new Option('--profile <name>', 'Named flag preset').choices([...PROFILE_NAMES]))
    .option('--embed-fonts', 'Embed fonts on routes that pass through HTML to PPTX')
    .option('--timeout <seconds>', 'Task timeout in seconds')
    .addOption(new Option('--fps <n>', 'Video frame rate').hideHelp())
    .addOption(new Option('--duration <seconds>', 'Seconds per slide').hideHelp())
    .addOption(new Option('--transition <name>', 'Slide transition').hideHelp())
    .addHelpText(
      'after',
      `
Examples:
  $ deckrender deck.pptx                          # -> deck/001.png, 002.png, ...
  $ deckrender deck.pptx -o deck.pdf
  $ deckrender deck.pptx -o deck.mp4
  $ deckrender report.pdf --pages 1-5 --width 2560
  $ deckrender page.html -o shot.png
  $ deckrender https://example.com -o shot.png
  $ cat page.html | deckrender - --from html -o shot.png
  $ deckrender deck.pptx --profile web -o frames/
  $ deckrender deck.pptx --json | jq -r '.outputs[0].file'

Run 'deckrender formats' for the full input/output matrix.`
    )
    .action(async (input: string | undefined, options: RenderCliOptions) => {
      const mode: OutputMode = {
        json: Boolean(options.json),
        quiet: Boolean(options.quiet),
        verbose: Boolean(options.verbose),
      };
      const reporter = new Reporter(mode);

      try {
        if (mode.quiet && mode.verbose) {
          throw DeckRenderError.usage('--quiet conflicts with --verbose.');
        }
        if (!input) {
          // Print help for orientation, but exit 2 like any other usage error
          // so scripts can branch on the code rather than parsing text.
          process.stderr.write(`${program.helpInformation()}\n`);
          throw DeckRenderError.usage('No input given.');
        }
        if (mode.json && options.output === '-') {
          throw DeckRenderError.usage('--json cannot be combined with --output -.', {
            hint: 'Choose JSON metadata or raw artifact bytes for stdout, not both.',
          });
        }

        rejectVideoTuning(options);
        await runRender(input, options, reporter, mode);
      } catch (error) {
        reporter.error(error);
      }
    });
}

/**
 * `convertor.ppt2video` takes no parameters at all, so these flags cannot be
 * honoured. Failing loudly beats accepting them and rendering something else.
 */
function rejectVideoTuning(options: RenderCliOptions): void {
  const given = (['fps', 'duration', 'transition'] as const).filter((key) => options[key] !== undefined);
  if (given.length === 0) {
    return;
  }

  throw DeckRenderError.unsupportedOption(
    `${given.map((key) => `--${key}`).join(', ')} ${given.length > 1 ? 'are' : 'is'} not supported yet.`,
    {
      hint:
        'The DeckOps task convertor.ppt2video accepts no parameters. ' +
        'Video tuning is tracked for v0.3 — see docs/roadmap.md.',
    }
  );
}

async function runRender(
  input: string,
  options: RenderCliOptions,
  reporter: Reporter,
  mode: OutputMode
): Promise<void> {
  const config = await readConfig();
  const inferred = options.output ? inferFromOutputPath(options.output) : {};

  if (options.pages && options.page) {
    throw DeckRenderError.usage('--pages conflicts with --page.');
  }
  if (options.format && inferred.format && options.format !== inferred.format) {
    reporter.warn(
      `Output extension implies ${inferred.format} but --format says ${options.format}; using --format.`
    );
  }

  const profile = options.profile
    ? PROFILES[options.profile]
    : config.profile
      ? PROFILES[config.profile]
      : undefined;

  const { options: layered, soft } = layerOptions(
    profile,
    {
      ...(config.format ? { format: config.format } : {}),
      ...(config.imageFormat ? { imageFormat: config.imageFormat } : {}),
      ...(config.quality ? { quality: config.quality } : {}),
      ...(config.width !== undefined ? { width: config.width } : {}),
      ...(config.scale !== undefined ? { scale: config.scale } : {}),
      ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
    },
    {
      ...((options.format ?? inferred.format) ? { format: options.format ?? inferred.format } : {}),
      ...((options.imageFormat ?? inferred.imageFormat)
        ? { imageFormat: options.imageFormat ?? inferred.imageFormat }
        : {}),
      ...(options.quality ? { quality: options.quality } : {}),
      ...(options.width !== undefined ? { width: positiveNumber(options.width, '--width') } : {}),
      ...(options.scale !== undefined ? { scale: positiveNumber(options.scale, '--scale') } : {}),
      ...(options.pages ? { pages: options.pages } : {}),
      ...(options.page ? { pages: options.page } : {}),
      ...(options.embedFonts !== undefined ? { embedFonts: options.embedFonts } : {}),
      ...(options.timeout !== undefined ? { timeout: positiveNumber(options.timeout, '--timeout') } : {}),
    }
  );

  // `--format` derived from the output extension is explicit enough to keep
  // hard, but everything inherited from a profile or config stays soft.
  const credentials = await resolveCredentials();
  const authenticated = hasCredentials(credentials);

  reporter.detail(`Input: ${input}`);
  reporter.detail(`Format: ${layered.format ?? 'image'}`);
  reporter.detail(
    `Credentials: ${authenticated ? (credentials.sources.apiKey ?? credentials.sources.token) : 'none (guest mode)'}`
  );

  // Opening a browser only makes sense at a terminal. Under --json or in CI a
  // 401 has to fail as auth_error instead of hanging on a login nobody can
  // complete.
  const interactive = !mode.json && process.stdout.isTTY === true;
  if (!interactive && !authenticated) {
    reporter.detail('Non-interactive session: a 401 will fail rather than prompt for login.');
  }

  const renderer = createRenderer({
    onWarning: (message) => reporter.warn(message),
    ...(interactive
      ? {
          onUnauthorized: async () => {
            reporter.stopProgress();
            const result = await runLoginFlow({
              apiBase: credentials.apiBase,
              onUrl: (url) => reporter.note(`Opening browser to ${url}`),
            });
            await writeSharedCredentials({
              token: result.token,
              ...(result.spaceId ? { spaceId: result.spaceId } : {}),
            });
            return result;
          },
          onPaymentRequired: async () => {
            reporter.stopProgress();
            const fresh = await resolveCredentials();
            if (!fresh.token) {
              throw DeckRenderError.auth('Checkout requires a logged-in session.');
            }
            await runCheckoutFlow({
              apiBase: fresh.apiBase,
              token: fresh.token,
              ...(fresh.spaceId ? { spaceId: fresh.spaceId } : {}),
              onUrl: (url) => reporter.note(`Opening browser to ${url}`),
            });
          },
        }
      : {}),
  });

  const result = await renderer.render({
    input,
    ...(options.from ? { from: options.from } : {}),
    ...(layered.format ? { format: layered.format } : {}),
    ...(layered.imageFormat ? { imageFormat: layered.imageFormat } : {}),
    ...(options.output ? { out: options.output } : {}),
    ...(layered.pages ? { pages: layered.pages } : {}),
    ...(layered.width !== undefined ? { width: layered.width } : {}),
    ...(layered.scale !== undefined ? { scale: layered.scale } : {}),
    ...(layered.quality ? { quality: layered.quality } : {}),
    ...(layered.embedFonts !== undefined ? { embedFonts: layered.embedFonts } : {}),
    ...(layered.timeout !== undefined ? { timeout: layered.timeout } : {}),
    soft,
    onProgress: (event) => reporter.progress(event.message),
  });

  reporter.stopProgress();
  reporter.detail(`Route: ${result.route.join(' → ')}`);
  // The writer already emitted the artifact bytes. Any success line or JSON
  // here would corrupt the binary stream.
  if (options.output === '-') {
    return;
  }
  reporter.result(result, targetLine(result));
}

function targetLine(result: { outputs: { file: string }[] }): string {
  const files = result.outputs.map((output) => output.file);
  if (files.length === 1) {
    return files[0]!;
  }
  const first = files[0] ?? '';
  const directory = first.slice(0, first.lastIndexOf('/'));
  return directory || first;
}

function positiveNumber(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw DeckRenderError.usage(`Invalid ${flag}: ${raw}. Expected a positive number.`);
  }
  return value;
}
