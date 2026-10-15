// -----------------------------------------------------------------------------
// Configuration normalization (src/config.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseAddress, splitList } from '../src/config.js';

test('defaults', () => {
  const config = normalizeConfig({});
  assert.equal(config.host, null);
  assert.equal(config.invalidHost, false);
  assert.equal(config.protocol, 'auto');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.awayDelayMs, 5 * 60_000);
  assert.equal(config.presenceArp, true);
  assert.equal(config.presenceDhcp, false);
  assert.equal(config.allowCommands, false, 'read only by default');
  assert.equal(config.allowSelfSigned, false);
  assert.equal(config.language, 'fr');
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), config);
});

test('addresses: bare, with a port, copied from the browser, refused', () => {
  assert.deepEqual(parseAddress('192.0.2.1'), { host: '192.0.2.1', port: null });
  assert.deepEqual(parseAddress(' router.lan:8443 '), { host: 'router.lan', port: 8443 });
  assert.deepEqual(parseAddress('https://192.0.2.1/webfig/'), { host: '192.0.2.1', port: null });
  assert.deepEqual(parseAddress('[2001:db8::1]:8729'), { host: '2001:db8::1', port: 8729 });
  assert.equal(parseAddress('https://admin:pw@192.0.2.1'), null, 'no credentials in the address');
  assert.equal(parseAddress('http://'), null);
  const config = normalizeConfig({ host: 'http://user:pw@192.0.2.1' });
  assert.equal(config.host, null);
  assert.equal(config.invalidHost, true);
});

test('lists: WAN interfaces and rule comments', () => {
  assert.deepEqual(splitList(' ether1, pppoe-out1;ether1,, '), ['ether1', 'pppoe-out1']);
  const config = normalizeConfig({
    wan_interfaces: 'a,b,c,d,e',
    firewall_rules: 'Block kids tablet, Guests offline',
  });
  assert.deepEqual(config.wanInterfaces, ['a', 'b', 'c', 'd']);
  assert.deepEqual(config.rules, ['Block kids tablet', 'Guests offline']);
});

test('numbers, booleans and choices as the form sends them', () => {
  const config = normalizeConfig({
    away_delay: '2,5',
    presence_arp: 'false',
    allow_commands: 'true',
    poll_interval: 10,
    protocol: 'telnet',
    language: 'it',
  });
  assert.equal(config.awayDelayMs, 3 * 60_000);
  assert.equal(config.presenceArp, false);
  assert.equal(config.allowCommands, true);
  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal(config.protocol, 'auto');
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ away_delay: 500 }).awayDelayMs, 60 * 60_000);
  assert.equal(normalizeConfig({ away_delay: 0 }).awayDelayMs, 0);
  assert.equal(normalizeConfig({ password: ' with spaces ' }).password, ' with spaces ');
});
