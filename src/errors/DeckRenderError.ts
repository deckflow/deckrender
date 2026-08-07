import { exitCodeFor, type ErrorCode, type ExitCodeValue } from './codes.js';

export interface DeckRenderErrorOptions {
  /** Actionable next step. Rendered on its own line after the message. */
  hint?: string;
  /** Backend request id, when the failure came from the DeckOps API. */
  requestId?: string;
  cause?: unknown;
}

export class DeckRenderError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly requestId?: string;

  constructor(code: ErrorCode, message: string, options: DeckRenderErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'DeckRenderError';
    this.code = code;
    this.hint = options.hint;
    this.requestId = options.requestId;
  }

  get exitCode(): ExitCodeValue {
    return exitCodeFor(this.code);
  }

  toJSON(): { code: ErrorCode; message: string; hint?: string; requestId?: string } {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
    };
  }

  static usage(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('usage_error', message, options);
  }

  static auth(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('auth_error', message, options);
  }

  static unsupportedFormat(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('unsupported_format', message, options);
  }

  static unsupportedOption(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('unsupported_option', message, options);
  }

  /** Planned capability that has not shipped. Distinct from "impossible". */
  static notImplemented(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('not_implemented', message, options);
  }

  static render(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('render_error', message, options);
  }

  static conversion(message: string, options?: DeckRenderErrorOptions): DeckRenderError {
    return new DeckRenderError('conversion_error', message, options);
  }
}

export function isDeckRenderError(value: unknown): value is DeckRenderError {
  return value instanceof DeckRenderError;
}
