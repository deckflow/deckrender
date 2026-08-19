import { APIError } from '@deckops/sdk';
import { DeckRenderError, isDeckRenderError } from './DeckRenderError.js';
import type { ErrorCode } from './codes.js';

export interface SdkErrorContext {
  /**
   * Where the credentials being sent came from, as
   * `describeCredentialOrigin` phrases it. Named in the 401 hint, because a
   * credential the user never configured for DeckRender is the hardest kind to
   * find. Omitted in guest mode, where there is nothing to name.
   */
  credentialOrigin?: string;
}

/**
 * Translate a thrown value into a DeckRenderError.
 *
 * DeckRenderErrors pass through untouched — they already carry the code the
 * caller intended. Everything else is classified, with `APIError` (from
 * @deckops/sdk) mapped by HTTP status so that 401/402 surface as auth failures
 * rather than generic render failures.
 */
export function mapSdkError(
  error: unknown,
  fallback: ErrorCode = 'render_error',
  context: SdkErrorContext = {}
): DeckRenderError {
  if (isDeckRenderError(error)) {
    return error;
  }

  if (error instanceof APIError) {
    const status = error.statusCode;
    const requestId = error.requestId;

    if (status === 401) {
      return DeckRenderError.auth(`Authentication failed: ${error.message}`, {
        hint: context.credentialOrigin
          ? `Credentials in use: ${context.credentialOrigin}. Run \`deckrender auth login\` to replace them, ` +
            'or remove them to render in guest mode.'
          : 'Run `deckrender auth login`, or set DECKFLOW_API_KEY in the environment.',
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
