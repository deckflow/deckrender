import chalk from 'chalk';
import { Command, Option } from 'commander';
import { readConfig } from '../../config/config.js';
import { resolveEnginePreference } from '../../core/engine-selection.js';
import { plannedReason, ROUTES, type BaseRoute } from '../../core/routes.js';
import { LOCAL_ROUTES, localPlannedReason, type LocalRoute } from '../../engines/local/routes.js';
import {
  ENGINE_PREFERENCES,
  SOURCE_FORMATS,
  TARGET_FORMATS,
  type EnginePreference,
  type SourceFormat,
  type TargetFormat,
} from '../../types.js';
import { addOutputFlags, Reporter, type OutputMode } from '../output.js';

export function registerFormatsCommand(program: Command, modeOf: (cmd: Command) => OutputMode): void {
  addOutputFlags(program.command('formats'))
    .description('Show the supported input and output format matrix')
    .addOption(new Option('--engine <engine>', 'Render engine').choices([...ENGINE_PREFERENCES]))
    .action(async function (this: Command) {
      const reporter = new Reporter(modeOf(this));
      try {
        const options = this.opts() as { engine?: EnginePreference };
        const config = await readConfig();
        const engine = resolveEnginePreference(options.engine, config.engine);

        const header = ['input'.padEnd(10), ...TARGET_FORMATS.map((target) => target.padEnd(10))].join(' ');
        const lines = [
          chalk.bold(`Engine: ${engine}`),
          chalk.bold(header),
          chalk.dim('-'.repeat(header.length)),
        ];

        for (const source of SOURCE_FORMATS) {
          const cells = TARGET_FORMATS.map((target) => cell(engine, source, target));
          lines.push([`.${source}`.padEnd(10), ...cells].join(' '));
        }

        lines.push(
          '',
          `${chalk.green('yes')}   supported`,
          `${chalk.magenta('soon')}  planned for the selected engine`,
          chalk.dim('—     not supported'),
          '',
          chalk.dim('Switch matrices with --engine local|cloud|auto.'),
          chalk.dim('Image output supports png|jpg locally; cloud also supports webp.'),
          chalk.dim('Per-format notes and flag support: docs/formats.md')
        );

        reporter.say(lines.join('\n'), buildJsonMatrix(engine));
      } catch (error) {
        reporter.error(error);
      }
    });
}

function cell(engine: EnginePreference, source: SourceFormat, target: TargetFormat): string {
  const selection = matrixEntry(engine, source, target);
  if (selection.route) {
    return chalk.green('yes'.padEnd(10));
  }
  return selection.planned ? chalk.magenta('soon'.padEnd(10)) : chalk.dim('—'.padEnd(10));
}

function buildJsonMatrix(engine: EnginePreference): Record<string, unknown> {
  const matrix: Record<string, unknown> = {};

  for (const source of SOURCE_FORMATS) {
    const row: Record<string, unknown> = {};
    for (const target of TARGET_FORMATS) {
      const selection = matrixEntry(engine, source, target);
      if (selection.route) {
        row[target] = {
          supported: true,
          engine: selection.engine,
          kind: selection.route.kind,
          tasks: selection.route.tasks,
          caveat: selection.route.caveat ?? null,
        };
      } else {
        row[target] = selection.planned
          ? { supported: false, planned: true, reason: selection.planned }
          : { supported: false, planned: false };
      }
    }
    matrix[source] = row;
  }

  return { engine, matrix };
}

function matrixEntry(
  engine: EnginePreference,
  source: SourceFormat,
  target: TargetFormat
): {
  route?: BaseRoute | LocalRoute;
  engine?: 'local' | 'cloud' | 'passthrough';
  planned?: string;
} {
  if (engine === 'local') {
    const route = LOCAL_ROUTES[source]?.[target];
    return route
      ? { route, engine: route.kind === 'passthrough' ? 'passthrough' : 'local' }
      : { planned: localPlannedReason(source, target) };
  }

  if (engine === 'auto') {
    const local = LOCAL_ROUTES[source]?.[target];
    if (local) {
      return { route: local, engine: local.kind === 'passthrough' ? 'passthrough' : 'local' };
    }
  }

  const cloud = ROUTES[source]?.[target];
  return cloud
    ? { route: cloud, engine: cloud.kind === 'passthrough' ? 'passthrough' : 'cloud' }
    : { planned: plannedReason(source, target) };
}
