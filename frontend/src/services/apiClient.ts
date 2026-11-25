import { apiError, product, productList, type Product } from '@facefit/contracts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5055';

/** Same limit the backend applies to its own requests. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Why a request failed. `not_found` covers a 404 and an id the API rejects;
 * the others are worth a retry.
 */
export type ApiFailure = 'network' | 'timeout' | 'not_found' | 'server_error' | 'invalid_response';

export class ApiError extends Error {
  readonly failure: ApiFailure;
  readonly status: number | null;

  constructor(failure: ApiFailure, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.failure = failure;
    this.status = status;
  }
}

/** The part of a contract schema the client uses. */
interface ResponseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

const failureForStatus = (status: number): ApiFailure =>
  status === 404 || status === 400 ? 'not_found' : 'server_error';

const isAbort = (error: unknown) =>
  error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Aborts on the caller's signal or after the timeout, whichever comes first. */
const withTimeout = (signal: AbortSignal | undefined): AbortSignal => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal;
};

const getJson = async <T>(
  path: string,
  schema: ResponseSchema<T>,
  signal: AbortSignal | undefined,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { signal: withTimeout(signal) });
  } catch (error) {
    // The caller's own abort propagates as is, so it is not reported as a failure.
    if (signal?.aborted) throw error;
    if (isAbort(error)) throw new ApiError('timeout', `${path} timed out`);
    throw new ApiError('network', `${path} could not be reached`);
  }
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const failure = apiError.safeParse(payload);
    const message = failure.success ? failure.data.error : `HTTP ${response.status}`;
    throw new ApiError(failureForStatus(response.status), message, response.status);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError('invalid_response', `${path} returned an unexpected body`, response.status);
  }
  return parsed.data;
};

export const getProducts = (signal?: AbortSignal): Promise<Product[]> =>
  getJson('/api/products', productList, signal);

export const getProductById = (id: number, signal?: AbortSignal): Promise<Product> =>
  getJson(`/api/products/${id}`, product, signal);

export const apiFailureOf = (error: unknown): ApiFailure =>
  error instanceof ApiError ? error.failure : 'network';

export { API_URL as API_BASE_URL };
