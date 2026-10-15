// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password nor a secret of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, baseConfig, createAll, createWorld, later } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return { lines, clear: () => lines.splice(0), texts: () => lines.map((line) => line.text) };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet' }) });
  assert.ok(
    logs.texts().some((text) => text.includes('connected with REST')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.router.traffic('ether1', 1_000_000 * i, 100_000);
    w.router.data['/system/resource'][0]['cpu-load'] = String(10 + i);
    await later(w, 30); // the update state is read again too
  }
  assert.deepEqual(logs.texts(), []);
});

test('a router that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.router.goOffline();
  for (let i = 0; i < 6; i += 1) {
    await later(w, 1);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.router.goOnline();
  await later(w, 1);
  await later(w, 1);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /connection restored/);
});

test('a refused password is logged once and never written', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: baseConfig({ password: 'wrong-password-123' }) });
  for (let i = 0; i < 5; i += 1) {
    await later(w, 6);
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.ok(!logs.texts().join('\n').includes('wrong-password-123'));
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.router.data['/system/resource'][0]['cpu-load'] = String(20 + i);
    await later(w, 1);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('one line per user command', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: baseConfig({ firewall_rules: 'Block kids tablet', allow_commands: true }),
  });
  logs.clear();
  const rule = w.gladys.externalIds('rule', 'block-kids-tablet').device;
  await w.fake.sceneAction('enable_firewall_rule', { rule });
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Firewall rule "Block kids tablet" enabled \(2 rule\(s\)\)/);
});

test('LOG_LEVEL=debug shows each problem; no secret of the configuration, ever', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { config: baseConfig({ allow_commands: true, protocol: 'api' }) });
  await createAll(w);
  w.router.goOffline();
  await later(w, 1);
  await later(w, 1);
  w.router.goOnline();
  await later(w, 1);
  await w.fake.action('test_connection', {});
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes(PASSWORD), 'never the password');
  assert.ok(
    !text.includes(Buffer.from(`gladys:${PASSWORD}`).toString('base64')),
    'nor the basic auth',
  );
});
