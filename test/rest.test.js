// -----------------------------------------------------------------------------
// The RouterOS 7 REST API (src/routeros/rest.js): basic authentication, a menu
// of one item answered as an object, the error bodies of RouterOS, the HTML of
// RouterOS 6 WebFig, the certificate check, and one real HTTP server on the
// loopback.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ERROR_KINDS } from '../src/routeros/errors.js';
import { RestTransport } from '../src/routeros/rest.js';
import { FakeRouterOs, createNetwork } from './helpers/fakeRouterOs.js';

const rest = (router, extra = {}) =>
  new RestTransport({
    host: '192.0.2.1',
    port: 80,
    https: false,
    username: 'gladys',
    password: 'secret',
    request: createNetwork({ '192.0.2.1': router }).request,
    ...extra,
  });

test('listings, single-item menus and commands', async () => {
  const router = new FakeRouterOs();
  const api = rest(router);
  const [resource] = await api.print('/system/resource');
  assert.equal(resource['cpu-load'], '15');
  const leases = await api.print('/ip/dhcp-server/lease', { proplist: ['mac-address', 'status'] });
  assert.deepEqual(Object.keys(leases[0]).sort(), ['mac-address', 'status']);
  await api.run('/ip/firewall/filter', 'set', { '.id': '*1A', disabled: 'no' });
  assert.equal(router.rule('/ip/firewall/filter', 'Block kids tablet')[0].disabled, 'false');
  assert.deepEqual(router.commands.at(-1), {
    protocol: 'rest_http',
    user: 'gladys',
    menu: '/ip/firewall/filter',
    command: 'set',
    params: { '.id': '*1A', disabled: 'no' },
  });
});

test('errors: password, permission, unknown menu, RouterOS 6, certificate', async () => {
  const router = new FakeRouterOs({ users: { gladys: { password: 'secret', group: 'read' } } });
  await assert.rejects(rest(router, { password: 'x' }).print('/system/identity'), {
    kind: ERROR_KINDS.AUTH,
  });
  await assert.rejects(rest(router).run('/system', 'reboot'), { kind: ERROR_KINDS.PERMISSION });
  await assert.rejects(rest(router).print('/caps-man/registration-table'), {
    kind: ERROR_KINDS.NOT_FOUND,
  });
  await assert.rejects(rest(new FakeRouterOs({ fixture: 'ros6-hap' })).open(), {
    kind: ERROR_KINDS.NOT_ROUTEROS,
  });
  const secure = new FakeRouterOs({ services: { rest_https: true } });
  await assert.rejects(rest(secure, { https: true, port: 443 }).open(), { kind: ERROR_KINDS.TLS });
  await rest(secure, { https: true, port: 443, insecure: true }).open();
  router.goOffline();
  await assert.rejects(rest(router).open(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('the password is sent in the basic authentication header only', async () => {
  const seen = [];
  const api = rest(new FakeRouterOs(), {
    password: 'p@ss:word',
    request: async (url, options) => {
      seen.push({ url, options });
      return { status: 200, headers: {}, body: '[]' };
    },
  });
  await api.print('/interface');
  assert.equal(
    seen[0].options.headers.authorization,
    `Basic ${Buffer.from('gladys:p@ss:word').toString('base64')}`,
  );
  assert.ok(!seen[0].url.includes('p@ss'));
});

test('a real HTTP server on the loopback', async (t) => {
  const router = new FakeRouterOs();
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const answer = await router.handleRest(`http://127.0.0.1${request.url}`, {
      method: request.method,
      headers: request.headers,
      json: body ? JSON.parse(body) : undefined,
    });
    response.writeHead(answer.status, answer.headers);
    response.end(answer.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = new RestTransport({
    host: '127.0.0.1',
    port: server.address().port,
    https: false,
    username: 'gladys',
    password: 'secret',
  });
  assert.equal((await api.print('/system/identity'))[0].name, 'MikroTik');
  await api.run('/ip/firewall/filter', 'set', { '.id': '*1B', disabled: 'yes' });
  assert.equal(router.rule('/ip/firewall/filter', 'Guests offline')[0].disabled, 'true');
});
