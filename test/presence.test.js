// -----------------------------------------------------------------------------
// Presence (src/presence.js): sources, departure delay, start without history.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceTracker, collectClients } from '../src/presence.js';

const A = '00:00:5E:00:53:01';
const B = '00:00:5E:00:53:02';

const reading = {
  registrations: [{ mac: A, ip: null, ssid: 'home', interface: 'wifi1' }],
  arp: [
    { mac: B, ip: '192.0.2.12', interface: 'bridge', alive: true },
    { mac: '00:00:5E:00:53:F0', ip: '198.51.100.1', interface: 'ether1', alive: true },
  ],
  leases: [
    { mac: A, ip: '192.0.2.11', hostName: 'phone', comment: 'Mobile', bound: true },
    { mac: B, ip: '192.0.2.12', hostName: 'pc', comment: null, bound: true },
  ],
};

test('Wi-Fi always counts; ARP and DHCP only when enabled; never the WAN side', () => {
  const both = collectClients(reading, { arp: true, wan: new Set(['ether1']) });
  assert.deepEqual([...both.keys()], [A, B]);
  assert.deepEqual(both.get(A).sources, ['wifi']);
  assert.equal(both.get(A).comment, 'Mobile');
  assert.deepEqual(both.get(B).sources, ['arp']);
  const wifiOnly = collectClients(reading, { arp: false });
  assert.equal(wifiOnly.get(B).seen, false, 'a lease alone is not a presence');
  assert.equal(collectClients(reading, { arp: false, dhcp: true }).get(B).seen, true);
  assert.equal(collectClients(reading, { ignore: new Set([A]) }).has(A), false);
});

test('the departure delay', () => {
  let now = 0;
  const tracker = new PresenceTracker({ awayDelayMs: 5 * 60_000, now: () => now });
  const seen = new Map([[A, { seen: true }]]);
  const gone = new Map();
  assert.deepEqual(tracker.update([A], seen), [A]);
  assert.equal(tracker.presence(A), 1);
  now += 4 * 60_000;
  assert.deepEqual(tracker.update([A], gone), []);
  assert.equal(tracker.presence(A), 1, 'still present within the delay');
  now += 60_000;
  assert.deepEqual(tracker.update([A], gone), [A]);
  assert.equal(tracker.presence(A), 0);
  now += 60_000;
  tracker.update([A], seen);
  assert.equal(tracker.presence(A), 1, 'back at once');
});

test('never seen since the start: unknown, then away after the delay', () => {
  let now = 0;
  const tracker = new PresenceTracker({ awayDelayMs: 60_000, now: () => now });
  tracker.update([B], new Map());
  assert.equal(tracker.presence(B), null);
  now += 60_000;
  tracker.update([B], new Map());
  assert.equal(tracker.presence(B), 0);
});

test('no delay: away at the first reading without it', () => {
  let now = 0;
  const tracker = new PresenceTracker({ awayDelayMs: 0, now: () => now });
  tracker.update([A], new Map([[A, { seen: true }]]));
  now += 1000;
  tracker.update([A], new Map());
  assert.equal(tracker.presence(A), 0);
});
