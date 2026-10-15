// -----------------------------------------------------------------------------
// An in-memory RouterOS behind the two network seams of the integration: the
// `request` function of the REST transport and the `connect` function of the
// API transport. One router answers both, from the fixtures of
// test/fixtures/routeros/, with the behaviors that matter:
//
//   - the services (www, www-ssl, api, api-ssl) on or off, a self-signed
//     certificate on the encrypted ones;
//   - users and groups (read, write, full): a read-only user cannot set a
//     rule, reboot or check for updates;
//   - RouterOS 6: no REST API (WebFig answers HTML), health as one item, the
//     legacy `wireless` package, and optionally the pre-6.43 challenge login;
//   - RouterOS 7.18+: `!empty` before `!done` for an empty listing;
//   - a router that stops answering, interface counters that grow, links
//     that drop, clients that come and go.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  attributes,
  challengeResponse,
  encodeSentence,
  SentenceReader,
} from '../../src/routeros/api.js';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/routeros/${name}.json`, import.meta.url), 'utf8'));

// Menus whose REST listing is one object, not an array.
const SINGLE_ITEM_MENUS = new Set([
  '/system/identity',
  '/system/resource',
  '/system/routerboard',
  '/system/license',
  '/system/package/update',
]);

const POLICIES = {
  read: ['read', 'api', 'rest-api', 'test'],
  write: ['read', 'write', 'api', 'rest-api', 'test', 'reboot'],
  full: ['read', 'write', 'api', 'rest-api', 'test', 'reboot', 'policy'],
};

class Trap extends Error {}

export class FakeRouterOs {
  /**
   * @param {object} [options]
   * @param {string} [options.fixture] file name in test/fixtures/routeros/
   * @param {Record<string, boolean>} [options.services] rest_https, rest_http, api_ssl, api
   * @param {boolean} [options.selfSigned] the certificate of the encrypted services
   * @param {Record<string, { password: string, group: string }>} [options.users]
   * @param {boolean} [options.legacyLogin] RouterOS before 6.43
   */
  constructor({
    fixture: name = 'ros7-rb5009',
    services,
    selfSigned = true,
    users = { gladys: { password: 'secret', group: 'full' } },
    legacyLogin = false,
  } = {}) {
    this.flavor = name.startsWith('ros6') ? 'ros6' : 'ros7';
    this.data = fixture(name);
    this.services = services ?? {
      rest_https: false,
      api_ssl: false,
      rest_http: true,
      api: true,
    };
    this.selfSigned = selfSigned;
    this.users = users;
    this.legacyLogin = legacyLogin;
    this.online = true;
    this.sockets = new Set();
    this.commands = []; // { protocol, user, menu, command, params }
    this.logins = { ok: 0, failed: 0 };
    this.reboots = 0;
    this.updateChecks = 0;
  }

  // --- Changes of the router, for the tests --------------------------------------

  goOffline() {
    this.online = false;
    for (const socket of this.sockets) {
      socket.hangUp();
    }
  }

  goOnline() {
    this.online = true;
  }

  interface(name) {
    return this.data['/interface'].find((item) => item.name === name);
  }

  /** Bytes received / sent on an interface since the last reading. */
  traffic(name, rxBytes, txBytes) {
    const item = this.interface(name);
    item['rx-byte'] = String(Number(item['rx-byte']) + rxBytes);
    item['tx-byte'] = String(Number(item['tx-byte']) + txBytes);
  }

  setRunning(name, running) {
    this.interface(name).running = String(running);
  }

  registrationMenu() {
    return this.flavor === 'ros6'
      ? '/interface/wireless/registration-table'
      : '/interface/wifi/registration-table';
  }

  /** A client joins the Wi-Fi. */
  associate(mac, extra = {}) {
    const menu = this.registrationMenu();
    this.data[menu] = (this.data[menu] ?? []).filter((item) => item['mac-address'] !== mac);
    this.data[menu].push({
      '.id': `*${mac.slice(-2)}`,
      'mac-address': mac,
      interface: 'wifi1',
      ...extra,
    });
  }

  /** A client leaves the Wi-Fi (and its ARP entry goes stale). */
  dissociate(mac) {
    const menu = this.registrationMenu();
    this.data[menu] = (this.data[menu] ?? []).filter((item) => item['mac-address'] !== mac);
    for (const entry of this.data['/ip/arp']) {
      if (entry['mac-address'] === mac) {
        if (this.flavor === 'ros6') {
          entry.complete = 'false';
        } else {
          entry.status = 'stale';
        }
      }
    }
  }

  addLease(mac, { ip = '192.0.2.99', hostName = null, bound = true } = {}) {
    this.data['/ip/dhcp-server/lease'].push({
      '.id': `*${mac.slice(-2)}9`,
      address: ip,
      'mac-address': mac,
      ...(bound ? { 'active-address': ip, 'active-mac-address': mac } : {}),
      ...(hostName ? { 'host-name': hostName } : {}),
      server: 'defconf',
      status: bound ? 'bound' : 'waiting',
      dynamic: 'true',
    });
  }

  rule(menu, comment) {
    return (this.data[menu] ?? []).filter((item) => item.comment === comment);
  }

  // --- The router itself ------------------------------------------------------------

  authenticate(username, password) {
    const user = this.users[username];
    if (!user || user.password !== password) {
      this.logins.failed += 1;
      return null;
    }
    this.logins.ok += 1;
    return { name: username, policies: POLICIES[user.group] ?? [] };
  }

  require(user, policy) {
    if (!user.policies.includes(policy)) {
      throw new Trap('not enough permissions (9)');
    }
  }

  /** Run a console command; the items of the answer, or a Trap. */
  execute(protocol, user, menu, command, params = {}) {
    this.commands.push({ protocol, user: user.name, menu, command, params });
    if (command === 'print') {
      this.require(user, 'read');
      const items = this.data[menu];
      if (items === undefined) {
        throw new Trap(
          protocol.startsWith('rest')
            ? `no such command or directory (${menu.split('/').pop()})`
            : 'no such command prefix',
        );
      }
      const proplist = params['.proplist'] ? params['.proplist'].split(',') : null;
      return structuredClone(items).map((item) =>
        proplist
          ? Object.fromEntries(Object.entries(item).filter(([key]) => proplist.includes(key)))
          : item,
      );
    }
    if (command === 'set' && (menu === '/ip/firewall/filter' || menu === '/ipv6/firewall/filter')) {
      this.require(user, 'write');
      const item = (this.data[menu] ?? []).find((candidate) => candidate['.id'] === params['.id']);
      if (!item) {
        throw new Trap('no such item');
      }
      if ('disabled' in params) {
        item.disabled = ['yes', 'true'].includes(params.disabled) ? 'true' : 'false';
      }
      return [];
    }
    if (menu === '/system' && command === 'reboot') {
      this.require(user, 'reboot');
      this.reboots += 1;
      return [];
    }
    if (menu === '/system/package/update' && command === 'check-for-updates') {
      this.require(user, 'write');
      this.updateChecks += 1;
      return [{ status: 'finding out latest version...' }, { status: 'New version is available' }];
    }
    throw new Trap('no such command');
  }

  // --- REST front (www / www-ssl) ----------------------------------------------------------

  /** The `request` seam of the REST transport, for this router. */
  async handleRest(url, { method = 'GET', headers = {}, json: body, insecure } = {}) {
    const target = new URL(url);
    const protocol = target.protocol === 'https:' ? 'rest_https' : 'rest_http';
    if (!this.online || !this.services[protocol]) {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (protocol === 'rest_https' && this.selfSigned && !insecure) {
      throw Object.assign(new Error('self-signed certificate'), {
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      });
    }
    const json = (status, payload) => ({
      status,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? '' : JSON.stringify(payload),
    });
    if (this.flavor === 'ros6' || !target.pathname.startsWith('/rest/')) {
      // RouterOS 6: WebFig, no REST API.
      return { status: 404, headers: { 'content-type': 'text/html' }, body: '<html>WebFig</html>' };
    }
    const match = /^Basic (.+)$/.exec(headers.authorization ?? '');
    const [username, ...rest] = match
      ? Buffer.from(match[1], 'base64').toString('utf8').split(':')
      : [];
    const user = match ? this.authenticate(username, rest.join(':')) : null;
    if (!user) {
      return json(401, { error: 401, message: 'Unauthorized' });
    }
    const path = target.pathname.slice('/rest'.length);
    try {
      if (method === 'GET') {
        const params = Object.fromEntries(target.searchParams.entries());
        const items = this.execute(protocol, user, path, 'print', params);
        return json(200, SINGLE_ITEM_MENUS.has(path) ? (items[0] ?? {}) : items);
      }
      if (method === 'POST') {
        const at = path.lastIndexOf('/');
        const items = this.execute(
          protocol,
          user,
          path.slice(0, at),
          path.slice(at + 1),
          body ?? {},
        );
        return json(200, items);
      }
      return json(400, { error: 400, message: 'Bad Request', detail: 'unsupported method' });
    } catch (err) {
      if (err instanceof Trap) {
        return json(400, { error: 400, message: 'Bad Request', detail: err.message });
      }
      throw err;
    }
  }

  // --- API front (api / api-ssl) ------------------------------------------------------------

  /** A socket of the `connect` seam of the API transport. */
  openSocket({ secure, insecure }) {
    return new FakeApiSocket(this, { secure, insecure });
  }
}

class FakeApiSocket extends EventEmitter {
  constructor(router, { secure, insecure }) {
    super();
    this.router = router;
    this.protocol = secure ? 'api_ssl' : 'api';
    this.reader = new SentenceReader();
    this.user = null;
    this.challenge = null;
    this.closed = false;
    setImmediate(() => {
      if (!router.online || !router.services[this.protocol]) {
        this.emit(
          'error',
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        );
        return;
      }
      if (secure && router.selfSigned && !insecure) {
        this.emit(
          'error',
          Object.assign(new Error('self-signed certificate'), {
            code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
          }),
        );
        return;
      }
      router.sockets.add(this);
      this.emit(secure ? 'secureConnect' : 'connect');
    });
  }

  reply(...sentences) {
    setImmediate(() => {
      if (!this.closed) {
        this.emit('data', Buffer.concat(sentences.map((words) => encodeSentence(words))));
      }
    });
  }

  write(buffer) {
    if (this.closed) {
      return;
    }
    for (const sentence of this.reader.push(buffer)) {
      this.handle(sentence);
    }
  }

  handle([command, ...words]) {
    const params = attributes(words);
    if (command === '/login') {
      this.login(params);
      return;
    }
    if (!this.user) {
      this.reply(['!trap', '=message=not logged in'], ['!done']);
      return;
    }
    const at = command.lastIndexOf('/');
    try {
      const items = this.router.execute(
        this.protocol,
        this.user,
        command.slice(0, at),
        command.slice(at + 1),
        params,
      );
      const replies = items.map((item) => [
        '!re',
        ...Object.entries(item).map(([key, value]) => `=${key}=${value}`),
      ]);
      if (replies.length === 0 && this.router.flavor === 'ros7') {
        replies.push(['!empty']);
      }
      this.reply(...replies, ['!done']);
    } catch (err) {
      if (err instanceof Trap) {
        this.reply(['!trap', `=message=${err.message}`], ['!done']);
        return;
      }
      throw err;
    }
  }

  login(params) {
    const router = this.router;
    if (router.legacyLogin) {
      if (!params.response) {
        this.challenge = 'ebddd18303a54111e2dea05a92ab46b4';
        this.reply(['!done', `=ret=${this.challenge}`]);
        return;
      }
      const account = router.users[params.name];
      const expected = account && challengeResponse(account.password, this.challenge);
      this.user =
        expected === params.response ? router.authenticate(params.name, account.password) : null;
      if (!this.user) {
        router.logins.failed += 1;
      }
    } else {
      this.user = router.authenticate(params.name, params.password);
    }
    if (this.user) {
      this.reply(['!done']);
    } else {
      this.reply(['!trap', '=message=invalid user name or password (6)'], ['!done']);
    }
  }

  /** The router stopped answering. */
  hangUp() {
    if (!this.closed) {
      this.closed = true;
      this.router.sockets.delete(this);
      this.emit('close');
    }
  }

  end() {
    this.hangUp();
  }

  destroy() {
    this.hangUp();
  }
}

/**
 * A network of fake routers, by host: the `request`, `connect` and `ports`
 * seams of the hub. An address without a router does not answer.
 */
export function createNetwork(routers = {}) {
  const byHost = new Map(Object.entries(routers));
  const unreachable = () =>
    Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
  return {
    routers: byHost,
    async request(url, options) {
      const router = byHost.get(new URL(url).hostname);
      if (!router) {
        throw unreachable();
      }
      return router.handleRest(url, options);
    },
    connect({ host, secure, insecure }) {
      const router = byHost.get(host);
      if (!router) {
        const socket = new EventEmitter();
        socket.destroy = () => {};
        socket.end = () => {};
        socket.write = () => {};
        setImmediate(() => socket.emit('error', unreachable()));
        return socket;
      }
      return router.openSocket({ secure, insecure });
    },
  };
}
