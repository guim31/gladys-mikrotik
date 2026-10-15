// -----------------------------------------------------------------------------
// Choosing the protocol (src/routeros/client.js): `auto` keeps the first that
// works in the order REST over HTTPS, API-SSL, REST over HTTP, API, and reports
// the most telling failure when none does.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/routeros/errors.js';
import { openSession } from '../src/routeros/client.js';
import { FakeRouterOs, createNetwork } from './helpers/fakeRouterOs.js';

const open = (router, extra = {}) => {
  const network = createNetwork({ '192.0.2.1': router });
  return openSession({
    host: '192.0.2.1',
    username: 'gladys',
    password: 'secret',
    request: network.request,
    connect: network.connect,
    ...extra,
  });
};

const all = { rest_https: true, api_ssl: true, rest_http: true, api: true };

test('RouterOS 7 with the default services: REST over HTTP', async () => {
  const { transport, attempts } = await open(new FakeRouterOs());
  assert.equal(transport.protocol, 'rest_http');
  assert.equal(
    attempts.find((a) => a.protocol === 'rest_https').error.kind,
    ERROR_KINDS.UNREACHABLE,
  );
});

test('the encrypted protocols come first, with an accepted certificate', async () => {
  const router = new FakeRouterOs({ services: all });
  assert.equal((await open(router, { insecure: true })).transport.protocol, 'rest_https');
  // Certificate refused: the plain REST is kept, and the refusal is reported.
  const { transport, attempts } = await open(router);
  assert.equal(transport.protocol, 'rest_http');
  assert.equal(attempts[0].error.kind, ERROR_KINDS.TLS);
  router.services = { ...all, rest_https: false };
  assert.equal((await open(router, { insecure: true })).transport.protocol, 'api_ssl');
});

test('RouterOS 6: the API, its WebFig is not a REST API', async () => {
  const { transport, attempts } = await open(new FakeRouterOs({ fixture: 'ros6-hap' }));
  assert.equal(transport.protocol, 'api');
  assert.equal(
    attempts.find((a) => a.protocol === 'rest_http').error.kind,
    ERROR_KINDS.NOT_ROUTEROS,
  );
  await transport.close();
});

test('a protocol chosen in the configuration is the only one tried', async () => {
  const { transport, attempts } = await open(new FakeRouterOs(), { protocol: 'api' });
  assert.equal(transport.protocol, 'api');
  assert.equal(attempts.length, 1);
  await transport.close();
  await assert.rejects(open(new FakeRouterOs(), { protocol: 'rest_https' }), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
});

test('every attempt failing: the most telling failure', async () => {
  await assert.rejects(open(new FakeRouterOs(), { password: 'wrong' }), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.equal(err.attempts.length, 4);
    return true;
  });
  const secure = new FakeRouterOs({ services: { rest_https: true } });
  await assert.rejects(open(secure), { kind: ERROR_KINDS.TLS });
  await assert.rejects(open(new FakeRouterOs(), { host: '192.0.2.200' }), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
});

test('only the chosen session stays open', async () => {
  const router = new FakeRouterOs({ services: all });
  const { transport } = await open(router, { insecure: true });
  assert.equal(transport.protocol, 'rest_https');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(router.sockets.size, 0, 'the API sessions were closed');
});
