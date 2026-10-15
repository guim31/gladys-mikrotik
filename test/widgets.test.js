// -----------------------------------------------------------------------------
// The dashboard widgets (src/widgets.js): every content passes the SDK
// validator (vocabulary and budget of the core) in every language and state,
// the buttons exist only when the commands are allowed, and their actions do
// what they say.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { shortDuration } from '../src/widgets.js';
import { baseConfig, createAll, createWorld, later } from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, key, { settings = {}, language = 'en' } = {}) {
  const ack = await w.fake.widgetGet(key, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const result = ack.data.content;
  assert.deepEqual(validateWidgetContent(result), [], `${key} (${language}) is valid`);
  return result;
}

const types = (result) => result.components.map((component) => component.type);

test('router: health tiles, WAN, uptime, update; no button by default', async (t) => {
  const w = await world(t);
  w.router.traffic('ether1', 75_000_000, 7_500_000);
  await later(w, 1);
  for (const language of LANGS) {
    const result = await content(w, 'router', { language });
    assert.deepEqual(types(result), ['value', 'value', 'value', 'value', 'value', 'status']);
    assert.equal(result.ttl_seconds, 30);
  }
  const result = await content(w, 'router');
  assert.deepEqual(
    result.components.slice(0, 5).map((c) => c.value),
    [15, 25, 47, '10.0', '1.0'],
  );
  assert.deepEqual(
    result.components[5].items.map((item) => [item.label, item.value]),
    [
      ['WAN ether1', 'Up'],
      ['Uptime', '9 d 3 h'],
      ['Update available', '7.18.2 → 7.19.1'],
    ],
  );
});

test('router: the reboot button asks for a confirmation and reboots', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_commands: true }) });
  const result = await content(w, 'router');
  const button = result.components.find((c) => c.type === 'button');
  assert.deepEqual(button.action, { key: 'reboot', confirm: true });
  assert.equal(button.style, 'danger');
  const ack = await w.fake.widgetAction('router', 'reboot', {}, { settings: {} });
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'Le routeur redémarre.');
  assert.equal(w.router.reboots, 1);
});

test('router: waiting, unreachable, no address, a WAN link down', async (t) => {
  const w = await world(t);
  w.router.setRunning('ether1', false);
  await later(w, 1);
  let result = await content(w, 'router');
  assert.deepEqual(result.components.at(-1).items[0], {
    label: 'WAN ether1',
    icon: 'x-circle',
    value: 'Down',
    color: 'danger',
  });
  w.router.goOffline();
  await later(w, 1);
  result = await content(w, 'router', { language: 'de' });
  assert.deepEqual(types(result), ['text', 'status']);
  assert.equal(result.components[1].items[0].value, 'Nicht erreichbar');

  const empty = await world(t, { config: { language: 'en' } });
  result = await content(empty, 'router');
  assert.match(result.components[0].text, /Enter the address/);
});

test('presence: the followed devices, present first, and the filter', async (t) => {
  const w = await world(t);
  let result = await content(w, 'presence');
  assert.match(result.components[0].text, /No device followed/);
  await createAll(w, (device) => ['Mobile', 'PC', 'Device_3'].includes(device.name));
  await later(w, 5);
  for (const language of LANGS) {
    await content(w, 'presence', { language });
  }
  result = await content(w, 'presence');
  assert.deepEqual(result.components[0].value, 2);
  assert.deepEqual(
    result.components[1].items.map((item) => [item.label, item.value]),
    [
      ['Mobile', 'Present'],
      ['PC', 'Present'],
      ['Device_3', 'Away'],
    ],
  );
  result = await content(w, 'presence', { settings: { show: 'present' } });
  assert.equal(result.components[1].items.length, 2);
  w.router.dissociate('00:00:5E:00:53:01');
  w.router.dissociate('00:00:5E:00:53:02');
  await later(w, 10);
  result = await content(w, 'presence', { settings: { show: 'present' }, language: 'es' });
  const away = (await content(w, 'presence')).components[1].items;
  assert.equal(away.find((item) => item.label === 'Mobile').value, 'Away · 10 min');
  assert.equal(result.components.at(-1).text, 'Ningún dispositivo seguido está presente.');
});

test('presence: more than ten devices fit the budget', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 14; i += 1) {
    w.router.associate(`00:00:5E:00:55:${String(i).padStart(2, '0')}`);
  }
  await later(w, 6);
  await createAll(w, (device) => device.external_id.includes(':client:'));
  const result = await content(w, 'presence');
  assert.equal(result.components[1].items.length, 10);
  assert.match(result.components[2].text, /^\+\d+ more devices$/);
});

test('firewall rules: read only by default, then one confirmed button per rule', async (t) => {
  const config = baseConfig({ firewall_rules: 'Block kids tablet, Guests offline, Gone' });
  const ro = await world(t, { config });
  let result = await content(ro, 'firewall_rules');
  assert.deepEqual(types(result), ['status', 'text']);
  assert.deepEqual(
    result.components[0].items.map((item) => item.value),
    ['Disabled', 'Enabled', 'Not found'],
  );

  const w = await world(t, { config: { ...config, allow_commands: true } });
  result = await content(w, 'firewall_rules');
  const buttons = result.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.icon, b.action.key, b.action.params.active, b.action.confirm]),
    [
      ['Block kids tablet', 'circle', 'rule_1', true, true],
      ['Guests offline', 'check-circle', 'rule_2', false, true],
    ],
  );
  const ack = await w.fake.widgetAction('firewall_rules', 'rule_1', buttons[0].action.params, {
    settings: {},
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Règle « Block kids tablet » activée.');
  assert.equal(w.router.rule('/ip/firewall/filter', 'Block kids tablet')[0].disabled, 'false');
  result = await content(w, 'firewall_rules');
  assert.equal(result.components.find((c) => c.type === 'button').icon, 'check-circle');
  for (const language of LANGS) {
    await content(w, 'firewall_rules', { language });
  }
  const bad = await w.fake.widgetAction('firewall_rules', 'rule_9', {}, { settings: {} });
  assert.equal(bad.success, false);
});

test('short durations in four languages', () => {
  assert.equal(shortDuration(42, 'en'), '0 min');
  assert.equal(shortDuration(3 * 3600, 'fr'), '3 h');
  assert.equal(shortDuration(2 * 86400 + 3600, 'fr'), '2 j 1 h');
  assert.equal(shortDuration(2 * 86400, 'de'), '2 T');
});
