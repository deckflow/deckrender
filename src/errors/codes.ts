/**
 * Error codes and exit codes.
 *
 * The first four codes are shared verbatim with DeckHTML so that scripts can
 * treat any DeckFlow CLI the same way. `unsupported_format` and
 * `unsupported_option` are DeckRender-specific: the render matrix has real
 * holes (see docs/formats.md) and users need to tell "this pair has
 * no route at all" apart from "the route exists but this knob does not".
 */
export const ERROR_CODES = [
  'usage_error',
  'auth_error',
  'unsupported_format',
  'unsupported_option',
  'not_implemented',
  'render_error',
  'conversion_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

const EXIT_CODE_BY_ERROR: Record<ErrorCode, ExitCodeValue> = {
  usage_error: ExitCode.USAGE,
  unsupported_format: ExitCode.USAGE,
  unsupported_option: ExitCode.USAGE,
  // Planned but not built. Exits like the other "this cannot run" cases so a
  // script only has to branch on 2, while the code distinguishes "never" from
  // "not yet" for a human reading the message.
  not_implemented: ExitCode.USAGE,
  auth_error: ExitCode.AUTH,
  render_error: ExitCode.ERROR,
  conversion_error: ExitCode.ERROR,
};

export function exitCodeFor(code: ErrorCode): ExitCodeValue {
  return EXIT_CODE_BY_ERROR[code];
}
