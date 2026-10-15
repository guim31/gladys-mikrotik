// -----------------------------------------------------------------------------
// Reading what RouterOS answers (src/routeros/model.js), on the fixtures of
// RouterOS 7 and RouterOS 6 and on the typed values of the Home Assistant
// test data: every reader accepts strings and native values alike.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bool,
  compareVersions,
  listMembers,
  normalizeMac,
  num,
  parseArp,
  parseDuration,
  parseHealth,
  parseInterfaces,
  parseLeases,
  parseRegistrations,
  parseResource,
  parseUpdate,
  parseVersion,
} from '../src/routeros/model.js';
import { fixture } from './helpers/fakeRouterOs.js';

const ros7 = fixture('ros7-rb5009');
const ros6 = fixture('ros6-hap');

test('booleans and numbers, as strings or typed', () => {
  assert.equal(bool('true'), true);
  assert.equal(bool('yes'), true);
  assert.equal(bool(true), true);
  assert.equal(bool('false'), false);
  assert.equal(bool(undefined), false);
  assert.equal(num('15'), 15);
  assert.equal(num(24.2), 24.2);
  assert.equal(num(''), null);
  assert.equal(num('auto'), null);
});

test('RouterOS durations', () => {
  assert.equal(parseDuration('1w2d3h4m5s'), 7 * 86400 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(parseDuration('5h49m36s'), 5 * 3600 + 49 * 60 + 36);
  assert.equal(parseDuration('170ms'), 0.17);
  assert.equal(parseDuration('3d01:02:03'), 3 * 86400 + 3723);
  assert.equal(parseDuration('00:05:12'), 312);
  assert.equal(parseDuration('never'), null);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration(''), null);
});

test('versions and their order', () => {
  assert.deepEqual(parseVersion('7.18.2 (stable)'), { version: '7.18.2', channel: 'stable' });
  assert.deepEqual(parseVersion('6.49.17 (long-term)'), {
    version: '6.49.17',
    channel: 'long-term',
  });
  assert.ok(compareVersions('7.19.1', '7.18.2') > 0);
  assert.ok(compareVersions('7.18', '7.18.2') < 0);
  assert.ok(compareVersions('7.19rc1', '7.19') < 0);
  assert.equal(compareVersions('6.49.17', '6.49.17'), 0);
});

test('resources: CPU, memory, uptime, version', () => {
  assert.deepEqual(parseResource(ros7['/system/resource'][0]), {
    cpuLoad: 15,
    memoryUsage: 25,
    uptimeSeconds: 788645,
    version: '7.18.2',
    channel: 'stable',
    boardName: 'RB5009UG+S+',
    platform: 'MikroTik',
  });
  // The typed values of the Home Assistant tests.
  const typed = parseResource({
    'cpu-load': 15,
    'total-memory': 1000,
    'free-memory': 200,
    uptime: '1w2d3h4m5s',
  });
  assert.equal(typed.memoryUsage, 80);
  assert.equal(parseResource({}).cpuLoad, null);
});

test('health: one item per sensor (7) or one item (6), CPU sensor first', () => {
  assert.equal(parseHealth(ros7['/system/health']).temperature, 47);
  assert.equal(parseHealth(ros6['/system/health']).temperature, 41);
  assert.equal(parseHealth([{ name: 'voltage', value: 24.2 }]).temperature, null);
  assert.equal(parseHealth([]).temperature, null);
});

test('updates: newer version or RouterOS status', () => {
  assert.equal(parseUpdate(ros7['/system/package/update'][0]).available, true);
  assert.equal(parseUpdate(ros6['/system/package/update'][0]).available, false);
  assert.equal(
    parseUpdate({ 'installed-version': '7.18.2', 'latest-version': '7.18.2' }).available,
    false,
  );
  assert.equal(parseUpdate({ 'installed-version': '7.18.2' }).available, false);
});

test('interfaces and the WAN list', () => {
  const interfaces = parseInterfaces(ros7['/interface']);
  const ether1 = interfaces.find((item) => item.name === 'ether1');
  assert.equal(ether1.running, true);
  assert.equal(ether1.rxBytes, 905138492811);
  assert.equal(interfaces.find((item) => item.name === 'ether3').disabled, true);
  assert.deepEqual(listMembers(ros7['/interface/list/member']), ['ether1']);
  assert.deepEqual(listMembers(ros6['/interface/list/member'], 'wan'), [
    'ether1-gateway',
    'pppoe-out1',
  ]);
});

test('leases, registrations of every Wi-Fi package, ARP of RouterOS 6 and 7', () => {
  const leases = parseLeases(ros7['/ip/dhcp-server/lease']);
  assert.deepEqual(
    leases.map((lease) => [lease.mac.slice(-2), lease.bound]),
    [
      ['01', true],
      ['02', true],
      ['03', false],
      ['04', true],
    ],
  );
  assert.equal(leases[0].comment, 'Mobile');
  const wifi = parseRegistrations(ros7['/interface/wifi/registration-table'], '/interface/wifi');
  assert.deepEqual(
    wifi.map((entry) => entry.signal),
    [-47, -62],
  );
  const legacy = parseRegistrations(
    ros6['/interface/wireless/registration-table'],
    '/interface/wireless',
  );
  assert.equal(legacy[0].signal, -62);
  assert.equal(legacy[0].ip, '192.0.2.21');
  const capsman = parseRegistrations(
    [{ 'mac-address': '00:00:5e:00:53:31', 'rx-signal': '-70', interface: 'cap1' }],
    '/caps-man',
  );
  assert.equal(capsman[0].mac, '00:00:5E:00:53:31');
  assert.deepEqual(
    parseArp(ros7['/ip/arp']).map((entry) => entry.alive),
    [true, true, false, true],
  );
  assert.deepEqual(
    parseArp(ros6['/ip/arp']).map((entry) => entry.alive),
    [true, true],
  );
  assert.equal(
    parseArp([{ 'mac-address': '00:00:5E:00:53:09', complete: 'false' }])[0].alive,
    false,
  );
});

test('MAC addresses', () => {
  assert.equal(normalizeMac('00:0c:29:ab:cd:ef'), '00:0C:29:AB:CD:EF');
  assert.equal(normalizeMac('00-0C-29-AB-CD-EF'), '00:0C:29:AB:CD:EF');
  assert.equal(normalizeMac('not a mac'), null);
  assert.equal(normalizeMac(undefined), null);
});
