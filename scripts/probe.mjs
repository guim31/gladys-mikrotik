#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real MikroTik router, with the very transports of the
// integration: `node scripts/probe.mjs <address> [--insecure]`.
//
//   - Without credentials, it logs in with an invented account on each of the
//     four protocols and reports how each one refuses it: it checks the
//     detection and the error reading against a real RouterOS.
//   - With MIKROTIK_USER and MIKROTIK_PASSWORD in the environment, it opens a
//     session like the integration does and reads every menu the integration
//     reads (print only: nothing is changed, no update check is asked).
//
// The output never shows a password, a MAC or IP address, a serial number, a
// host name or a comment: only versions, models, counts and field names, so
// it can be pasted in an issue.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseAddress } from '../src/config.js';
import {
  AUTO_ORDER,
  PROTOCOL_LABELS,
  createTransport,
  openSession,
} from '../src/routeros/client.js';
import {
  listMembers,
  parseHealth,
  parseInterfaces,
  parseResource,
  parseRouterboard,
  parseUpdate,
} from '../src/routeros/model.js';

const MENUS = [
  '/system/identity',
  '/system/resource',
  '/system/routerboard',
  '/system/license',
  '/system/health',
  '/system/package/update',
  '/interface',
  '/interface/list/member',
  '/interface/wifi/registration-table',
  '/interface/wifiwave2/registration-table',
  '/interface/wireless/registration-table',
  '/caps-man/registration-table',
  '/ip/arp',
  '/ip/dhcp-server/lease',
  '/ip/firewall/filter',
  '/ipv6/firewall/filter',
];

/**
 * @param {object} options { host, port, username, password, insecure, request, connect }
 * @returns {Promise<string[]>} the report lines
 */
export async function probe({ host, port = null, username, password, insecure = false, ...seams }) {
  const lines = [];
  const common = { host, port, insecure, timeoutMs: 8000, ...seams };
  if (!username) {
    lines.push('No MIKROTIK_USER: logging in with an invented account on each protocol.');
    const fake = `probe-${randomBytes(4).toString('hex')}`;
    for (const protocol of AUTO_ORDER) {
      const transport = createTransport(protocol, {
        ...common,
        username: fake,
        password: randomBytes(12).toString('hex'),
      });
      try {
        await transport.open();
        lines.push(`${PROTOCOL_LABELS[protocol]}: the invented account was ACCEPTED (unexpected)`);
      } catch (err) {
        lines.push(`${PROTOCOL_LABELS[protocol]}: ${err.kind ?? 'error'} — ${err.message}`);
      } finally {
        await transport.close().catch(() => {});
      }
    }
    return lines;
  }

  let session;
  try {
    session = await openSession({ ...common, protocol: 'auto', username, password });
  } catch (err) {
    lines.push(`No session: ${err.kind} — ${err.message}`);
    for (const attempt of err.attempts ?? []) {
      lines.push(
        `  ${PROTOCOL_LABELS[attempt.protocol]}: ${attempt.error?.kind} — ${attempt.error?.message}`,
      );
    }
    return lines;
  }
  const { transport, attempts } = session;
  lines.push(`Protocol: ${PROTOCOL_LABELS[transport.protocol]}`);
  for (const attempt of attempts.filter((a) => a.error)) {
    lines.push(`  (${PROTOCOL_LABELS[attempt.protocol]}: ${attempt.error.kind})`);
  }
  const read = {};
  for (const menu of MENUS) {
    try {
      read[menu] = await transport.print(menu);
      const fields = [...new Set(read[menu].flatMap((item) => Object.keys(item)))].sort();
      lines.push(`${menu}: ${read[menu].length} item(s); fields: ${fields.join(', ') || '-'}`);
    } catch (err) {
      lines.push(`${menu}: ${err.kind} — ${err.message}`);
    }
  }
  await transport.close();

  const resource = parseResource(read['/system/resource']?.[0]);
  const board = parseRouterboard(read['/system/routerboard']?.[0]);
  const update = parseUpdate(read['/system/package/update']?.[0]);
  const health = parseHealth(read['/system/health'] ?? []);
  const interfaces = parseInterfaces(read['/interface'] ?? []);
  lines.push(
    `RouterOS ${resource.version} (${resource.channel}), board ${resource.boardName}, model ${board.model}`,
    `CPU ${resource.cpuLoad} %, memory ${resource.memoryUsage} %, uptime ${resource.uptimeSeconds} s`,
    `Health sensors: ${Object.keys(health.sensors).join(', ') || 'none'}; temperature read: ${health.temperature}`,
    `Update: installed ${update.installed}, latest ${update.latest}, status "${update.status}", available ${update.available}`,
    `Interface types: ${[...new Set(interfaces.map((item) => item.type))].join(', ')}`,
    `WAN list members: ${listMembers(read['/interface/list/member'] ?? []).length}`,
    `Counters present: ${interfaces.every((item) => item.rxBytes !== null) ? 'yes' : 'no'}`,
  );
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [address, ...flags] = process.argv.slice(2);
  const parsed = parseAddress(address ?? '');
  if (!parsed) {
    console.error(
      'Usage: MIKROTIK_USER=… MIKROTIK_PASSWORD=… node scripts/probe.mjs <address> [--insecure]',
    );
    process.exit(2);
  }
  const lines = await probe({
    host: parsed.host,
    port: parsed.port,
    username: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASSWORD ?? '',
    insecure: flags.includes('--insecure'),
  });
  console.log(lines.join('\n'));
}
