// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// How the integration reaches RouterOS. `auto` tries them in this order: the
// encrypted ones first, then the plain ones (see src/routeros/client.js).
export const PROTOCOLS = ['auto', 'rest_https', 'api_ssl', 'rest_http', 'api'];

export const DEFAULT_PORTS = Object.freeze({
  rest_https: 443,
  api_ssl: 8729,
  rest_http: 80,
  api: 8728,
});

// Reading intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '15', '30', '60'];

export const MAX_AWAY_DELAY_MINUTES = 60;

export const DEFAULT_CONFIG = {
  host: '',
  username: '',
  password: '',
  protocol: 'auto',
  allow_self_signed: false,
  poll_interval: '30',
  wan_interfaces: '',
  away_delay: 5,
  presence_arp: true,
  presence_dhcp: false,
  firewall_rules: '',
  allow_commands: false,
  language: 'fr',
};

// Longest comment of a followed firewall rule: RouterOS has no limit, Gladys
// shows the device name in a card.
const MAX_RULE_COMMENT = 60;
export const MAX_RULES = 10;
export const MAX_WAN_INTERFACES = 4;

/**
 * Parse the address typed by the user: a bare IP or host name
 * (`192.0.2.1`, `router.lan`), optionally with a port (`192.0.2.1:8443`), or
 * the URL copied from the browser (`https://192.0.2.1/webfig/`). The scheme
 * and the path are dropped: the protocol is a separate setting.
 * @param {unknown} raw
 * @returns {{ host: string, port: number|null }|null} null when unusable
 */
export function parseAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (!url.hostname || url.username || url.password) {
    return null;
  }
  // `new URL` drops the default port of the scheme: only an explicit one counts.
  const explicitPort = /^[a-z][a-z0-9+.-]*:\/\/[^/]*:(\d+)/i.test(withScheme) ? url.port : '';
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: explicitPort ? Number(explicitPort) : null,
  };
}

/** Split a comma (or semicolon, or line) separated list, trimmed, without blanks nor duplicates. */
export function splitList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const seen = new Set();
  const items = [];
  for (const item of raw.split(/[,;\n]/)) {
    const text = item.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      items.push(text);
    }
  }
  return items;
}

const toBoolean = (value, fallback) => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const typedAddress = text('host');
  const address = parseAddress(typedAddress);

  // A number field may arrive as a string ("5", "2,5") or be left empty.
  const rawDelay =
    typeof source.away_delay === 'string'
      ? Number(source.away_delay.trim().replace(',', '.'))
      : source.away_delay;
  const awayDelay =
    typeof rawDelay === 'number' && Number.isFinite(rawDelay) && rawDelay >= 0
      ? Math.min(MAX_AWAY_DELAY_MINUTES, Math.round(rawDelay))
      : DEFAULT_CONFIG.away_delay;

  return {
    host: address?.host ?? null,
    port: address?.port ?? null,
    invalidHost: typedAddress !== '' && address === null,
    username: text('username'),
    // Passwords are kept as typed: spaces may be part of them.
    password: typeof source.password === 'string' ? source.password : '',
    protocol: pick('protocol', PROTOCOLS),
    allowSelfSigned: toBoolean(source.allow_self_signed, DEFAULT_CONFIG.allow_self_signed),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    wanInterfaces: splitList(source.wan_interfaces).slice(0, MAX_WAN_INTERFACES),
    awayDelayMs: awayDelay * 60_000,
    presenceArp: toBoolean(source.presence_arp, DEFAULT_CONFIG.presence_arp),
    presenceDhcp: toBoolean(source.presence_dhcp, DEFAULT_CONFIG.presence_dhcp),
    rules: splitList(source.firewall_rules)
      .map((comment) => comment.slice(0, MAX_RULE_COMMENT))
      .slice(0, MAX_RULES),
    allowCommands: toBoolean(source.allow_commands, DEFAULT_CONFIG.allow_commands),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
