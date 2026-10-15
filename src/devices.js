// -----------------------------------------------------------------------------
// The Gladys devices of the integration (category/type couples of the core
// table, see test/gladys-rules.test.js):
//
//   - the router: CPU and memory load, temperature (when the router has a
//     sensor), uptime, RouterOS version and update available, and for each
//     WAN interface its download and upload rates and its link state;
//   - one presence sensor per network client the user adds from the
//     Discovery tab (presence-sensor/binary: 1 present, 0 away once the
//     departure delay has passed);
//   - one device per firewall rule followed in the configuration (its comment):
//     input/binary, 1 when the rule is enabled. Read-only on purpose: the
//     commands go through the scene actions and the widget, never through a
//     switch a voice assistant could flip.
//
// Identities (external ids, permanent):
//   - the router: its serial number (RouterBOARD), else its license software
//     id (x86) or system id (CHR), else the MAC address of its first ethernet
//     port. Never the address typed in the configuration;
//   - a client: its MAC address;
//   - a rule: its comment, made an identifier (`rule:block-kids-tablet`).
// Feature keys are permanent too; a WAN feature carries the interface name.
//
// Every device is published with should_poll: false: the integration reads
// the router on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPES = Object.freeze({
  ROUTER: 'router',
  CLIENT: 'client',
  RULE: 'rule',
});

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  CPU: 'cpu_load',
  MEMORY: 'memory_usage',
  TEMPERATURE: 'temperature',
  UPTIME: 'uptime',
  VERSION: 'routeros_version',
  UPDATE: 'update_available',
  PRESENCE: 'presence',
  RULE_ACTIVE: 'active',
});

export const WAN_FEATURES = Object.freeze({
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  LINK: 'link',
});

export const wanFeatureKey = (slug, what) => `wan_${slug}_${what}`;

// Feature and device names, in the language chosen in the configuration
// (Gladys does not tell a device integration the user's language). Frozen at
// creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.CPU]: 'CPU load',
    [FEATURE_KEYS.MEMORY]: 'Memory used',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperature',
    [FEATURE_KEYS.UPTIME]: 'Uptime',
    [FEATURE_KEYS.VERSION]: 'RouterOS version',
    [FEATURE_KEYS.UPDATE]: 'RouterOS update available',
    [FEATURE_KEYS.PRESENCE]: 'Presence',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Rule enabled',
    download: (name) => `Download ${name}`,
    upload: (name) => `Upload ${name}`,
    link: (name) => `WAN link ${name}`,
    client: (mac) => `Device ${mac}`,
    rule: (comment) => `Rule "${comment}"`,
  },
  fr: {
    [FEATURE_KEYS.CPU]: 'Charge du processeur',
    [FEATURE_KEYS.MEMORY]: 'Mémoire utilisée',
    [FEATURE_KEYS.TEMPERATURE]: 'Température',
    [FEATURE_KEYS.UPTIME]: 'Temps de fonctionnement',
    [FEATURE_KEYS.VERSION]: 'Version de RouterOS',
    [FEATURE_KEYS.UPDATE]: 'Mise à jour RouterOS disponible',
    [FEATURE_KEYS.PRESENCE]: 'Présence',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Règle activée',
    download: (name) => `Débit descendant ${name}`,
    upload: (name) => `Débit montant ${name}`,
    link: (name) => `Lien WAN ${name}`,
    client: (mac) => `Appareil ${mac}`,
    rule: (comment) => `Règle « ${comment} »`,
  },
  de: {
    [FEATURE_KEYS.CPU]: 'CPU-Auslastung',
    [FEATURE_KEYS.MEMORY]: 'Belegter Speicher',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatur',
    [FEATURE_KEYS.UPTIME]: 'Betriebszeit',
    [FEATURE_KEYS.VERSION]: 'RouterOS-Version',
    [FEATURE_KEYS.UPDATE]: 'RouterOS-Update verfügbar',
    [FEATURE_KEYS.PRESENCE]: 'Anwesenheit',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Regel aktiviert',
    download: (name) => `Download ${name}`,
    upload: (name) => `Upload ${name}`,
    link: (name) => `WAN-Verbindung ${name}`,
    client: (mac) => `Gerät ${mac}`,
    rule: (comment) => `Regel „${comment}“`,
  },
  es: {
    [FEATURE_KEYS.CPU]: 'Carga del procesador',
    [FEATURE_KEYS.MEMORY]: 'Memoria usada',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatura',
    [FEATURE_KEYS.UPTIME]: 'Tiempo de funcionamiento',
    [FEATURE_KEYS.VERSION]: 'Versión de RouterOS',
    [FEATURE_KEYS.UPDATE]: 'Actualización de RouterOS disponible',
    [FEATURE_KEYS.PRESENCE]: 'Presencia',
    [FEATURE_KEYS.RULE_ACTIVE]: 'Regla activada',
    download: (name) => `Descarga ${name}`,
    upload: (name) => `Subida ${name}`,
    link: (name) => `Enlace WAN ${name}`,
    client: (mac) => `Dispositivo ${mac}`,
    rule: (comment) => `Regla «${comment}»`,
  },
};

export const names = (language) => NAMES[language] ?? NAMES.en;

// Display bounds (the core never applies them on write).
const MAX_RATE_MBPS = 100_000;
const MAX_UPTIME_HOURS = 100_000;

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});

/** A text usable in an external id: lowercase letters, digits and dashes. */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** The identifier of a client: its MAC address, lowercase. */
export const clientPlatformId = (mac) => mac.toLowerCase();

export const routerIds = (gladys, routerId) => gladys.externalIds(DEVICE_TYPES.ROUTER, routerId);
export const clientIds = (gladys, mac) =>
  gladys.externalIds(DEVICE_TYPES.CLIENT, clientPlatformId(mac));
export const ruleIds = (gladys, comment) => gladys.externalIds(DEVICE_TYPES.RULE, slugify(comment));

/**
 * What kind of device an external id is, and its platform id.
 * @returns {{ type: string, id: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (externalId.startsWith(prefix) && externalId.length > prefix.length) {
      return { type, id: externalId.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * The WAN interfaces as features: a name, and a key part unique on the device.
 * @param {string[]} interfaceNames
 * @returns {Array<{ name: string, slug: string }>}
 */
export function wanSlugs(interfaceNames) {
  const seen = new Set();
  const result = [];
  for (const name of interfaceNames) {
    const slug = slugify(name);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      result.push({ name, slug });
    }
  }
  return result;
}

/** The name of the router device: its identity, with the model when the identity is the factory one. */
export function routerName(router) {
  const identity = router.identity ?? 'MikroTik';
  if (identity === 'MikroTik' && router.model) {
    return `MikroTik ${router.model}`;
  }
  return identity;
}

/**
 * The features of the router device.
 * @param {object} gladys
 * @param {object} router { id, hasTemperature, wan: [{ name, slug }] }
 * @param {string} language
 */
export function routerFeatures(gladys, router, language) {
  const ids = routerIds(gladys, router.id);
  const n = names(language);
  const feature = (key, name, definition) => ({
    ...definition,
    name,
    external_id: ids.feature(key),
  });
  const features = [
    feature(
      FEATURE_KEYS.CPU,
      n[FEATURE_KEYS.CPU],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    ),
    feature(
      FEATURE_KEYS.MEMORY,
      n[FEATURE_KEYS.MEMORY],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    ),
  ];
  if (router.hasTemperature) {
    features.push(
      feature(
        FEATURE_KEYS.TEMPERATURE,
        n[FEATURE_KEYS.TEMPERATURE],
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
          unit: DEVICE_FEATURE_UNITS.CELSIUS,
          min: -40,
          max: 125,
        }),
      ),
    );
  }
  features.push(
    feature(
      FEATURE_KEYS.UPTIME,
      n[FEATURE_KEYS.UPTIME],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.HOURS,
        min: 0,
        max: MAX_UPTIME_HOURS,
        // A counter that only grows: its history says nothing a reboot would not.
        keep_history: false,
      }),
    ),
    feature(
      FEATURE_KEYS.VERSION,
      n[FEATURE_KEYS.VERSION],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
      }),
    ),
    feature(
      FEATURE_KEYS.UPDATE,
      n[FEATURE_KEYS.UPDATE],
      sensor({
        category: DEVICE_FEATURE_CATEGORIES.INPUT,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
      }),
    ),
  );
  for (const { name, slug } of router.wan) {
    const rate = (what, label) =>
      feature(
        wanFeatureKey(slug, what),
        label,
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.DATARATE,
          type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
          unit: DEVICE_FEATURE_UNITS.MEGABITS_PER_SECOND,
          min: 0,
          max: MAX_RATE_MBPS,
        }),
      );
    features.push(
      rate(WAN_FEATURES.DOWNLOAD, n.download(name)),
      rate(WAN_FEATURES.UPLOAD, n.upload(name)),
      feature(
        wanFeatureKey(slug, WAN_FEATURES.LINK),
        n.link(name),
        sensor({
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      ),
    );
  }
  return features;
}

/**
 * The discovery payload of the router.
 * @param {object} router { id, identity, model, host, hasTemperature, wan }
 */
export function buildRouterDevice(gladys, router, language) {
  return {
    name: routerName(router),
    external_id: routerIds(gladys, router.id).device,
    model: router.model ?? undefined,
    should_poll: false,
    params: [
      { name: 'ROUTER_ADDRESS', value: router.host },
      ...(router.model ? [{ name: 'MODEL', value: router.model }] : []),
    ],
    features: routerFeatures(gladys, router, language),
  };
}

/** The name proposed for a client: its comment in RouterOS, its host name, else its MAC. */
export function clientName(client, language) {
  return client.comment ?? client.hostName ?? names(language).client(client.mac);
}

/**
 * The discovery payload of a network client.
 * @param {object} client { mac, ip, hostName, comment }
 */
export function buildClientDevice(gladys, client, language) {
  const ids = clientIds(gladys, client.mac);
  return {
    name: clientName(client, language).slice(0, 60),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'MAC_ADDRESS', value: client.mac },
      ...(client.ip ? [{ name: 'IP_ADDRESS', value: client.ip }] : []),
    ],
    features: [
      {
        name: names(language)[FEATURE_KEYS.PRESENCE],
        external_id: ids.feature(FEATURE_KEYS.PRESENCE),
        ...sensor({
          category: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      },
    ],
  };
}

/** The discovery payload of a followed firewall rule. */
export function buildRuleDevice(gladys, comment, language) {
  const ids = ruleIds(gladys, comment);
  return {
    name: names(language).rule(comment),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'RULE_COMMENT', value: comment }],
    features: [
      {
        name: names(language)[FEATURE_KEYS.RULE_ACTIVE],
        external_id: ids.feature(FEATURE_KEYS.RULE_ACTIVE),
        ...sensor({
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
        }),
      },
    ],
  };
}

/** The value of a param of a device received from Gladys. */
export const paramOf = (device, name) =>
  (device?.params ?? []).find((param) => param.name === name)?.value ?? null;
