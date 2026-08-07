import chalk from 'chalk';
import { Command } from 'commander';
import { plannedReason, ROUTES } from '../../core/routes.js';
import { SOURCE_FORMATS, TARGET_FORMATS, type SourceFormat, type TargetFormat } from '../../types.js';
import { addOutputFlags, Reporter, type OutputMode } from '../output.js';

/**
 * Print the render matrix.
 *
 * The matrix has real holes, so users need a way to see what is possible
 * without hitting `unsupported_format` by trial and error. It also separates
 * "not yet" from "never", because those lead to different decisions.
 */
export function registerFormatsCommand(program: Command, modeOf: (cmd: Command) => OutputMode): void {
  addOutputFlags(program.command('formats'))
    .description('Show the supported input and output format matrix')
    .action(function (this: Command) {
      const reporter = new Reporter(modeOf(this));

      const header = ['input'.padEnd(10), ...TARGET_FORMATS.map((t) => t.padEnd(10))].join(' ');
      const lines = [chalk.bold(header), chalk.dim('-'.repeat(header.length))];

      for (const source of SOURCE_FORMATS) {
        const cells = TARGET_FORMATS.map((target) => cell(source, target));
        lines.push([`.${source}`.padEnd(10), ...cells].join(' '));
      }

      lines.push(
        '',
        `${chalk.green('yes')}   supported`,
        `${chalk.magenta('soon')}  planned, not built yet`,
        chalk.dim('—     not supported'),
        '',
        chalk.dim('Image output also supports --image-format png|jpg|webp.'),
        chalk.dim('Per-format notes and flag support: docs/formats.md')
      );

      reporter.say(lines.join('\n'), buildJsonMatrix());
    });
}

/**
 * One matrix cell.
 *
 * Deliberately says only whether the combination works. How it is produced —
 * one backend task, a chain of them, or an engine on this machine — is an
 * implementation detail that would only invite users to read some supported
 * routes as second class. `--json` still carries the full route for tooling
 * that needs it.
 */
function cell(source: SourceFormat, target: TargetFormat): string {
  // Pad before colouring: ANSI escapes would otherwise count toward width.
  if (ROUTES[source]?.[target]) {
    return chalk.green('yes'.padEnd(10));
  }
  return plannedReason(source, target) ? chalk.magenta('soon'.padEnd(10)) : chalk.dim('—'.padEnd(10));
}

function buildJsonMatrix(): Record<string, unknown> {
  const matrix: Record<string, unknown> = {};

  for (const source of SOURCE_FORMATS) {
    const row: Record<string, unknown> = {};

    for (const target of TARGET_FORMATS) {
      const route = ROUTES[source]?.[target];
      if (route) {
        row[target] = {
          supported: true,
          kind: route.kind,
          tasks: route.tasks,
          caveat: route.caveat ?? null,
        };
        continue;
      }

      const planned = plannedReason(source, target);
      row[target] = planned
        ? { supported: false, planned: true, reason: planned }
        : { supported: false, planned: false };
    }

    matrix[source] = row;
  }

  return { matrix };
}
