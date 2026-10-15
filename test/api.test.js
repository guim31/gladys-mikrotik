// -----------------------------------------------------------------------------
// The RouterOS API protocol (src/routeros/api.js): the length encoding of the
// official documentation, sentences cut anywhere by the network, the login
// (6.43+ and the older challenge), the replies (!re, !done, !trap, !empty,
// !fatal), and one session over a real TCP socket on the loopback.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net from 'node:net';
import {
  ApiTransport,
  SentenceReader,
  attributes,
  challengeResponse,
  decodeLength,
  encodeLength,
  encodeSentence,
  tlsOptions,
} from '../src/routeros/api.js';
import { ERROR_KINDS } from '../src/routeros/errors.js';
import { FakeRouterOs, createNetwork } from './helpers/fakeRouterOs.js';

const hex = (buffer) => buffer.toString('hex');

test('lengths are encoded on 1 to 5 bytes, as the documentation says', () => {
  const vectors = [
    [0x00, '00'],
    [0x7f, '7f'],
    [0x80, '8080'],
    [0x3fff, 'bfff'],
    [0x4000, 'c04000'],
    [0x1fffff, 'dfffff'],
    [0x200000, 'e0200000'],
    [0xfffffff, 'efffffff'],
    [0x10000000, 'f010000000'],
  ];
  for (const [length, expected] of vectors) {
    assert.equal(hex(encodeLength(length)), expected, `0x${length.toString(16)}`);
    assert.deepEqual(decodeLength(Buffer.from(expected, 'hex'), 0), {
      length,
      size: expected.length / 2,
    });
  }
  assert.equal(decodeLength(Buffer.from('c040', 'hex'), 0), null, 'incomplete header');
});

test('a sentence ends with an empty word, words are UTF-8', () => {
  assert.equal(hex(encodeSentence(['/login'])), `06${Buffer.from('/login').toString('hex')}00`);
  const reader = new SentenceReader();
  assert.deepEqual(reader.push(encodeSentence(['!re', '=comment=Tablette de Léo'])), [
    ['!re', '=comment=Tablette de Léo'],
  ]);
});

test('sentences cut anywhere by the network are put back together', () => {
  const long = 'x'.repeat(300); // a two-byte length
  const bytes = Buffer.concat([
    encodeSentence(['!re', `=name=${long}`]),
    encodeSentence(['!re', '=name=b']),
    encodeSentence(['!done']),
  ]);
  for (let cut = 1; cut < bytes.length; cut += 7) {
    const reader = new SentenceReader();
    const sentences = [...reader.push(bytes.subarray(0, cut)), ...reader.push(bytes.subarray(cut))];
    assert.equal(sentences.length, 3, `cut at ${cut}`);
    assert.equal(sentences[0][1], `=name=${long}`);
  }
});

test('attribute values may contain "=" and be empty', () => {
  assert.deepEqual(attributes(['=comment=a=b', '=disabled=', '.tag=1', '=.id=*1A']), {
    comment: 'a=b',
    disabled: '',
    '.id': '*1A',
  });
});

test('the pre-6.43 challenge answer is 00 + md5(0x00 + password + challenge)', () => {
  const challenge = 'ebddd18303a54111e2dea05a92ab46b4';
  const expected = createHash('md5')
    .update(Buffer.concat([Buffer.from([0]), Buffer.from('pw'), Buffer.from(challenge, 'hex')]))
    .digest('hex');
  assert.equal(challengeResponse('pw', challenge), `00${expected}`);
});

test('API-SSL: anonymous suites only when unverified certificates are accepted', () => {
  assert.deepEqual(tlsOptions({ host: '192.0.2.1', insecure: false }), {
    rejectUnauthorized: true,
  });
  const insecure = tlsOptions({ host: 'router.lan', insecure: true });
  assert.equal(insecure.rejectUnauthorized, false);
  assert.equal(insecure.servername, 'router.lan');
  assert.match(insecure.ciphers, /ADH/);
});

const transport = (router, extra = {}) =>
  new ApiTransport({
    host: '192.0.2.1',
    port: 8728,
    secure: false,
    username: 'gladys',
    password: 'secret',
    connect: createNetwork({ '192.0.2.1': router }).connect,
    ...extra,
  });

test('login, listing and command against the fake RouterOS 7', async () => {
  const router = new FakeRouterOs();
  const api = transport(router);
  await api.open();
  const [resource] = await api.print('/system/resource');
  assert.equal(resource.version, '7.18.2 (stable)');
  const interfaces = await api.print('/interface', { proplist: ['name', 'running'] });
  assert.deepEqual(Object.keys(interfaces[0]).sort(), ['name', 'running']);
  // RouterOS 7.18+ answers !empty then !done for an empty table.
  router.data['/ip/arp'] = [];
  assert.deepEqual(await api.print('/ip/arp'), []);
  await api.run('/ip/firewall/filter', 'set', { '.id': '*1A', disabled: 'no' });
  assert.equal(router.rule('/ip/firewall/filter', 'Block kids tablet')[0].disabled, 'false');
  await api.close();
});

test('the RouterOS 6 challenge login', async () => {
  const router = new FakeRouterOs({ fixture: 'ros6-hap', legacyLogin: true });
  const api = transport(router);
  await api.open();
  assert.equal((await api.print('/system/identity'))[0].name, 'hAP-salon');
  await api.close();
  const wrong = transport(router, { password: 'nope' });
  await assert.rejects(wrong.open(), { kind: ERROR_KINDS.AUTH });
});

test('a refused password, an unknown menu, a missing permission', async () => {
  const router = new FakeRouterOs({ users: { gladys: { password: 'secret', group: 'read' } } });
  await assert.rejects(transport(router, { password: 'wrong' }).open(), {
    kind: ERROR_KINDS.AUTH,
  });
  const api = transport(router);
  await assert.rejects(api.print('/interface/wireless/registration-table'), {
    kind: ERROR_KINDS.NOT_FOUND,
  });
  await assert.rejects(api.run('/system', 'reboot'), { kind: ERROR_KINDS.PERMISSION });
  // The session survives the refusals.
  assert.equal((await api.print('/system/identity'))[0].name, 'MikroTik');
  await api.close();
});

test('a router that hangs up fails the command, the next one reconnects', async () => {
  const router = new FakeRouterOs();
  const api = transport(router);
  await api.open();
  router.goOffline();
  await assert.rejects(api.print('/system/resource'), { kind: ERROR_KINDS.UNREACHABLE });
  router.goOnline();
  assert.equal((await api.print('/system/identity'))[0].name, 'MikroTik');
  await api.close();
});

test('no answer within the timeout: unreachable', async () => {
  const silent = () => {
    const socket = new net.Socket();
    setImmediate(() => socket.emit('connect'));
    socket.write = () => true;
    return socket;
  };
  const api = transport(new FakeRouterOs(), { connect: silent, timeoutMs: 50 });
  await assert.rejects(api.open(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('a real TCP session on the loopback', async (t) => {
  const router = new FakeRouterOs();
  // A TCP server relaying the bytes to a fake socket of the router.
  const server = net.createServer((client) => {
    const fake = router.openSocket({ secure: false });
    fake.on('data', (data) => client.write(data));
    client.on('data', (data) => fake.write(data));
    client.on('error', () => {});
    client.on('close', () => fake.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = new ApiTransport({
    host: '127.0.0.1',
    port: server.address().port,
    secure: false,
    username: 'gladys',
    password: 'secret',
  });
  const leases = await api.print('/ip/dhcp-server/lease');
  assert.equal(leases.length, 4);
  await api.close();
});
