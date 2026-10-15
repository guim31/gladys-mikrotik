// -----------------------------------------------------------------------------
// The one function the REST transport uses to reach the network: an HTTP(S)
// request on node:http / node:https. Not on fetch: fetch cannot accept the
// self-signed certificate of one router only (RouterOS serves HTTPS with a
// self-signed certificate unless the user installs another one), node:https
// can, per request. (Adapted from guim31/gladys-pihole.)
//
// The REST transport takes this function as a parameter: the tests replace it
// with an in-memory RouterOS (test/helpers/fakeRouterOs.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// A DHCP lease table of a few hundred clients stays well below this.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {unknown} [options.json] body, sent as JSON
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(
  url,
  { method = 'GET', headers = {}, json, insecure = false, timeoutMs = 10_000 } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const payload = json === undefined ? undefined : Buffer.from(JSON.stringify(json));
  const requestHeaders = {
    accept: 'application/json',
    ...headers,
    ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
  };

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers: requestHeaders,
        timeout: timeoutMs,
        // Never reuse a socket across routers or credentials.
        agent: false,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload);
  });
}
