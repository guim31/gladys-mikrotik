// -----------------------------------------------------------------------------
// The RouterOS 7 REST API (help.mikrotik.com, "REST API"): JSON over HTTP(S)
// at `/rest/<menu>`, HTTP basic authentication on every request, served by
// the `www` (HTTP) or `www-ssl` (HTTPS) service of the router.
//
//   - a listing is a GET: `GET /rest/ip/dhcp-server/lease?.proplist=…`;
//   - any other console command is a POST of its arguments:
//     `POST /rest/ip/firewall/filter/set {".id":"*1A","disabled":"yes"}`.
//
// Every value comes back as a string ("true", "15", "1w2d3h"): src/routeros/
// model.js reads them, like the strings of the API protocol.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, RouterOsError, kindOfMessage, networkError } from './errors.js';
import { httpRequest } from './http.js';

const menuPath = (menu) => menu.replace(/^\/+|\/+$/g, '');

export class RestTransport {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {boolean} options.https
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} [options.request] HTTP seam (src/routeros/http.js)
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, port, https, insecure = false, username, password, request, timeoutMs }) {
    const hostPart = host.includes(':') ? `[${host}]` : host;
    this.base = `${https ? 'https' : 'http'}://${hostPart}:${port}/rest`;
    this.label = https ? 'REST over HTTPS' : 'REST over HTTP';
    this.protocol = https ? 'rest_https' : 'rest_http';
    this.insecure = insecure;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
    this.request = request ?? httpRequest;
    this.timeoutMs = timeoutMs ?? 10_000;
  }

  async call(method, url, json, timeoutMs = this.timeoutMs) {
    let response;
    try {
      response = await this.request(url, {
        method,
        headers: { authorization: this.authorization },
        json,
        insecure: this.insecure,
        timeoutMs,
      });
    } catch (err) {
      throw networkError(err, this.label);
    }
    const { status, body } = response;
    let parsed;
    try {
      parsed = body === '' ? null : JSON.parse(body);
    } catch {
      // HTML: the WebFig page of RouterOS 6, a reverse proxy, another device.
      throw new RouterOsError(
        ERROR_KINDS.NOT_ROUTEROS,
        `${this.label}: HTTP ${status} without a JSON body (no REST API here)`,
      );
    }
    if (status === 401) {
      throw new RouterOsError(ERROR_KINDS.AUTH, `${this.label}: user name or password refused`);
    }
    if (status === 403) {
      throw new RouterOsError(ERROR_KINDS.PERMISSION, `${this.label}: HTTP 403`);
    }
    if (status >= 200 && status < 300) {
      return parsed;
    }
    // RouterOS errors: { "error": 400, "message": "Bad Request", "detail": "…" }
    const detail =
      parsed && typeof parsed === 'object'
        ? String(parsed.detail ?? parsed.message ?? '').slice(0, 200)
        : '';
    const kind =
      status === 404 && !detail.includes('permission')
        ? ERROR_KINDS.NOT_FOUND
        : kindOfMessage(detail);
    throw new RouterOsError(kind, `${this.label}: HTTP ${status}${detail ? ` (${detail})` : ''}`);
  }

  /**
   * List a menu (`/interface`, `/ip/arp`…).
   * @param {string} menu
   * @param {{ proplist?: string[] }} [options]
   * @returns {Promise<object[]>}
   */
  async print(menu, { proplist } = {}) {
    const query = proplist?.length ? `?.proplist=${encodeURIComponent(proplist.join(','))}` : '';
    const result = await this.call('GET', `${this.base}/${menuPath(menu)}${query}`);
    // A menu of one item (`/system/resource`) answers an object.
    if (Array.isArray(result)) {
      return result;
    }
    return result && typeof result === 'object' ? [result] : [];
  }

  /**
   * Run a command of a menu (`/system/reboot`, `/ip/firewall/filter/set`).
   * @param {string} menu
   * @param {string} command
   * @param {Record<string, string>} [params]
   * @param {{ timeoutMs?: number }} [options]
   */
  async run(menu, command, params = {}, { timeoutMs } = {}) {
    return this.call(
      'POST',
      `${this.base}/${menuPath(menu)}/${command}`,
      params,
      timeoutMs ?? this.timeoutMs,
    );
  }

  /** Check the credentials with the smallest read there is. */
  async open() {
    await this.print('/system/identity');
  }

  async close() {
    // Stateless: every request carries its credentials.
  }
}
