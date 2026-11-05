/**
 * Bounded HTTP transport. Every request the runner makes goes through here.
 *
 * Guarantees:
 * - Only GET, only to the single allowed origin (scheme/host/port compared exactly).
 * - Redirects are never followed (`redirect: 'manual'`); any 3xx is a failure.
 * - Per-request timeout, a run-wide deadline/cancellation signal, a request
 *   budget, and a response byte cap enforced while streaming.
 * - Concurrency 1 (callers await each request) and zero retries.
 * - Failures are reported as safe enum codes; raw errors are discarded.
 */
import { parseExactOrigin, type RunLimits } from '@ship-safe/contracts';

export type TransportFailureCode =
  | 'timeout'
  | 'network_error'
  | 'redirect_rejected'
  | 'response_too_large'
  | 'response_malformed'
  | 'cancelled'
  | 'run_deadline_exceeded'
  | 'request_budget_exhausted'
  | 'origin_mismatch';

export interface HttpRequest {
  url: URL;
  headers: Record<string, string>;
}

export type HttpOutcome =
  | { kind: 'response'; status: number; contentType: string | null; body: string }
  | { kind: 'failure'; code: TransportFailureCode; status: number | null };

export interface Transport {
  send(req: HttpRequest): Promise<HttpOutcome>;
  readonly requestsMade: number;
}

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

/** Abort reasons used on the run-wide signal. */
export const ABORT_CANCELLED = 'ship-safe:cancelled';
export const ABORT_DEADLINE = 'ship-safe:run-deadline';

export interface BoundedTransportOptions {
  allowedOrigin: string;
  limits: RunLimits;
  runSignal: AbortSignal;
  fetchImpl?: FetchLike;
  userAgent: string;
}

function runAbortCode(signal: AbortSignal): TransportFailureCode {
  return signal.reason === ABORT_DEADLINE ? 'run_deadline_exceeded' : 'cancelled';
}

export class BoundedFetchTransport implements Transport {
  private count = 0;
  private readonly origin: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: BoundedTransportOptions) {
    const parsed = parseExactOrigin(opts.allowedOrigin);
    if (!parsed.ok) throw new Error('allowedOrigin is not an exact origin');
    this.origin = parsed.value.origin;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get requestsMade(): number {
    return this.count;
  }

  private originOf(url: URL): string | null {
    if (url.username !== '' || url.password !== '') return null;
    const p = parseExactOrigin(url.origin);
    return p.ok ? p.value.origin : null;
  }

  async send(req: HttpRequest): Promise<HttpOutcome> {
    const { limits, runSignal } = this.opts;
    if (runSignal.aborted) return { kind: 'failure', code: runAbortCode(runSignal), status: null };
    if (this.originOf(req.url) !== this.origin) return { kind: 'failure', code: 'origin_mismatch', status: null };
    if (this.count >= limits.maxRequests) return { kind: 'failure', code: 'request_budget_exhausted', status: null };
    this.count++;

    const perRequest = new AbortController();
    const timer = setTimeout(() => perRequest.abort('ship-safe:request-timeout'), limits.requestTimeoutMs);
    const signal = AbortSignal.any([runSignal, perRequest.signal]);
    const failureFromAbort = (): HttpOutcome => ({
      kind: 'failure',
      code: runSignal.aborted ? runAbortCode(runSignal) : 'timeout',
      status: null,
    });

    try {
      let res: Response;
      try {
        res = await this.fetchImpl(req.url, {
          method: 'GET',
          headers: { ...req.headers, 'User-Agent': this.opts.userAgent },
          redirect: 'manual',
          signal,
          keepalive: false,
        });
      } catch {
        return signal.aborted ? failureFromAbort() : { kind: 'failure', code: 'network_error', status: null };
      }

      if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
        await res.body?.cancel().catch(() => undefined);
        return { kind: 'failure', code: 'redirect_rejected', status: res.status || null };
      }

      const declared = res.headers.get('content-length');
      if (declared !== null && Number(declared) > limits.maxResponseBytes) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: 'failure', code: 'response_too_large', status: res.status };
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limits.maxResponseBytes) {
              await reader.cancel().catch(() => undefined);
              return { kind: 'failure', code: 'response_too_large', status: res.status };
            }
            chunks.push(value);
          }
        } catch {
          return signal.aborted ? failureFromAbort() : { kind: 'failure', code: 'network_error', status: res.status };
        }
      }
      let body: string;
      try {
        body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        return { kind: 'failure', code: 'response_malformed', status: res.status };
      }
      return { kind: 'response', status: res.status, contentType: res.headers.get('content-type'), body };
    } finally {
      clearTimeout(timer);
    }
  }
}
