#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { registerAuthCommands } from './cli/commands/auth.js';
import { registerConfigCommands } from './cli/commands/config.js';
import { registerFormatsCommand } from './cli/commands/formats.js';
import { registerRenderCommand } from './cli/commands/render.js';
import { ExitCode } from './errors/index.js';
import type { OutputMode } from './cli/output.js';
import { VERSION } from './version.js';

function outputModeOf(command: Command): OutputMode {
  const options = command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean };
  return {
    json: Boolean(options.json),
    quiet: Boolean(options.quiet),
    verbose: Boolean(options.verbose),
  };
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('deckrender')
    .description('Render PPTX, PDF, DOCX, Keynote, HTML and Markdown into images, PDF or video')
    .version(VERSION, '--version', 'Show version information')
    .enablePositionalOptions()
    .showHelpAfterError()
    // Commander exits 1 on its own parse failures, but an unknown flag or an
    // invalid enum value is a usage error, which our contract puts at exit 2.
    // Taking the exit over lets main() apply the documented codes. Subcommands
    // inherit this through commander's settings copy.
    .exitOverride();

  // Subcommands are registered before the default render action so that
  // `deckrender auth login` dispatches to the subcommand rather than being
  // treated as a file named "auth".
  registerAuthCommands(program, outputModeOf);
  registerConfigCommands(program, outputModeOf);
  registerFormatsCommand(program, outputModeOf);
  registerRenderCommand(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` and `--version` are successful requests, not failures.
      // Everything else commander rejects is a usage error.
      const succeeded =
        error.code === 'commander.version' ||
        error.code === 'commander.help' ||
        error.code === 'commander.helpDisplayed';
      process.exit(succeeded ? ExitCode.SUCCESS : ExitCode.USAGE);
    }
    // Command actions report their own errors through Reporter and exit; this
    // only catches failures raised outside an action handler.
    console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
    process.exit(ExitCode.ERROR);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(ExitCode.ERROR);
});
