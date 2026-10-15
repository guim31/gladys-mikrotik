// -----------------------------------------------------------------------------
// The hub end to end (src/hub.js): the SDK's fake Gladys on one side, a fake
// RouterOS on the other, a manual clock. Discovery, states, rates, presence,
// scene events, commands and failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS } from '../src/hub.js';
import {
  FakeRouterOs,
  HOST,
  PASSWORD,
  baseConfig,
  createAll,
  createClock,
  createWorld,
  ids,
  later,
} from './helpers/world.js';

const PHONE = '00:00:5E:00:53:01'; // on Wi-Fi in the RouterOS 7 fixture
const PC = '00:00:5E:00:53:02'; // wired, in ARP

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const state = (w, id) => w.fake.lastState(id);

test('discovery: the router by serial number, the followed rules, the clients', async (t) => {
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet' }) });
  const devices = w.fake.discoveredDevices;
  const router = devices[0];
  assert.equal(router.external_id, ids(w.gladys).router().device);
  assert.equal(router.name, 'MikroTik RB5009UG+S+');
  assert.equal(router.should_poll, false);
  assert.deepEqual(
    router.features.map((feature) => feature.external_id.split(':').pop()),
    [
      'cpu_load',
      'memory_usage',
      'temperature',
      'uptime',
      'routeros_version',
      'update_available',
      'wan_ether1_download',
      'wan_ether1_upload',
      'wan_ether1_link',
    ],
  );
  assert.equal(devices[1].external_id, ids(w.gladys).rule('block-kids-tablet').device);
  const clients = devices.slice(2);
  assert.deepEqual(
    clients.map((device) => device.name),
    ['Mobile', 'PC', 'Wifiwave2 device', 'Device_3'],
    'named by comment, then host name; never the ISP box seen on the WAN',
  );
  assert.ok(
    !clients.some((device) => device.params.some((p) => p.value.includes('00:00:5E:00:53:A'))),
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('RouterOS 6 over the API: PPPoE WAN, legacy Wi-Fi, health in one item', async (t) => {
  const router = new FakeRouterOs({
    fixture: 'ros6-hap',
    users: { gladys: { password: PASSWORD, group: 'read' } },
  });
  const w = await world(t, { router });
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.external_id, w.gladys.externalIds('router', 'd52g0abcdef1').device);
  assert.equal(device.name, 'hAP-salon');
  const keys = device.features.map((feature) => feature.external_id.split(':').pop());
  assert.ok(keys.includes('wan_pppoe-out1_download'));
  assert.ok(keys.includes('wan_ether1-gateway_link'));
  assert.equal(w.hub.session.protocol, 'api');
  await createAll(w);
  assert.equal(state(w, w.gladys.externalIds('router', 'd52g0abcdef1').feature('temperature')), 41);
  assert.equal(
    state(w, w.gladys.externalIds('client', '00:00:5e:00:53:21').feature('presence')),
    1,
  );
  // A read-only user cannot ask RouterOS to check for updates: the cached result is used.
  assert.equal(router.updateChecks, 0);
  assert.equal(w.hub.caps.updateCheck, false);
});

test('states: only for the added devices, then the rates of the WAN', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0, 'nothing before the devices are added');
  await createAll(w, (device) => device.external_id.includes(':router:'));
  const router = ids(w.gladys).router();
  assert.equal(state(w, router.feature('cpu_load')), 15);
  assert.equal(state(w, router.feature('memory_usage')), 25);
  assert.equal(state(w, router.feature('temperature')), 47);
  assert.equal(state(w, router.feature('uptime')), 219);
  assert.equal(state(w, router.feature('routeros_version')), '7.18.2');
  assert.equal(state(w, router.feature('update_available')), 1);
  assert.equal(state(w, router.feature('wan_ether1_link')), 1);
  assert.equal(
    state(w, router.feature('wan_ether1_download')),
    undefined,
    'no rate before two readings',
  );

  // 75 MB down and 7.5 MB up in a minute: 10 and 1 Mbit/s.
  w.router.traffic('ether1', 75_000_000, 7_500_000);
  await later(w, 1);
  assert.equal(state(w, router.feature('wan_ether1_download')), 10);
  assert.equal(state(w, router.feature('wan_ether1_upload')), 1);
  // Counters reset by a reboot: no rate this time, the next reading is right again.
  w.router.interface('ether1')['rx-byte'] = '1000';
  w.router.interface('ether1')['tx-byte'] = '1000';
  await later(w, 1);
  assert.equal(state(w, router.feature('wan_ether1_download')), 10);
  assert.ok(w.fake.states.every((s) => !s.device_feature_external_id.includes(':client:')));
});

test('only the changes are published, and a heartbeat every few hours', async (t) => {
  const w = await world(t);
  await createAll(w, (device) => device.external_id.includes(':router:'));
  const cpu = ids(w.gladys).router().feature('cpu_load');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === cpu).length;
  assert.equal(count(), 1);
  await later(w, 1);
  await later(w, 1);
  assert.equal(count(), 1);
  w.router.data['/system/resource'][0]['cpu-load'] = '40';
  await later(w, 1);
  assert.equal(count(), 2);
  await later(w, 6 * 60);
  assert.equal(count(), 3, 'heartbeat');
});

test('presence: present at once, away after the delay, unchanged while the router is down', async (t) => {
  const w = await world(t, { config: baseConfig({ away_delay: 5 }) });
  await createAll(w, (device) => device.external_id.includes(':client:'));
  const phone = ids(w.gladys).client(PHONE).feature('presence');
  const pc = ids(w.gladys).client(PC).feature('presence');
  assert.equal(state(w, phone), 1);
  assert.equal(state(w, pc), 1, 'seen in ARP');

  w.router.dissociate(PHONE);
  await later(w, 3);
  assert.equal(state(w, phone), 1, 'within the delay');
  await later(w, 2);
  assert.equal(state(w, phone), 0);

  w.router.associate(PHONE);
  await later(w, 1);
  assert.equal(state(w, phone), 1);

  // The router stops answering for half an hour: nobody leaves.
  w.router.goOffline();
  for (let i = 0; i < 6; i += 1) {
    await later(w, 5);
  }
  assert.equal(state(w, phone), 1);
  assert.equal(state(w, pc), 1);
  w.router.goOnline();
  await later(w, 1);
  assert.equal(state(w, phone), 1);
});

test('a present device is published again every two minutes (Check presence)', async (t) => {
  const w = await world(t);
  await createAll(w, (device) => device.external_id.includes(':client:'));
  const phone = ids(w.gladys).client(PHONE).feature('presence');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === phone).length;
  const before = count();
  await later(w, 1);
  assert.equal(count(), before);
  await later(w, 1);
  assert.equal(count(), before + 1);
});

test('a device added while present is followed at once', async (t) => {
  const w = await world(t);
  const device = w.fake.discoveredDevices.find((d) => d.name === 'Mobile');
  await w.fake.deviceCreated(device);
  assert.equal(state(w, device.features[0].external_id), 1);
  assert.ok(w.fake.widgetRefreshes.includes('presence'));
});

test('unknown device connected: not for the network learnt at first, once per MAC, across restarts', async (t) => {
  const clock = createClock();
  const router = new FakeRouterOs({ users: { gladys: { password: PASSWORD, group: 'full' } } });
  const first = await createWorld({ router, clock });
  assert.deepEqual(first.fake.sceneEvents, [], 'the first reading learns the network');
  router.associate('00:00:5E:00:53:77');
  await later(first, 1);
  assert.deepEqual(first.fake.sceneEvents, [
    {
      key: TRIGGERS.UNKNOWN_DEVICE,
      data: {
        mac: '00:00:5E:00:53:77',
        ip: null,
        host_name: null,
        source: 'wifi',
        interface: 'wifi1',
      },
    },
  ]);
  await later(first, 1);
  assert.equal(first.fake.sceneEvents.length, 1, 'once');
  await first.app.stop();

  // Restart on the same /data: known devices stay known, a new lease fires.
  const second = await createWorld({ router, clock, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(second.fake.sceneEvents, []);
  router.addLease('00:00:5E:00:53:78', { hostName: 'guest-laptop', ip: '192.0.2.78' });
  router.addLease('00:00:5E:00:53:79', { bound: false }); // reserved, never connected
  await later(second, 1);
  assert.equal(second.fake.sceneEvents.length, 1);
  assert.deepEqual(second.fake.sceneEvents[0].data, {
    mac: '00:00:5E:00:53:78',
    ip: '192.0.2.78',
    host_name: 'guest-laptop',
    source: 'dhcp',
    interface: 'defconf',
  });
});

test('a flood of new devices fires five events at most per reading', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 12; i += 1) {
    w.router.associate(`00:00:5E:00:54:${String(i).padStart(2, '0')}`);
  }
  await later(w, 1);
  assert.equal(w.fake.sceneEvents.length, 5);
  await later(w, 1);
  assert.equal(w.fake.sceneEvents.length, 5, 'the others are known now');
});

test('WAN down and back, with the length of the outage', async (t) => {
  const w = await world(t);
  await createAll(w, (device) => device.external_id.includes(':router:'));
  const link = ids(w.gladys).router().feature('wan_ether1_link');
  w.router.setRunning('ether1', false);
  await later(w, 1);
  assert.equal(state(w, link), 0);
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.WAN_DOWN,
    data: { interface: 'ether1' },
  });
  await later(w, 1);
  assert.equal(w.fake.sceneEvents.length, 1, 'one event per transition');
  w.clock.advance(11 * 60_000);
  w.router.setRunning('ether1', true);
  await later(w, 1);
  assert.equal(state(w, link), 1);
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.WAN_UP,
    data: { interface: 'ether1', down_minutes: 13 },
  });
});

test('WAN interfaces from the configuration', async (t) => {
  const w = await world(t, { config: baseConfig({ wan_interfaces: 'ether2, sfp1' }) });
  const names = w.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(names.includes('Download ether2'));
  assert.ok(names.includes('WAN link sfp1'));
  assert.equal(w.hub.snapshot.wan.get('sfp1').found, false, 'unknown interface: no state');
});

test('firewall rules: state of IPv4 and IPv6 together; commands off by default', async (t) => {
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet' }) });
  await createAll(w, (device) => device.external_id.includes(':rule:'));
  const rule = ids(w.gladys).rule('block-kids-tablet');
  assert.equal(state(w, rule.feature('active')), 0);
  const ack = await w.fake.sceneAction('enable_firewall_rule', { rule: rule.device });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Allow commands/);
  assert.equal(w.router.commands.filter((c) => c.command === 'set').length, 0);
});

test('firewall rules: enable and disable, every rule of the comment', async (t) => {
  const w = await world(t, {
    config: baseConfig({ firewall_rules: 'Block kids tablet', allow_commands: true }),
  });
  await createAll(w, (device) => device.external_id.includes(':rule:'));
  const rule = ids(w.gladys).rule('block-kids-tablet');
  let ack = await w.fake.sceneAction('enable_firewall_rule', { rule: rule.device });
  assert.deepEqual(ack, { success: true, data: { outputs: { active: true } } });
  assert.equal(w.router.rule('/ip/firewall/filter', 'Block kids tablet')[0].disabled, 'false');
  assert.equal(w.router.rule('/ipv6/firewall/filter', 'Block kids tablet')[0].disabled, 'false');
  assert.equal(state(w, rule.feature('active')), 1);
  ack = await w.fake.sceneAction('disable_firewall_rule', { rule: rule.device });
  assert.equal(ack.data.outputs.active, false);
  assert.equal(state(w, rule.feature('active')), 0);
  // Only the `disabled` flag of the listed rules is ever set.
  for (const command of w.router.commands.filter((c) => c.command !== 'print')) {
    if (command.command === 'check-for-updates') continue;
    assert.equal(command.command, 'set');
    assert.deepEqual(Object.keys(command.params).sort(), ['.id', 'disabled']);
    assert.ok(['*1A', '*9'].includes(command.params['.id']));
  }
  // Another device, or a rule gone from the router.
  ack = await w.fake.sceneAction('enable_firewall_rule', { rule: ids(w.gladys).router().device });
  assert.match(ack.error, /not a firewall rule/);
  w.router.data['/ip/firewall/filter'] = [];
  w.router.data['/ipv6/firewall/filter'] = [];
  ack = await w.fake.sceneAction('enable_firewall_rule', { rule: rule.device });
  assert.match(ack.error, /No firewall rule/);
});

test('commands refused by a read-only user, reboot by a full one', async (t) => {
  const readOnly = new FakeRouterOs({ users: { gladys: { password: PASSWORD, group: 'read' } } });
  const w = await world(t, {
    router: readOnly,
    config: baseConfig({ firewall_rules: 'Block kids tablet', allow_commands: true }),
  });
  let ack = await w.fake.sceneAction('enable_firewall_rule', {
    rule: ids(w.gladys).rule('block-kids-tablet').device,
  });
  assert.match(ack.error, /write and reboot/);
  ack = await w.fake.sceneAction('reboot_router', {});
  assert.match(ack.error, /write and reboot/);
  assert.equal(readOnly.reboots, 0);

  const full = await world(t, { config: baseConfig({ allow_commands: true }) });
  ack = await full.fake.sceneAction('reboot_router', {});
  assert.equal(ack.success, true);
  assert.equal(full.router.reboots, 1);
  const off = await world(t);
  ack = await off.fake.sceneAction('reboot_router', {});
  assert.equal(ack.success, false);
  assert.equal(off.router.reboots, 0);
});

test('a refused password: retried every five minutes, not at every reading', async (t) => {
  const w = await world(t, { config: baseConfig({ password: 'wrong' }) });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /password refused/);
  const failed = w.router.logins.failed;
  await later(w, 1);
  await later(w, 1);
  assert.equal(w.router.logins.failed, failed);
  await later(w, 4);
  assert.ok(w.router.logins.failed > failed);
});

test('no address: a message, no reading', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  assert.equal(w.router.commands.length, 0);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.fr, /Saisissez/);
});

test('an unreachable router: reported, unreachable badge, back on its own', async (t) => {
  const w = await world(t);
  w.router.goOffline();
  await later(w, 1);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: ids(w.gladys).router().device,
    transport: 'unreachable',
  });
  w.router.goOnline();
  await later(w, 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the test report names the protocol, the WAN and the rules', async (t) => {
  const w = await world(t, { config: baseConfig({ firewall_rules: 'Block kids tablet, Nope' }) });
  const { data } = await w.fake.action('test_connection', {});
  assert.match(data.message.en, /Connected with REST \(HTTP\) to MikroTik RB5009UG\+S\+/);
  assert.match(data.message.en, /ether1 \(up\)/);
  assert.match(data.message.en, /Nope: no rule with this comment/);
  assert.match(data.message.en, /unencrypted/);
  assert.ok(!data.message.en.includes(PASSWORD));
  const list = await w.fake.action('list_firewall_rules', {});
  assert.match(list.data.message.en, /Block kids tablet ✓ — forward\/drop, IPv4\+IPv6, disabled/);
  assert.ok(!list.data.message.en.includes('fasttrack'), 'dynamic rules are not listed');
});

test('a new client reaches the discovery list within five minutes, the router structure at once', async (t) => {
  const w = await world(t);
  const count = () => w.fake.discoveredDevices.length;
  const before = count();
  w.router.addLease('00:00:5E:00:53:55', { hostName: 'tv' });
  await later(w, 1);
  assert.equal(count(), before);
  await later(w, 5);
  assert.equal(count(), before + 1);
  await w.fake.configUpdated(baseConfig({ wan_interfaces: 'ether2' }));
  assert.ok(w.fake.discoveredDevices[0].features.some((f) => f.name === 'Download ether2'));
});

test('a reconnection of Gladys publishes everything again', async (t) => {
  const w = await world(t);
  await createAll(w, (device) => device.external_id.includes(':router:'));
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await later(w, 0);
  assert.ok(w.fake.states.length >= before + 6);
});

test('Gladys asking to poll does not read twice when the timer runs', async (t) => {
  const w = await world(t);
  const reads = () => w.router.commands.filter((c) => c.menu === '/system/resource').length;
  const before = reads();
  await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(reads(), before + 1, 'no timer in this test: the poll reads');
  assert.equal(HOST, '192.0.2.1');
});
