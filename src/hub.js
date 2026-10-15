// -----------------------------------------------------------------------------
// The MikroTik hub: one session on the router, read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, its scene events fired on transitions, and the
// commands (firewall rules, reboot) of the scene actions and the widgets.
//
// Gladys never polls these devices (should_poll: false): Gladys 5.2 does not
// reliably poll external devices (GladysAssistant/Gladys#3198), and the scene
// events must fire even for a router whose device was not added.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  DEVICE_TYPES,
  FEATURE_KEYS,
  WAN_FEATURES,
  buildClientDevice,
  buildRouterDevice,
  buildRuleDevice,
  clientIds,
  parseDeviceId,
  paramOf,
  routerIds,
  routerName,
  ruleIds,
  slugify,
  wanFeatureKey,
  wanSlugs,
} from './devices.js';
import { PresenceTracker, SOURCES, collectClients } from './presence.js';
import { PROTOCOL_LABELS, openSession } from './routeros/client.js';
import { ERROR_KINDS, RouterOsError } from './routeros/errors.js';
import {
  listMembers,
  normalizeMac,
  parseArp,
  parseHealth,
  parseIdentity,
  parseInterfaces,
  parseLeases,
  parseLicense,
  parseRegistrations,
  parseResource,
  parseRouterboard,
  parseRules,
  parseUpdate,
} from './routeros/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  RULES_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'mikrotik-hub' });

export const WIDGET_KEYS = Object.freeze({
  ROUTER: 'router',
  PRESENCE: 'presence',
  RULES: 'firewall_rules',
});

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UNKNOWN_DEVICE: 'unknown_device_connected',
  WAN_DOWN: 'wan_down',
  WAN_UP: 'wan_up',
});

export const HUB_TIMINGS = {
  // RouterOS keeps the result of its last update check: read it hourly…
  updateReadMs: 60 * 60_000,
  // …and ask it to check MikroTik's servers once a day.
  updateCheckMs: 24 * 60 * 60_000,
  // The WAN interface list and the Wi-Fi packages change rarely.
  structureMs: 10 * 60_000,
  // The discovery list follows the clients seen, at most this often.
  discoveryMs: 5 * 60_000,
  // A refused password is tried again this late, not at every reading: each
  // try is a "login failure" line in the router log.
  authRetryMs: 5 * 60_000,
  // A present client is published again this often: the "Check presence"
  // scene action of Gladys reads the date of the last value received.
  presentRefreshMs: 2 * 60_000,
  // Any other unchanged value is published again this often, so Gladys never
  // shows it as "no recent value".
  heartbeatMs: 6 * 60 * 60_000,
  // A client seen this long ago leaves the discovery list.
  clientMemoryMs: 7 * 24 * 60 * 60_000,
  commandTimeoutMs: 15_000,
  updateCheckTimeoutMs: 30_000,
};

const MAX_STATES_PER_REQUEST = 100;
const MAX_DISCOVERED_CLIENTS = 250;
const MAX_KNOWN_MACS = 5000;
// "Unknown device connected" events per reading at most: a router reset or a
// new guest network never floods the scenes.
const MAX_UNKNOWN_EVENTS = 5;

// The Wi-Fi registration tables, by package (see src/routeros/model.js).
const WIFI_STACKS = ['/interface/wifi', '/interface/wifiwave2', '/interface/wireless', '/caps-man'];

const INTERFACE_PROPS = [
  '.id',
  'name',
  'default-name',
  'type',
  'running',
  'disabled',
  'rx-byte',
  'tx-byte',
  'mac-address',
  'comment',
];
const ARP_PROPS = [
  'address',
  'mac-address',
  'interface',
  'status',
  'complete',
  'dynamic',
  'invalid',
  'disabled',
];
const LEASE_PROPS = [
  'address',
  'active-address',
  'mac-address',
  'active-mac-address',
  'host-name',
  'comment',
  'status',
  'disabled',
  'server',
];
const RULE_PROPS = ['.id', 'comment', 'disabled', 'dynamic', 'chain', 'action'];

// A menu this router does not have (no Wi-Fi package, no IPv6), or that the
// user may not read: skipped, never an outage.
const optional = (err) =>
  err instanceof RouterOsError &&
  (err.kind === ERROR_KINDS.NOT_FOUND || err.kind === ERROR_KINDS.PERMISSION);

const sessionSignature = (config) =>
  JSON.stringify([
    config.host,
    config.port,
    config.username,
    config.password,
    config.protocol,
    config.allowSelfSigned,
  ]);

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export class MikrotikHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} [options.seams] { request, connect, ports } network seams (tests)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, seams = {}, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.seams = seams;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.session = null;
    this.signature = null;
    this.attempts = [];
    this.router = null;
    this.resetReading();
    this.saved = { knownMacs: {}, baselined: false, lastUpdateCheck: 0 };
    /** Last value published per feature external id: { value, at }. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discoveryKey = null;
    this.discoveryAt = 0;
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  /** Forget what was read from the router (a new router, new credentials). */
  resetReading() {
    this.caps = { health: null, stacks: null, ipv6: null, updateCheck: true };
    this.snapshot = {
      reachable: null,
      error: null,
      resource: null,
      temperature: null,
      update: null,
      wan: new Map(),
      rules: new Map(),
      counts: { wifi: 0, leases: 0, arp: 0 },
    };
    this.counters = new Map();
    this.wanDownSince = new Map();
    this.clients = new Map();
    this.lastClients = new Map();
    this.structureAt = 0;
    this.updateReadAt = 0;
    this.retryAfter = 0;
    this.presence = new PresenceTracker({
      awayDelayMs: this.config?.awayDelayMs ?? 0,
      now: () => this.now(),
    });
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (router connected, lost, back, user
  // commands). A problem that repeats every reading is logged once at its own
  // level, then at debug until it clears. LOG_LEVEL=debug shows everything.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      knownMacs:
        saved.knownMacs && typeof saved.knownMacs === 'object' && !Array.isArray(saved.knownMacs)
          ? saved.knownMacs
          : {},
      baselined: saved.baselined === true,
      lastUpdateCheck: typeof saved.lastUpdateCheck === 'number' ? saved.lastUpdateCheck : 0,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transports.clear();
    this.connection = null;
    this.discoveryKey = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = sessionSignature(config);
    if (signature !== this.signature) {
      this.signature = signature;
      await this.closeSession();
      if (previous?.host !== config.host) {
        this.router = null;
      }
      this.resetReading();
      this.warned.clear();
    }
    this.presence.awayDelayMs = config.awayDelayMs;
    // The followed rules, the WAN list or the names may have changed.
    this.structureAt = 0;
    this.discoveryKey = null;
    await this.pollAll();
    this.schedulePoll();
  }

  async closeSession() {
    const session = this.session;
    this.session = null;
    if (session) {
      await session.transport.close().catch(() => {});
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.polling?.catch(() => {});
    await this.closeSession();
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.config?.host) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', `Reading failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading the router ------------------------------------------------------

  /** One reading; concurrent calls share it. */
  pollAll() {
    this.polling ??= this.poll().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** Gladys asks for a refresh (onPoll): a reading covers every device. */
  async pollDevice() {
    if (!this.timersEnabled || !this.pollTimer) {
      await this.pollAll();
    }
  }

  async poll() {
    if (!this.config.host) {
      await this.publishConnectionStatus();
      return;
    }
    if (this.now() < this.retryAfter) {
      return;
    }
    let reading;
    try {
      if (!this.session) {
        await this.connect();
      }
      reading = await this.read();
    } catch (err) {
      if (!(err instanceof RouterOsError)) {
        throw err;
      }
      await this.applyFailure(err);
      return;
    }
    await this.applyReading(reading);
  }

  transportOptions() {
    return {
      protocol: this.config.protocol,
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      insecure: this.config.allowSelfSigned,
      request: this.seams.request,
      connect: this.seams.connect,
      ports: this.seams.ports,
      timeoutMs: this.seams.timeoutMs,
    };
  }

  async connect() {
    let opened;
    try {
      opened = await openSession(this.transportOptions());
    } catch (err) {
      this.attempts = err.attempts ?? [];
      throw err;
    }
    this.attempts = opened.attempts;
    this.session = { transport: opened.transport, protocol: opened.transport.protocol };
    try {
      await this.readIdentity();
    } catch (err) {
      await this.closeSession();
      throw err;
    }
  }

  /** What identifies the router, read once per session. */
  async readIdentity() {
    const t = this.session.transport;
    const soft = async (promise, fallback) => {
      try {
        return await promise;
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
        return fallback;
      }
    };
    const identity = parseIdentity((await t.print('/system/identity'))[0]);
    const board = parseRouterboard((await soft(t.print('/system/routerboard'), []))[0]);
    const license = parseLicense((await soft(t.print('/system/license'), []))[0]);
    const resource = parseResource((await t.print('/system/resource'))[0]);
    let id = board.serial ?? license.id;
    if (!id) {
      const interfaces = parseInterfaces(
        await t.print('/interface', { proplist: ['name', 'type', 'mac-address'] }),
      );
      const ether = interfaces
        .filter((item) => item.type === 'ether' && item.mac)
        .sort((a, b) => a.name.localeCompare(b.name))[0];
      id = ether?.mac ?? `host-${this.config.host}`;
    }
    const routerId = slugify(id) || 'router';
    if (this.router && this.router.id !== routerId) {
      // Another router at the same address: start over.
      this.resetReading();
    }
    this.router = {
      ...(this.router?.id === routerId ? this.router : {}),
      id: routerId,
      identity,
      model: board.model ?? resource.boardName,
      host: this.config.host,
      version: resource.version,
      hasTemperature: this.router?.id === routerId ? this.router.hasTemperature : false,
      wan: this.router?.id === routerId ? this.router.wan : [],
      wanSource: this.router?.id === routerId ? this.router.wanSource : null,
    };
    this.structureAt = 0;
  }

  /** The WAN interfaces and the Wi-Fi packages: at connection, then every few minutes. */
  async readStructure(interfaces) {
    const t = this.session.transport;
    let names = this.config.wanInterfaces;
    let source = 'config';
    if (names.length === 0) {
      let members = [];
      try {
        members = listMembers(await t.print('/interface/list/member'), 'WAN');
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
      }
      const existing = new Set(interfaces.map((item) => item.name));
      names = members.filter((name) => existing.has(name));
      source = 'list';
      if (names.length === 0 && existing.has('ether1')) {
        // The default configuration of RouterOS puts the WAN on ether1.
        names = ['ether1'];
        source = 'fallback';
      }
      names = names.slice(0, 4);
    }
    this.router.wan = wanSlugs(names);
    this.router.wanSource = names.length ? source : null;

    const stacks = [];
    for (const stack of WIFI_STACKS) {
      try {
        await t.print(`${stack}/registration-table`, { proplist: ['mac-address'] });
        stacks.push(stack);
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
      }
    }
    this.caps.stacks = stacks;
    this.structureAt = this.now();
  }

  async read() {
    const t = this.session.transport;
    const now = this.now();
    const resource = parseResource((await t.print('/system/resource'))[0]);

    let temperature = null;
    if (this.caps.health !== false) {
      try {
        temperature = parseHealth(await t.print('/system/health')).temperature;
        this.caps.health = true;
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
        this.caps.health = false;
      }
    }

    const interfaces = parseInterfaces(await t.print('/interface', { proplist: INTERFACE_PROPS }));
    if (this.caps.stacks === null || now - this.structureAt >= this.timings.structureMs) {
      await this.readStructure(interfaces);
    }

    const update = await this.readUpdate();

    const registrations = [];
    for (const stack of this.caps.stacks) {
      try {
        registrations.push(
          ...parseRegistrations(await t.print(`${stack}/registration-table`), stack),
        );
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
      }
    }
    let arp = [];
    if (this.config.presenceArp) {
      try {
        arp = parseArp(await t.print('/ip/arp', { proplist: ARP_PROPS }));
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
      }
    }
    let leases = [];
    try {
      leases = parseLeases(await t.print('/ip/dhcp-server/lease', { proplist: LEASE_PROPS }));
    } catch (err) {
      if (!optional(err)) {
        throw err;
      }
    }
    const rules = await this.readRules();
    return {
      at: now,
      resource,
      temperature,
      interfaces,
      update,
      registrations,
      arp,
      leases,
      rules,
    };
  }

  /** The RouterOS update state: read hourly, checked against MikroTik's servers daily. */
  async readUpdate() {
    const t = this.session.transport;
    const now = this.now();
    if (this.snapshot.update && now - this.updateReadAt < this.timings.updateReadMs) {
      return this.snapshot.update;
    }
    if (this.caps.updateCheck && now - this.saved.lastUpdateCheck >= this.timings.updateCheckMs) {
      this.saved.lastUpdateCheck = now;
      this.store.save(this.saved);
      try {
        await t.run(
          '/system/package/update',
          'check-for-updates',
          {},
          { timeoutMs: this.timings.updateCheckTimeoutMs },
        );
      } catch (err) {
        if (err.kind === ERROR_KINDS.PERMISSION) {
          // A read-only account: keep what RouterOS checked last.
          this.caps.updateCheck = false;
        }
        logger.debug(`Update check not done: ${err.message}`);
        if (err.kind === ERROR_KINDS.UNREACHABLE) {
          throw err;
        }
      }
    }
    try {
      const update = parseUpdate((await t.print('/system/package/update'))[0]);
      this.updateReadAt = now;
      return update;
    } catch (err) {
      if (!optional(err)) {
        throw err;
      }
      this.updateReadAt = now;
      return null;
    }
  }

  /** The firewall rules followed in the configuration, by comment (IPv4 and IPv6 together). */
  async readRules() {
    const result = new Map();
    if (this.config.rules.length === 0) {
      return result;
    }
    const t = this.session.transport;
    const v4 = parseRules(await t.print('/ip/firewall/filter', { proplist: RULE_PROPS }));
    let v6 = [];
    if (this.caps.ipv6 !== false) {
      try {
        v6 = parseRules(await t.print('/ipv6/firewall/filter', { proplist: RULE_PROPS }));
        this.caps.ipv6 = true;
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
        this.caps.ipv6 = false;
      }
    }
    for (const comment of this.config.rules) {
      const match = (rule) => rule.comment === comment && !rule.dynamic;
      const ids4 = v4.filter(match);
      const ids6 = v6.filter(match);
      const all = [...ids4, ...ids6];
      result.set(comment, {
        found: all.length > 0,
        ids4: ids4.map((rule) => rule.id),
        ids6: ids6.map((rule) => rule.id),
        // Several rules under one comment: enabled as soon as one is.
        active: all.length === 0 ? null : all.some((rule) => !rule.disabled) ? 1 : 0,
        count: all.length,
      });
    }
    return result;
  }

  label() {
    return this.router ? `Router ${routerName(this.router)}` : `Router ${this.config.host}`;
  }

  async applyFailure(err) {
    const wasError = this.snapshot.error?.kind;
    const wasReachable = this.snapshot.reachable;
    this.snapshot.error = { kind: err.kind, message: err.message };
    this.snapshot.reachable = false;
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label()}: ${err.message}`);
    } else {
      logger.debug(`${this.label()}: ${err.message} (again)`);
    }
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.PERMISSION) {
      this.retryAfter = this.now() + this.timings.authRetryMs;
    }
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      // A configuration problem: detect the protocol again next time.
      await this.closeSession();
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (wasReachable !== false) {
      this.refreshWidgets();
    }
  }

  async applyReading(reading) {
    const now = reading.at;
    const wasError = this.snapshot.error;
    if (wasError || this.snapshot.reachable !== true) {
      if (wasError) {
        logger.info(`${this.label()}: connection restored`);
      } else {
        logger.info(
          `${this.label()}: connected with ${PROTOCOL_LABELS[this.session.protocol]}` +
            ` (RouterOS ${reading.resource.version ?? '?'})`,
        );
      }
    }
    this.snapshot.error = null;
    this.snapshot.reachable = true;
    this.retryAfter = 0;
    this.router.version = reading.resource.version ?? this.router.version;

    // A sensor seen once stays a feature: the device structure never flaps.
    if (reading.temperature !== null && !this.router.hasTemperature) {
      this.router.hasTemperature = true;
    }
    this.snapshot.resource = reading.resource;
    this.snapshot.temperature = reading.temperature;
    this.snapshot.update = reading.update;

    const widgetsChanged = new Set();
    await this.applyWan(reading, widgetsChanged);
    this.applyRules(reading.rules, widgetsChanged);

    const ignore = new Set(reading.interfaces.map((item) => item.mac).filter(Boolean));
    const clients = collectClients(reading, {
      arp: this.config.presenceArp,
      dhcp: this.config.presenceDhcp,
      ignore,
      wan: new Set(this.router.wan.map(({ name }) => name)),
    });
    this.lastClients = clients;
    for (const client of clients.values()) {
      const known = this.clients.get(client.mac);
      this.clients.set(client.mac, {
        ...known,
        ...Object.fromEntries(Object.entries(client).filter(([, value]) => value !== null)),
        lastSeenAt: client.seen ? now : (known?.lastSeenAt ?? null),
        listedAt: now,
      });
    }
    for (const [mac, client] of this.clients) {
      if (now - (client.listedAt ?? 0) > this.timings.clientMemoryMs) {
        this.clients.delete(mac);
      }
    }
    this.snapshot.counts = {
      wifi: reading.registrations.length,
      leases: reading.leases.length,
      arp: reading.arp.filter((entry) => entry.alive).length,
    };
    if (this.presence.update(this.followedClients(), clients).length > 0) {
      widgetsChanged.add(WIDGET_KEYS.PRESENCE);
    }

    await this.detectUnknownDevices(reading);
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    // The router tiles move at every reading: their TTL is the interval.
    for (const key of widgetsChanged) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  async applyWan(reading, widgetsChanged) {
    const now = reading.at;
    const byName = new Map(reading.interfaces.map((item) => [item.name, item]));
    const wan = new Map();
    for (const { name } of this.router.wan) {
      const item = byName.get(name);
      if (!item) {
        wan.set(name, { found: false, running: null, download: null, upload: null });
        continue;
      }
      // Rates: the counters' growth since the previous reading, in Mbit/s.
      const previous = this.counters.get(name);
      let download = null;
      let upload = null;
      if (previous && now > previous.at && item.rxBytes !== null && item.txBytes !== null) {
        const seconds = (now - previous.at) / 1000;
        const rx = item.rxBytes - previous.rx;
        const tx = item.txBytes - previous.tx;
        // A counter that went back (reboot, reset) gives no rate this time.
        download = rx >= 0 ? round((rx * 8) / seconds / 1e6, 2) : null;
        upload = tx >= 0 ? round((tx * 8) / seconds / 1e6, 2) : null;
      }
      if (item.rxBytes !== null && item.txBytes !== null) {
        this.counters.set(name, { rx: item.rxBytes, tx: item.txBytes, at: now });
      }
      const running = item.running && !item.disabled;
      wan.set(name, { found: true, running, download, upload });

      const before = this.snapshot.wan.get(name)?.running;
      if (before === true && running === false) {
        this.wanDownSince.set(name, now);
        logger.info(`${this.label()}: WAN ${name} is down`);
        widgetsChanged.add(WIDGET_KEYS.ROUTER);
        await this.fire(TRIGGERS.WAN_DOWN, { interface: name });
      } else if (before === false && running === true) {
        const since = this.wanDownSince.get(name) ?? now;
        this.wanDownSince.delete(name);
        const downMinutes = Math.round((now - since) / 60_000);
        logger.info(`${this.label()}: WAN ${name} is back after ${downMinutes} min`);
        widgetsChanged.add(WIDGET_KEYS.ROUTER);
        await this.fire(TRIGGERS.WAN_UP, { interface: name, down_minutes: downMinutes });
      } else if (before === undefined && running === false) {
        this.wanDownSince.set(name, now);
      }
    }
    this.snapshot.wan = wan;
  }

  applyRules(rules, widgetsChanged) {
    for (const [comment, rule] of rules) {
      const before = this.snapshot.rules.get(comment);
      if (before?.active !== rule.active || before?.found !== rule.found) {
        widgetsChanged.add(WIDGET_KEYS.RULES);
      }
    }
    this.snapshot.rules = rules;
  }

  /** Fire "unknown device connected" for a MAC address never seen before. */
  async detectUnknownDevices(reading) {
    const known = this.saved.knownMacs;
    const now = reading.at;
    const ignore = new Set(reading.interfaces.map((item) => item.mac).filter(Boolean));
    // Wi-Fi associations and bound DHCP leases: a device that joined the
    // network. Not ARP: the neighbours of the WAN side are in it too.
    const candidates = new Map();
    for (const registration of reading.registrations) {
      candidates.set(registration.mac, {
        source: SOURCES.WIFI,
        ip: registration.ip,
        interface: registration.interface,
      });
    }
    for (const lease of reading.leases) {
      if (lease.bound && !candidates.has(lease.mac)) {
        candidates.set(lease.mac, { source: SOURCES.DHCP, ip: lease.ip, interface: lease.server });
      }
    }
    let changed = false;
    let fired = 0;
    for (const [mac, candidate] of candidates) {
      if (ignore.has(mac) || mac in known) {
        continue;
      }
      known[mac] = now;
      changed = true;
      if (!this.saved.baselined) {
        continue; // the first reading learns the network as it is
      }
      const client = this.clients.get(mac);
      logger.info(`${this.label()}: new device on the network (${candidate.source})`);
      if (fired < MAX_UNKNOWN_EVENTS) {
        fired += 1;
        await this.fire(TRIGGERS.UNKNOWN_DEVICE, {
          mac,
          ip: candidate.ip ?? client?.ip ?? null,
          host_name: client?.hostName ?? null,
          source: candidate.source,
          interface: candidate.interface ?? null,
        });
      }
    }
    if (!this.saved.baselined) {
      this.saved.baselined = true;
      changed = true;
    }
    const macs = Object.keys(known);
    if (macs.length > MAX_KNOWN_MACS) {
      // The oldest first.
      macs
        .sort((a, b) => known[a] - known[b])
        .slice(0, macs.length - MAX_KNOWN_MACS)
        .forEach((mac) => delete known[mac]);
    }
    if (changed) {
      this.store.save(this.saved);
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Devices -------------------------------------------------------------------

  /** The devices the user added to Gladys, by type. */
  createdDevices(type) {
    return (this.gladys.devices ?? []).filter(
      (device) => parseDeviceId(this.gladys, device.external_id)?.type === type,
    );
  }

  /** MAC addresses of the clients added to Gladys. */
  followedClients() {
    const macs = [];
    for (const device of this.createdDevices(DEVICE_TYPES.CLIENT)) {
      const mac =
        normalizeMac(paramOf(device, 'MAC_ADDRESS')) ??
        normalizeMac(parseDeviceId(this.gladys, device.external_id).id);
      if (mac) {
        macs.push(mac);
      }
    }
    return macs;
  }

  discoveredClients() {
    const followed = new Set(this.followedClients());
    const list = [...this.clients.values()];
    // The followed ones first (always listed), then the most recently seen.
    list.sort(
      (a, b) =>
        Number(followed.has(b.mac)) - Number(followed.has(a.mac)) ||
        (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) ||
        a.mac.localeCompare(b.mac),
    );
    const result = list.slice(0, MAX_DISCOVERED_CLIENTS);
    for (const mac of followed) {
      if (!this.clients.has(mac)) {
        result.push({ mac, ip: null, hostName: null, comment: null });
      }
    }
    return result;
  }

  async publishDevices({ force = false } = {}) {
    const language = this.config.language;
    const devices = [];
    if (this.router) {
      devices.push(buildRouterDevice(this.gladys, this.router, language));
    }
    for (const comment of this.config.rules) {
      devices.push(buildRuleDevice(this.gladys, comment, language));
    }
    const clients = this.discoveredClients();
    devices.push(...clients.map((client) => buildClientDevice(this.gladys, client, language)));

    // The router and the rules publish at once; the client list at most every few minutes.
    const structure = JSON.stringify(devices.slice(0, devices.length - clients.length));
    const members = clients
      .map((client) => client.mac)
      .sort()
      .join(',');
    const key = `${structure}|${members}`;
    if (!force && key === this.discoveryKey) {
      return;
    }
    const structureChanged = !this.discoveryKey?.startsWith(`${structure}|`);
    if (!force && !structureChanged && this.now() - this.discoveryAt < this.timings.discoveryMs) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveryKey = key;
      this.discoveryAt = this.now();
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the router, publish everything again. */
  async rediscover() {
    this.structureAt = 0;
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    for (const feature of device.features ?? []) {
      this.published.delete(feature.external_id);
    }
    const parsed = parseDeviceId(this.gladys, device.external_id);
    if (parsed?.type === DEVICE_TYPES.CLIENT && this.snapshot.reachable) {
      // Follow it at once, from the last reading.
      this.presence.update(this.followedClients(), this.lastClients);
    }
    await this.publishStates();
    if (parsed) {
      const key =
        parsed.type === DEVICE_TYPES.CLIENT
          ? WIDGET_KEYS.PRESENCE
          : parsed.type === DEVICE_TYPES.RULE
            ? WIDGET_KEYS.RULES
            : WIDGET_KEYS.ROUTER;
      this.gladys.requestWidgetRefresh(key);
    }
  }

  // --- Publishing to Gladys ------------------------------------------------------------

  /** Every value to publish: { externalId, state | text, heartbeat }. */
  stateEntries() {
    const entries = [];
    const add = (externalId, value, heartbeat = this.timings.heartbeatMs) => {
      if (value === null || value === undefined) {
        return;
      }
      entries.push({ externalId, value, heartbeat });
    };
    if (this.router && this.snapshot.reachable) {
      const ids = routerIds(this.gladys, this.router.id);
      const { resource, update } = this.snapshot;
      add(ids.feature(FEATURE_KEYS.CPU), resource?.cpuLoad);
      add(ids.feature(FEATURE_KEYS.MEMORY), resource?.memoryUsage);
      if (this.router.hasTemperature && this.snapshot.temperature !== null) {
        add(ids.feature(FEATURE_KEYS.TEMPERATURE), round(this.snapshot.temperature, 1));
      }
      if (resource?.uptimeSeconds !== null && resource?.uptimeSeconds !== undefined) {
        add(ids.feature(FEATURE_KEYS.UPTIME), Math.floor(resource.uptimeSeconds / 3600));
      }
      if (resource?.version) {
        add(ids.feature(FEATURE_KEYS.VERSION), { text: resource.version });
      }
      if (update) {
        add(ids.feature(FEATURE_KEYS.UPDATE), update.available ? 1 : 0);
      }
      for (const { name, slug } of this.router.wan) {
        const wan = this.snapshot.wan.get(name);
        if (!wan?.found) {
          continue;
        }
        add(ids.feature(wanFeatureKey(slug, WAN_FEATURES.DOWNLOAD)), wan.download);
        add(ids.feature(wanFeatureKey(slug, WAN_FEATURES.UPLOAD)), wan.upload);
        add(ids.feature(wanFeatureKey(slug, WAN_FEATURES.LINK)), wan.running ? 1 : 0);
      }
    }
    if (this.snapshot.reachable) {
      for (const [comment, rule] of this.snapshot.rules) {
        add(ruleIds(this.gladys, comment).feature(FEATURE_KEYS.RULE_ACTIVE), rule.active);
      }
    }
    for (const mac of this.followedClients()) {
      const present = this.presence.presence(mac);
      add(
        clientIds(this.gladys, mac).feature(FEATURE_KEYS.PRESENCE),
        present,
        present === 1 ? this.timings.presentRefreshMs : this.timings.heartbeatMs,
      );
    }
    return entries;
  }

  /** Publish the values that changed (or whose heartbeat is due), for the added devices only. */
  async publishStates() {
    const created = new Set(
      (this.gladys.devices ?? []).flatMap((device) =>
        (device.features ?? []).map((feature) => feature.external_id),
      ),
    );
    const now = this.now();
    const due = this.stateEntries().filter(({ externalId, value, heartbeat }) => {
      if (!created.has(externalId)) {
        return false; // Gladys would drop it, and count it in its quota
      }
      const last = this.published.get(externalId);
      const key = typeof value === 'object' ? `text:${value.text}` : value;
      return !last || last.key !== key || now - last.at >= heartbeat;
    });
    for (let at = 0; at < due.length; at += MAX_STATES_PER_REQUEST) {
      const batch = due.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(
          batch.map(({ externalId, value }) =>
            typeof value === 'object'
              ? { device_feature_external_id: externalId, text: value.text }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, {
            key: typeof value === 'object' ? `text:${value.text}` : value,
            at: now,
          });
        }
        this.resolved('states');
      } catch (err) {
        this.problem('states', `States refused by Gladys: ${err.message}`);
      }
    }
  }

  async publishTransports() {
    if (this.snapshot.reachable === null) {
      return;
    }
    const transport = this.snapshot.reachable
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
    const ids = [
      ...(this.router ? [routerIds(this.gladys, this.router.id).device] : []),
      ...this.config.rules.map((comment) => ruleIds(this.gladys, comment).device),
    ];
    const entries = ids
      .filter((id) => this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.host) {
      return {
        connected: false,
        message: this.config.invalidHost ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noHost,
      };
    }
    if (this.snapshot.error) {
      return { connected: false, message: ERROR_TEXT[this.snapshot.error.kind] };
    }
    if (this.snapshot.reachable) {
      return { connected: true };
    }
    return { connected: false, message: CONNECTION_TEXT.connecting };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidgets() {
    for (const key of Object.values(WIDGET_KEYS)) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  text(table) {
    return pick(table, this.config?.language);
  }

  assertCommands() {
    if (!this.config?.allowCommands) {
      throw new Error(this.text(ACTION_TEXT.disabled));
    }
  }

  /** A session for a command: the current one, or a new one. */
  async commandSession() {
    if (!this.config.host) {
      throw new Error(this.text(CONNECTION_TEXT.noHost));
    }
    if (!this.session) {
      await this.pollAll();
    }
    if (!this.session) {
      const kind = this.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE;
      throw new Error(this.text(ERROR_TEXT[kind]));
    }
    return this.session.transport;
  }

  commandError(err) {
    if (err instanceof RouterOsError && err.kind === ERROR_KINDS.PERMISSION) {
      return new Error(this.text(ACTION_TEXT.permission));
    }
    if (err instanceof RouterOsError) {
      return new Error(this.text(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.PROTOCOL]));
    }
    return err;
  }

  /** The comment of a rule device, or an error the user can read. */
  ruleOf(deviceExternalId) {
    const parsed = parseDeviceId(this.gladys, deviceExternalId);
    const comment =
      parsed?.type === DEVICE_TYPES.RULE
        ? this.config.rules.find((candidate) => slugify(candidate) === parsed.id)
        : undefined;
    if (!comment) {
      throw new Error(this.text(ACTION_TEXT.unknownRule));
    }
    return comment;
  }

  /**
   * Enable or disable a followed firewall rule (IPv4 and IPv6 rules of that
   * comment together). The only configuration change the integration makes.
   * @returns {Promise<{ active: boolean, rules: number }>}
   */
  async setRule(deviceExternalId, active) {
    this.assertCommands();
    const comment = this.ruleOf(deviceExternalId);
    const t = await this.commandSession();
    let rule;
    try {
      rule = (await this.readRules()).get(comment);
      if (!rule?.found) {
        throw new Error(this.text(ACTION_TEXT.ruleNotFound));
      }
      const disabled = active ? 'no' : 'yes';
      for (const id of rule.ids4) {
        await t.run('/ip/firewall/filter', 'set', { '.id': id, disabled });
      }
      for (const id of rule.ids6) {
        await t.run('/ipv6/firewall/filter', 'set', { '.id': id, disabled });
      }
    } catch (err) {
      logger.warn(`Firewall rule "${comment}": command failed: ${err.message}`);
      throw this.commandError(err);
    }
    logger.info(
      `Firewall rule "${comment}" ${active ? 'enabled' : 'disabled'} (${rule.count} rule(s))`,
    );
    try {
      const rules = await this.readRules();
      const changed = new Set();
      this.applyRules(rules, changed);
      await this.publishStates();
      for (const key of changed) {
        this.gladys.requestWidgetRefresh(key);
      }
    } catch (err) {
      logger.debug(`Rules not read again: ${err.message}`);
    }
    return { active, rules: rule.count };
  }

  /** Restart the router. */
  async reboot() {
    this.assertCommands();
    const t = await this.commandSession();
    try {
      await t.run('/system', 'reboot', {}, { timeoutMs: this.timings.commandTimeoutMs });
    } catch (err) {
      // The router may hang up before answering: it is restarting.
      if (!(err instanceof RouterOsError && err.kind === ERROR_KINDS.UNREACHABLE)) {
        logger.warn(`Reboot refused: ${err.message}`);
        throw this.commandError(err);
      }
    }
    logger.info(`${this.label()}: reboot requested`);
    await this.closeSession();
    return { rebooting: true };
  }

  // --- Reports ---------------------------------------------------------------------------

  /** "Test the connection": detect the protocol again, then read everything. */
  async testConnection() {
    await this.polling?.catch(() => {});
    await this.closeSession();
    this.retryAfter = 0;
    this.structureAt = 0;
    await this.pollAll();
    const message = {};
    for (const language of Object.keys(REPORT_TEXT)) {
      message[language] = this.report(language);
    }
    return message;
  }

  report(language) {
    const text = REPORT_TEXT[language];
    if (!this.config.host) {
      return pick(this.connectionStatus().message, language);
    }
    const lines = [];
    const tlsRefused = this.attempts.some((attempt) => attempt.error?.kind === ERROR_KINDS.TLS);
    if (!this.snapshot.reachable) {
      lines.push(pick(ERROR_TEXT[this.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE], language));
      for (const attempt of this.attempts) {
        if (attempt.error) {
          lines.push(
            labelled(
              PROTOCOL_LABELS[attempt.protocol],
              pick(ERROR_TEXT[attempt.error.kind] ?? ERROR_TEXT.protocol, language),
              language,
            ),
          );
        }
      }
    } else {
      lines.push(
        text.connected(
          PROTOCOL_LABELS[this.session?.protocol] ?? '?',
          routerName(this.router),
          this.router.version ?? '?',
        ),
      );
      const wan = this.router.wan.map(({ name }) => {
        const state = this.snapshot.wan.get(name);
        return `${name} (${!state?.found ? text.missing : state.running ? text.up : text.down})`;
      });
      lines.push(
        wan.length
          ? `${text.wan}${language === 'fr' ? ' : ' : ': '}${wan.join(', ')} · ${text.wanSource[this.router.wanSource]}`
          : text.noWan,
      );
      lines.push(text.clients(this.snapshot.counts));
      for (const comment of this.config.rules) {
        const rule = this.snapshot.rules.get(comment);
        lines.push(
          labelled(
            comment,
            !rule?.found ? text.ruleMissing : rule.active ? text.ruleOn : text.ruleOff,
            language,
          ),
        );
      }
      lines.push(this.config.allowCommands ? text.commandsOn : text.commandsOff);
      if (this.session && ['rest_http', 'api'].includes(this.session.protocol)) {
        lines.push(tlsRefused ? text.tlsHint : text.plainHint);
      }
    }
    return lines.join('\n').slice(0, 2000);
  }

  /** "List the firewall rules": the commented rules, to copy into the configuration. */
  async listRules() {
    const t = await this.commandSession();
    let v4;
    let v6 = [];
    try {
      v4 = parseRules(await t.print('/ip/firewall/filter', { proplist: RULE_PROPS }));
      try {
        v6 = parseRules(await t.print('/ipv6/firewall/filter', { proplist: RULE_PROPS }));
      } catch (err) {
        if (!optional(err)) {
          throw err;
        }
      }
    } catch (err) {
      throw this.commandError(err);
    }
    const byComment = new Map();
    for (const [family, rules] of [
      ['IPv4', v4],
      ['IPv6', v6],
    ]) {
      for (const rule of rules) {
        if (!rule.comment || rule.dynamic) {
          continue;
        }
        const entry = byComment.get(rule.comment) ?? { families: new Set(), active: false, rule };
        entry.families.add(family);
        entry.active ||= !rule.disabled;
        byComment.set(rule.comment, entry);
      }
    }
    const message = {};
    for (const [language, text] of Object.entries(RULES_TEXT)) {
      if (byComment.size === 0) {
        message[language] = text.none;
        continue;
      }
      const lines = [...byComment.entries()].slice(0, 30).map(([comment, entry]) => {
        const followed = this.config.rules.includes(comment) ? ' ✓' : '';
        return `${comment}${followed} — ${entry.rule.chain ?? '?'}/${entry.rule.action ?? '?'}, ${[...entry.families].join('+')}, ${entry.active ? text.on : text.off}`;
      });
      message[language] = [text.intro, ...lines].join('\n').slice(0, 2000);
    }
    return message;
  }
}
