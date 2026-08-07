import chalk from 'chalk';
import { Command } from 'commander';
import ora, { type Ora } from 'ora';
import { DeckRenderError, isDeckRenderError } from '../errors/index.js';
import type { RenderResult } from '../types.js';

export interface OutputMode {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
}

/**
 * Attach the output-mode flags to a command.
 *
 * Commander does not let a subcommand parse an option declared only on its
 * parent, so every leaf command declares these itself. Otherwise
 * `deckrender config list --json` would fail as an unknown option and users
 * would have to write `deckrender --json config list`.
 */
export function addOutputFlags(command: Command): Command {
  return command
    .option('--json', 'Emit machine-readable JSON on stdout')
    .option('--quiet', 'Suppress progress and warnings')
    .option('-v, --verbose', 'Write detailed logs to stderr');
}

/**
 * Stdout carries results; stderr carries everything else.
 *
 * This split is what makes `OUT=$(deckrender deck.pptx --json | jq -r .outputs[0].file)`
 * safe, so nothing diagnostic may ever reach stdout.
 */
export class Reporter {
  private spinner?: Ora;

  constructor(private readonly mode: OutputMode) {}

  /** Transient progress. Suppressed under --json and --quiet. */
  progress(message: string): void {
    if (this.mode.json || this.mode.quiet) {
      return;
    }
    if (this.spinner) {
      this.spinner.text = message;
      return;
    }
    this.spinner = ora({ text: message, stream: process.stderr }).start();
  }

  /** Detail shown only with --verbose. */
  detail(message: string): void {
    if (this.mode.json || this.mode.quiet || !this.mode.verbose) {
      return;
    }
    this.withSpinnerPaused(() => console.error(chalk.dim(message)));
  }

  warn(message: string): void {
    if (this.mode.quiet) {
      return;
    }
    if (this.mode.json) {
      console.error(JSON.stringify({ warning: message }));
      return;
    }
    this.withSpinnerPaused(() => console.error(chalk.yellow(`Warning: ${message}`)));
  }

  note(message: string): void {
    if (this.mode.json || this.mode.quiet) {
      return;
    }
    this.withSpinnerPaused(() => console.error(chalk.dim(message)));
  }

  stopProgress(): void {
    this.spinner?.stop();
    this.spinner = undefined;
  }

  /** Final result on stdout. */
  result(result: RenderResult, target: string): void {
    this.stopProgress();
    if (this.mode.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(target);
  }

  /** Arbitrary command output on stdout, e.g. `config list`. */
  say(text: string, jsonPayload?: unknown): void {
    this.stopProgress();
    if (this.mode.json) {
      console.log(JSON.stringify(jsonPayload ?? { message: text }, null, 2));
      return;
    }
    console.log(text);
  }

  error(error: unknown): never {
    this.stopProgress();
    const rendered = isDeckRenderError(error)
      ? error
      : DeckRenderError.render(error instanceof Error ? error.message : String(error), { cause: error });

    if (this.mode.json) {
      console.error(JSON.stringify({ ok: false, error: rendered.toJSON() }, null, 2));
    } else {
      console.error(chalk.red(`Error: ${rendered.message}`));
      if (rendered.hint) {
        console.error(chalk.dim(`  ${rendered.hint}`));
      }
      if (rendered.requestId) {
        console.error(chalk.dim(`  request id: ${rendered.requestId}`));
      }
    }

    process.exit(rendered.exitCode);
  }

  private withSpinnerPaused(fn: () => void): void {
    const active = this.spinner;
    active?.stop();
    fn();
    active?.start();
  }
}
