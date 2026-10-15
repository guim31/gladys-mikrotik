// -----------------------------------------------------------------------------
// Reading what RouterOS answers. Both transports give strings ("true", "15",
// "1w2d3h4m5s", "7.18.2 (stable)"); a value may also be missing, or typed
// (the fixtures of the Home Assistant tests are). Every reader here accepts
// all of them and never throws on an unexpected item: it skips it.
// -----------------------------------------------------------------------------

/** "true", "yes", true → true; anything else → false. */
export function bool(value) {
  return value === true || value === 'true' || value === 'yes';
}

/** A finite number, or null. */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

const MAC = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;

/** "00:0c:29:ab:cd:ef" → "00:0C:29:AB:CD:EF"; null when not a MAC address. */
export function normalizeMac(value) {
  if (typeof value !== 'string' || !MAC.test(value.trim())) {
    return null;
  }
  return value.trim().toUpperCase().replace(/-/g, ':');
}

/** A text field, trimmed, or null when empty. */
export function str(value) {
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const DURATION_UNITS = { w: 604_800, d: 86_400, h: 3_600, m: 60, s: 1, ms: 0.001 };

/**
 * RouterOS durations: "1w2d3h4m5s", "5h49m36s", "170ms", "00:05:12",
 * "1d02:03:04"; "never" and garbage → null.
 * @returns {number|null} seconds
 */
export function parseDuration(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  let text = value.trim();
  if (!text || text === 'never') {
    return null;
  }
  let seconds = 0;
  // A clock part ("02:03:04") ends some RouterOS 6 durations.
  const clock = text.match(/(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (clock) {
    seconds += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    text = text.slice(0, clock.index);
  }
  const pattern = /(\d+(?:\.\d+)?)(ms|w|d|h|m|s)/g;
  let consumed = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index !== consumed) {
      return null;
    }
    seconds += Number(match[1]) * DURATION_UNITS[match[2]];
    consumed = pattern.lastIndex;
  }
  if (consumed !== text.length || (!clock && consumed === 0)) {
    return null;
  }
  return seconds;
}

/** "7.18.2 (stable)" → { version: "7.18.2", channel: "stable" } */
export function parseVersion(value) {
  const text = str(value);
  if (!text) {
    return { version: null, channel: null };
  }
  const match = text.match(/^(\S+)(?:\s+\(([^)]+)\))?/);
  return { version: match[1], channel: match[2] ?? null };
}

/** Compare "7.18.2" and "7.19rc1"-like versions: negative, 0 or positive. */
export function compareVersions(a, b) {
  const parts = (version) =>
    String(version)
      .split(/[.\s]/)
      .map((part) => {
        const match = part.match(/^(\d+)(.*)$/);
        return match ? [Number(match[1]), match[2]] : [0, part];
      });
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const [ln, ls] = left[i] ?? [0, ''];
    const [rn, rs] = right[i] ?? [0, ''];
    if (ln !== rn) {
      return ln - rn;
    }
    if (ls !== rs) {
      // A pre-release ("rc1", "beta2") comes before the release.
      if (!ls) return 1;
      if (!rs) return -1;
      return ls < rs ? -1 : 1;
    }
  }
  return 0;
}

const percent = (total, free) =>
  total !== null && free !== null && total > 0 ? Math.round(((total - free) / total) * 100) : null;

/** `/system/resource` (one item). */
export function parseResource(item = {}) {
  const { version, channel } = parseVersion(item.version);
  const cpu = num(item['cpu-load']);
  return {
    cpuLoad: cpu === null ? null : Math.max(0, Math.min(100, Math.round(cpu))),
    memoryUsage: percent(num(item['total-memory']), num(item['free-memory'])),
    uptimeSeconds: parseDuration(item.uptime),
    version,
    channel,
    boardName: str(item['board-name']),
    platform: str(item.platform),
  };
}

// The sensor read as "the" temperature of the router, in this order.
const TEMPERATURE_SENSORS = [
  'cpu-temperature',
  'temperature',
  'board-temperature1',
  'board-temperature',
  'switch-temperature',
];

/**
 * `/system/health`: RouterOS 7 lists one item per sensor ({ name, value,
 * type }), RouterOS 6 answers one item with a key per sensor.
 * @returns {{ temperature: number|null, sensors: Record<string, number> }}
 */
export function parseHealth(items = []) {
  const sensors = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (typeof item.name === 'string' && 'value' in item) {
      const value = num(item.value);
      if (value !== null) {
        sensors[item.name] = value;
      }
      continue;
    }
    for (const [key, raw] of Object.entries(item)) {
      const value = num(raw);
      if (value !== null && !key.startsWith('.')) {
        sensors[key] = value;
      }
    }
  }
  const name =
    TEMPERATURE_SENSORS.find((key) => key in sensors) ??
    Object.keys(sensors).find((key) => key.includes('temperature'));
  return { temperature: name === undefined ? null : sensors[name], sensors };
}

/** `/system/routerboard` (one item; "routerboard: false" on a CHR or x86). */
export function parseRouterboard(item = {}) {
  return {
    model: str(item.model),
    serial: str(item['serial-number']),
    firmware: str(item['current-firmware']),
    upgradeFirmware: str(item['upgrade-firmware']),
  };
}

/** `/system/license` (one item): the software id of a RouterBOARD or an x86, the system id of a CHR. */
export function parseLicense(item = {}) {
  return { id: str(item['software-id']) ?? str(item['system-id']) };
}

/** `/system/package/update` (one item). */
export function parseUpdate(item = {}) {
  const installed = parseVersion(item['installed-version']).version;
  const latest = parseVersion(item['latest-version']).version;
  const status = str(item.status);
  const newer = Boolean(installed && latest && compareVersions(latest, installed) > 0);
  return {
    installed,
    latest,
    channel: str(item.channel),
    status,
    available: newer || /new version is available/i.test(status ?? ''),
  };
}

/** `/interface`: the fields this integration uses. */
export function parseInterfaces(items = []) {
  return items
    .filter((item) => item && str(item.name))
    .map((item) => ({
      id: str(item['.id']),
      name: str(item.name),
      defaultName: str(item['default-name']),
      type: str(item.type),
      running: bool(item.running),
      disabled: bool(item.disabled),
      rxBytes: num(item['rx-byte']),
      txBytes: num(item['tx-byte']),
      mac: normalizeMac(item['mac-address']),
      comment: str(item.comment),
    }));
}

/** `/interface/list/member`: the interfaces of one list (case-insensitive). */
export function listMembers(items = [], list = 'WAN') {
  return items
    .filter(
      (item) =>
        item &&
        String(item.list ?? '').toLowerCase() === list.toLowerCase() &&
        !bool(item.disabled) &&
        str(item.interface),
    )
    .map((item) => str(item.interface));
}

/** `/ip/dhcp-server/lease`. */
export function parseLeases(items = []) {
  const leases = [];
  for (const item of items) {
    const mac = normalizeMac(item?.['active-mac-address']) ?? normalizeMac(item?.['mac-address']);
    if (!mac || bool(item.disabled)) {
      continue;
    }
    leases.push({
      mac,
      ip: str(item['active-address']) ?? str(item.address),
      hostName: str(item['host-name']),
      comment: str(item.comment),
      bound: String(item.status ?? '') === 'bound' || Boolean(str(item['active-address'])),
      server: str(item.server),
    });
  }
  return leases;
}

/**
 * The registration tables of the four Wi-Fi stacks: `/interface/wireless`
 * (RouterOS 6 and 7 "wireless" package), `/interface/wifiwave2` (7.1 to
 * 7.12), `/interface/wifi` (7.13+, its CAPsMAN included) and `/caps-man`
 * (legacy CAPsMAN controller). An entry means "associated right now".
 */
export function parseRegistrations(items = [], stack) {
  const entries = [];
  for (const item of items) {
    const mac = normalizeMac(item?.['mac-address']);
    if (!mac) {
      continue;
    }
    const signal =
      num(item.signal) ??
      num(item['rx-signal']) ??
      num(String(item['signal-strength'] ?? '').split('@')[0]);
    entries.push({
      mac,
      interface: str(item.interface),
      ssid: str(item.ssid),
      ip: str(item['last-ip']),
      signal,
      stack,
    });
  }
  return entries;
}

// RouterOS 7 neighbour states that mean "answered recently".
const ARP_ALIVE = new Set(['reachable', 'delay', 'probe']);

/**
 * `/ip/arp`. RouterOS 7 gives the neighbour `status`; RouterOS 6 only says
 * `complete`, which stays true a while after the device left (the departure
 * delay absorbs it).
 */
export function parseArp(items = []) {
  const entries = [];
  for (const item of items) {
    const mac = normalizeMac(item?.['mac-address']);
    if (!mac || bool(item.disabled) || bool(item.invalid)) {
      continue;
    }
    const status = str(item.status);
    const alive =
      status !== null ? ARP_ALIVE.has(status) : bool(item.complete) && bool(item.dynamic ?? true);
    entries.push({ mac, ip: str(item.address), interface: str(item.interface), alive });
  }
  return entries;
}

/** `/ip/firewall/filter` (or `/ipv6/firewall/filter`). */
export function parseRules(items = []) {
  return items
    .filter((item) => item && str(item['.id']))
    .map((item) => ({
      id: str(item['.id']),
      comment: str(item.comment),
      disabled: bool(item.disabled),
      dynamic: bool(item.dynamic),
      chain: str(item.chain),
      action: str(item.action),
    }));
}

/** `/system/identity` (one item). */
export const parseIdentity = (item = {}) => str(item.name);
