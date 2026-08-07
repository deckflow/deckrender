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
        `${chalk.green('yes')}      one backend task`,
        `${chalk.yellow('chained')}  several tasks; slower, and fidelity notes may apply`,
        `${chalk.green('copy')}     already in the target format, copied without re-rendering`,
        `${chalk.cyan('local')}    rendered on this machine, no network`,
        `${chalk.magenta('soon')}     planned, not built yet`,
        chalk.dim('—        not supported'),
        '',
        chalk.dim('Image output also supports --image-format png|jpg|webp.'),
        chalk.dim('Full details, including per-route flag support: contracts/render-matrix.md')
      );

      reporter.say(lines.join('\n'), buildJsonMatrix());
    });
}

function cell(source: SourceFormat, target: TargetFormat): string {
  const route = ROUTES[source]?.[target];

  if (!route) {
    // Pad before colouring: ANSI escapes would otherwise count toward width.
    return plannedReason(source, target) ? chalk.magenta('soon'.padEnd(10)) : chalk.dim('—'.padEnd(10));
  }

  const label =
    route.kind === 'passthrough'
      ? 'copy'
      : route.kind === 'local'
        ? 'local'
        : route.kind === 'direct'
          ? 'yes'
          : 'chained';
  const padded = label.padEnd(10);

  if (route.kind === 'derived') return chalk.yellow(padded);
  if (route.kind === 'local') return chalk.cyan(padded);
  return chalk.green(padded);
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
