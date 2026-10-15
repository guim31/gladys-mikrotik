// -----------------------------------------------------------------------------
// Opening a session on the router: one transport chosen in the configuration,
// or `auto`, which tries the four in parallel and keeps the first that works
// in this order of preference:
//
//   1. REST over HTTPS (RouterOS 7, `www-ssl` service, port 443);
//   2. API-SSL (RouterOS 6 and 7, `api-ssl` service, port 8729);
//   3. REST over HTTP (RouterOS 7, `www` service, port 80);
//   4. API (RouterOS 6 and 7, `api` service, port 8728).
//
// The encrypted ones first: the plain ones send the password in clear on the
// LAN (basic authentication, or the API login since RouterOS 6.43). RouterOS 6
// has no REST API: its WebFig answers HTML, and the API is kept.
//
// A port typed with the address is tried with the chosen protocol, or with
// the four in `auto` mode (a service answers one protocol only).
// -----------------------------------------------------------------------------

import { DEFAULT_PORTS } from '../config.js';
import { ApiTransport } from './api.js';
import { ERROR_KINDS, RouterOsError } from './errors.js';
import { RestTransport } from './rest.js';

export const AUTO_ORDER = ['rest_https', 'api_ssl', 'rest_http', 'api'];

// What the user reads, in every language (protocol names are not translated).
export const PROTOCOL_LABELS = Object.freeze({
  rest_https: 'REST (HTTPS)',
  api_ssl: 'API-SSL',
  rest_http: 'REST (HTTP)',
  api: 'API',
});

// When every attempt fails, the most telling failure is reported.
const KIND_PRIORITY = [
  ERROR_KINDS.AUTH,
  ERROR_KINDS.PERMISSION,
  ERROR_KINDS.TLS,
  ERROR_KINDS.NOT_ROUTEROS,
  ERROR_KINDS.PROTOCOL,
  ERROR_KINDS.NOT_FOUND,
  ERROR_KINDS.UNREACHABLE,
];

/**
 * @param {string} protocol one of AUTO_ORDER
 * @param {object} options
 * @param {string} options.host
 * @param {number|null} [options.port] null: the default port of the protocol
 * @param {string} options.username
 * @param {string} options.password
 * @param {boolean} [options.insecure]
 * @param {Function} [options.request] HTTP seam
 * @param {Function} [options.connect] socket seam
 * @param {Record<string, number>} [options.ports] default ports (tests)
 * @param {number} [options.timeoutMs]
 */
export function createTransport(protocol, options) {
  const { host, username, password, insecure, request, connect, timeoutMs } = options;
  const port = options.port ?? options.ports?.[protocol] ?? DEFAULT_PORTS[protocol];
  if (protocol === 'rest_https' || protocol === 'rest_http') {
    return new RestTransport({
      host,
      port,
      https: protocol === 'rest_https',
      insecure,
      username,
      password,
      request,
      timeoutMs,
    });
  }
  return new ApiTransport({
    host,
    port,
    secure: protocol === 'api_ssl',
    insecure,
    username,
    password,
    connect,
    timeoutMs,
  });
}

/** The failure to report out of several attempts. */
export function mainFailure(attempts) {
  const failed = attempts.filter((attempt) => attempt.error);
  for (const kind of KIND_PRIORITY) {
    const found = failed.find((attempt) => attempt.error.kind === kind);
    if (found) {
      return found.error;
    }
  }
  return new RouterOsError(ERROR_KINDS.UNREACHABLE, 'No protocol answered');
}

/**
 * Open a session.
 * @param {object} options createTransport options, plus `protocol` ('auto' or one of AUTO_ORDER)
 * @returns {Promise<{ transport: object, attempts: Array<{ protocol: string, error?: RouterOsError }> }>}
 * @throws {RouterOsError} the main failure, with `attempts`
 */
export async function openSession({ protocol = 'auto', ...options }) {
  const protocols = protocol === 'auto' ? AUTO_ORDER : [protocol];
  const candidates = protocols.map((name) => ({
    protocol: name,
    transport: createTransport(name, options),
  }));
  const results = await Promise.allSettled(candidates.map(({ transport }) => transport.open()));
  const attempts = candidates.map(({ protocol: name }, index) =>
    results[index].status === 'fulfilled'
      ? { protocol: name }
      : { protocol: name, error: results[index].reason },
  );
  const chosen = candidates.find((_, index) => results[index].status === 'fulfilled');
  // Close every other session that opened.
  await Promise.all(
    candidates
      .filter((candidate) => candidate !== chosen)
      .map((candidate) => candidate.transport.close().catch(() => {})),
  );
  if (!chosen) {
    const error = mainFailure(attempts);
    error.attempts = attempts;
    throw error;
  }
  return { transport: chosen.transport, attempts };
}
