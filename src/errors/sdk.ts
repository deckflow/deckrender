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
 * Whether the backend rejected the credentials that were sent.
 *
 * Two shapes mean the same thing. A 401 is the credential itself being refused.
 * A 403 naming the caller's own data is a `spaceId` that outlived the login it
 * belonged to — the workspace is real, it just is not this caller's any more.
 *
 * Reads the HTTP status rather than the mapped `ErrorCode`, in both directions:
 * a stale-space 403 arrives as `conversion_error` when it surfaces from an
 * upload, and a 402 arrives as `auth_error` even though a workspace out of
 * balance is a real answer about the account, not a bad credential. See the
 * guest fallback in core/renderer.ts.
 */
export function credentialsRejected(error: unknown): boolean {
  if (!isDeckRenderError(error) || !(error.cause instanceof APIError)) {
    return false;
  }
  const cause = error.cause;
  if (cause.statusCode === 401) {
    return true;
  }
  return cause.statusCode === 403 && /only operate your own data/i.test(describe(cause));
}

/** Message plus response body, so a 403's reason can be matched in either. */
function describe(error: APIError): string {
  const data = error.responseData;
  const body = typeof data === 'string' ? data : data !== undefined ? JSON.stringify(data) : '';
  return `${error.message}\n${body}`;
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
