// -----------------------------------------------------------------------------
// The errors of the two transports, sorted into a few kinds the rest of the
// code (and the user) can act on. A message never carries the password: the
// transports build it from a status, an error code or the RouterOS text.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  // Nothing answers at this address and port (refused, timeout, no route).
  UNREACHABLE: 'unreachable',
  // HTTPS or API-SSL answers, but its certificate does not verify.
  TLS: 'tls',
  // Something answers, but neither the RouterOS REST API nor the API protocol.
  NOT_ROUTEROS: 'not_routeros',
  // RouterOS refused the user name or the password.
  AUTH: 'auth',
  // The user is known, but its group lacks a policy (api, rest-api, write, reboot).
  PERMISSION: 'permission',
  // The menu does not exist on this router (no Wi-Fi package, no IPv6…).
  NOT_FOUND: 'not_found',
  // Any other refusal or unexpected answer.
  PROTOCOL: 'protocol',
});

export class RouterOsError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message safe to log: never a password
   */
  constructor(kind, message) {
    super(message);
    this.name = 'RouterOsError';
    this.kind = kind;
  }
}

// Node error codes of a peer that does not answer (or no longer does).
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
]);

// OpenSSL verification failures: the peer speaks TLS, its certificate is not trusted.
const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Turn a socket or TLS error into a RouterOsError.
 * @param {Error & { code?: string }} err
 * @param {string} where e.g. "REST over HTTPS"
 */
export function networkError(err, where) {
  if (err instanceof RouterOsError) {
    return err;
  }
  const code = err?.code ?? '';
  if (CERTIFICATE_CODES.has(code)) {
    return new RouterOsError(ERROR_KINDS.TLS, `${where}: certificate not trusted (${code})`);
  }
  if (UNREACHABLE_CODES.has(code)) {
    return new RouterOsError(ERROR_KINDS.UNREACHABLE, `${where}: no answer (${code})`);
  }
  // A TLS port that cannot complete a handshake (API-SSL without certificate,
  // a plain service behind a TLS port): nothing usable there.
  if (/^ERR_SSL_|^EPROTO$/.test(code) || /handshake|ssl|tls/i.test(err?.message ?? '')) {
    return new RouterOsError(ERROR_KINDS.NOT_ROUTEROS, `${where}: TLS handshake failed (${code})`);
  }
  return new RouterOsError(
    ERROR_KINDS.UNREACHABLE,
    `${where}: ${code || err?.message || 'connection failed'}`,
  );
}

/**
 * Sort a RouterOS refusal text (API `!trap` message, REST `detail`).
 * @param {string} text
 */
export function kindOfMessage(text) {
  const message = String(text ?? '').toLowerCase();
  if (/invalid user name or password|cannot log in|login failure/.test(message)) {
    return ERROR_KINDS.AUTH;
  }
  if (/not enough permissions|permission denied|policy/.test(message)) {
    return ERROR_KINDS.PERMISSION;
  }
  if (/no such command|no such item|unknown parameter|bad command name/.test(message)) {
    return ERROR_KINDS.NOT_FOUND;
  }
  return ERROR_KINDS.PROTOCOL;
}
