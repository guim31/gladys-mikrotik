// -----------------------------------------------------------------------------
// The probe script (scripts/probe.mjs) against the fake RouterOS: it reads
// only, and its report carries no address, MAC, serial, name nor password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe.mjs';
import { FakeRouterOs, createNetwork } from './helpers/fakeRouterOs.js';

const run = (router, extra) => {
  const network = createNetwork({ '192.0.2.1': router });
  return probe({ host: '192.0.2.1', request: network.request, connect: network.connect, ...extra });
};

test('without credentials: every protocol refuses an invented account', async () => {
  const router = new FakeRouterOs();
  const lines = await run(router, {});
  assert.match(lines.join('\n'), /REST \(HTTP\): auth/);
  assert.match(lines.join('\n'), /API: auth/);
  assert.match(lines.join('\n'), /REST \(HTTPS\): unreachable/);
  assert.equal(router.logins.ok, 0);
});

test('with credentials: prints only, and nothing private in the report', async () => {
  const router = new FakeRouterOs();
  const lines = await run(router, { username: 'gladys', password: 'secret' });
  const text = lines.join('\n');
  assert.match(text, /Protocol: REST \(HTTP\)/);
  assert.match(text, /RouterOS 7\.18\.2 \(stable\)/);
  assert.ok(router.commands.every((command) => command.command === 'print'));
  for (const secret of [
    'secret',
    '192.0.2',
    '00:00:5E',
    'HG10ABC1DEF',
    'Device_1',
    'Mobile',
    'Block kids',
  ]) {
    assert.ok(!text.includes(secret), `"${secret}" in the report`);
  }
});
