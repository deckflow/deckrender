import { APIError } from '@deckops/sdk';
import { DeckRenderError, isDeckRenderError } from './DeckRenderError.js';
import type { ErrorCode } from './codes.js';

/**
 * Translate a thrown value into a DeckRenderError.
 *
 * DeckRenderErrors pass through untouched — they already carry the code the
 * caller intended. Everything else is classified, with `APIError` (from
 * @deckops/sdk) mapped by HTTP status so that 401/402 surface as auth failures
 * rather than generic render failures.
 */
export function mapSdkError(error: unknown, fallback: ErrorCode = 'render_error'): DeckRenderError {
  if (isDeckRenderError(error)) {
    return error;
  }

  if (error instanceof APIError) {
    const status = error.statusCode;
    const requestId = error.requestId;

    if (status === 401) {
      return DeckRenderError.auth(`Authentication failed: ${error.message}`, {
        hint: 'Run `deckrender auth login`, or set DECKFLOW_API_KEY in the environment.',
        requestId,
        cause: error,
      });
    }

    if (status === 402) {
      return DeckRenderError.auth(`Payment required: ${error.message}`, {
        hint: 'Your workspace is out of balance. Complete checkout at https://app.deckflow.com and retry.',
        requestId,
        cause: error,
      });
    }

    return new DeckRenderError(fallback, error.message, { requestId, cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new DeckRenderError(fallback, message, { cause: error });
}
