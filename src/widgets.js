// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+):
//
//   - `router`: the health of the router (CPU, memory, temperature) and the
//     rates of its WAN, the state of each WAN link, the uptime, the RouterOS
//     version and the update available; a Reboot button (with confirmation)
//     when the commands are allowed;
//   - `presence`: the devices followed as presence sensors, present first;
//   - `firewall_rules`: the followed firewall rules, with one button each to
//     enable or disable it (with confirmation) when the commands are allowed —
//     the parental control from the wall tablet.
//
// Every figure is sent as a value, not bound to a device feature: the widgets
// work before the devices are added to Gladys. Budget of the core: 8
// components, 6 tiles, 2 texts, 1 status list (10 rows), 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, clientIds, parseDeviceId, routerName, ruleIds } from './devices.js';
import { WIDGET_KEYS } from './hub.js';
import { ERROR_KINDS } from './routeros/errors.js';
import { ERROR_TEXT, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  REBOOT: 'reboot',
  RULE: (index) => `rule_${index + 1}`,
});
const MAX_RULE_BUTTONS = 4;
const MAX_ROWS = 10;
const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  noHost: {
    en: 'Enter the address of your MikroTik router in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre routeur MikroTik dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines MikroTik-Routers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su router MikroTik en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first reading of the router…',
    fr: 'En attente de la première lecture du routeur…',
    de: 'Warte auf die erste Abfrage des Routers…',
    es: 'Esperando la primera lectura del router…',
  },
  noClient: {
    en: 'No device followed: add them from the Discovery tab of the integration.',
    fr: "Aucun appareil suivi : ajoutez-les depuis l'onglet Découverte de l'intégration.",
    de: 'Kein Gerät verfolgt: Füge sie im Tab „Entdecken“ der Integration hinzu.',
    es: 'Ningún dispositivo seguido: añádalos desde la pestaña Descubrir de la integración.',
  },
  nobody: {
    en: 'No followed device is present.',
    fr: "Aucun appareil suivi n'est présent.",
    de: 'Kein verfolgtes Gerät ist anwesend.',
    es: 'Ningún dispositivo seguido está presente.',
  },
  noRule: {
    en: 'No firewall rule followed: enter their comments in the configuration.',
    fr: 'Aucune règle de pare-feu suivie : saisissez leurs commentaires dans la configuration.',
    de: 'Keine Firewall-Regel verfolgt: Gib ihre Kommentare in der Konfiguration ein.',
    es: 'Ninguna regla de cortafuegos seguida: introduzca sus comentarios en la configuración.',
  },
  readOnly: {
    en: 'Commands disabled in the configuration.',
    fr: 'Commandes désactivées dans la configuration.',
    de: 'Befehle in der Konfiguration deaktiviert.',
    es: 'Órdenes desactivadas en la configuración.',
  },
  more: {
    en: 'more devices',
    fr: 'autres appareils',
    de: 'weitere Geräte',
    es: 'dispositivos más',
  },
  cpu: { en: 'CPU', fr: 'Processeur', de: 'CPU', es: 'Procesador' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  download: { en: 'Download', fr: 'Descendant', de: 'Download', es: 'Descarga' },
  upload: { en: 'Upload', fr: 'Montant', de: 'Upload', es: 'Subida' },
  present: { en: 'Present', fr: 'Présents', de: 'Anwesend', es: 'Presentes' },
  uptime: {
    en: 'Uptime',
    fr: 'Allumé depuis',
    de: 'Betriebszeit',
    es: 'Encendido desde hace',
  },
  version: { en: 'RouterOS', fr: 'RouterOS', de: 'RouterOS', es: 'RouterOS' },
  update: {
    en: 'Update available',
    fr: 'Mise à jour disponible',
    de: 'Update verfügbar',
    es: 'Actualización disponible',
  },
  upToDate: { en: 'up to date', fr: 'à jour', de: 'aktuell', es: 'actualizado' },
  linkUp: { en: 'Up', fr: 'Actif', de: 'Aktiv', es: 'Activo' },
  linkDown: { en: 'Down', fr: 'Coupé', de: 'Getrennt', es: 'Cortado' },
  missing: { en: 'Not found', fr: 'Introuvable', de: 'Nicht gefunden', es: 'No encontrado' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  isPresent: { en: 'Present', fr: 'Présent', de: 'Anwesend', es: 'Presente' },
  isAway: { en: 'Away', fr: 'Absent', de: 'Abwesend', es: 'Ausente' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  ruleOn: { en: 'Enabled', fr: 'Activée', de: 'Aktiviert', es: 'Activada' },
  ruleOff: { en: 'Disabled', fr: 'Désactivée', de: 'Deaktiviert', es: 'Desactivada' },
  reboot: { en: 'Reboot', fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar' },
};

// Short time units, for "Away · 2 h" and the uptime.
const UNITS = {
  en: { m: 'min', h: 'h', d: 'd' },
  fr: { m: 'min', h: 'h', d: 'j' },
  de: { m: 'min', h: 'h', d: 'T' },
  es: { m: 'min', h: 'h', d: 'd' },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    reboot: 'The router is restarting.',
    enabled: (comment) => `Rule "${comment}" enabled.`,
    disabled: (comment) => `Rule "${comment}" disabled.`,
  },
  fr: {
    reboot: 'Le routeur redémarre.',
    enabled: (comment) => `Règle « ${comment} » activée.`,
    disabled: (comment) => `Règle « ${comment} » désactivée.`,
  },
  de: {
    reboot: 'Der Router startet neu.',
    enabled: (comment) => `Regel „${comment}“ aktiviert.`,
    disabled: (comment) => `Regel „${comment}“ deaktiviert.`,
  },
  es: {
    reboot: 'El router se está reiniciando.',
    enabled: (comment) => `Regla «${comment}» activada.`,
    disabled: (comment) => `Regla «${comment}» desactivada.`,
  },
};

const t = (text, language) => pick(text, language);
export const fit = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** "2 h", "3 j 4 h", "12 min". */
export function shortDuration(seconds, language) {
  const units = UNITS[language] ?? UNITS.en;
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) {
    return `${minutes} ${units.m}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${units.h}`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} ${units.d} ${rest} ${units.h}` : `${days} ${units.d}`;
}

const rate = (value) => (value === null || value === undefined ? '–' : value.toFixed(1));

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const ttlOf = (hub) => Math.max(10, Math.min(3600, Math.round(hub.config.pollIntervalMs / 1000)));

/** The row of a router that cannot be read. */
function errorRow(hub, language) {
  const kind = hub.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE;
  return {
    label: fit(hub.router ? routerName(hub.router) : hub.config.host, 40),
    icon: 'alert-triangle',
    value: t(kind === ERROR_KINDS.UNREACHABLE ? TEXT.unreachable : TEXT.error, language),
    color: WIDGET_COLORS.DANGER,
  };
}

// --- router ------------------------------------------------------------------------

async function getRouter(hub, { language = 'en' }) {
  if (!hub.config.host) {
    return message(TEXT.noHost, language);
  }
  if (!hub.router || hub.snapshot.reachable === null) {
    return message(TEXT.waiting, language, 30);
  }
  const components = [];
  if (!hub.snapshot.reachable) {
    components.push(
      {
        type: 'text',
        variant: 'body',
        text: fit(
          pick(ERROR_TEXT[hub.snapshot.error?.kind ?? ERROR_KINDS.UNREACHABLE], language),
          300,
        ),
      },
      { type: 'status', items: [errorRow(hub, language)] },
    );
    return { ttl_seconds: ttlOf(hub), components };
  }

  const { resource, temperature, update } = hub.snapshot;
  components.push({
    type: 'value',
    value: resource?.cpuLoad ?? '–',
    unit: '%',
    label: t(TEXT.cpu, language),
    icon: 'cpu',
  });
  components.push({
    type: 'value',
    value: resource?.memoryUsage ?? '–',
    unit: '%',
    label: t(TEXT.memory, language),
    icon: 'database',
  });
  if (hub.router.hasTemperature && temperature !== null) {
    components.push({
      type: 'value',
      value: Math.round(temperature * 10) / 10,
      unit: '°C',
      label: t(TEXT.temperature, language),
      icon: 'thermometer',
    });
  }
  const [firstWan] = hub.router.wan;
  const first = firstWan ? hub.snapshot.wan.get(firstWan.name) : null;
  if (first?.found) {
    components.push(
      {
        type: 'value',
        value: rate(first.download),
        unit: 'Mbit/s',
        label: t(TEXT.download, language),
        icon: 'arrow-down',
        color: WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        value: rate(first.upload),
        unit: 'Mbit/s',
        label: t(TEXT.upload, language),
        icon: 'arrow-up',
        color: WIDGET_COLORS.INFO,
      },
    );
  }

  const items = [];
  for (const { name } of hub.router.wan) {
    const wan = hub.snapshot.wan.get(name);
    const label = fit(`WAN ${name}`, 40);
    if (!wan?.found) {
      items.push({
        label,
        icon: 'help-circle',
        value: t(TEXT.missing, language),
        color: WIDGET_COLORS.WARNING,
      });
    } else if (!wan.running) {
      items.push({
        label,
        icon: 'x-circle',
        value: t(TEXT.linkDown, language),
        color: WIDGET_COLORS.DANGER,
      });
    } else {
      // The first WAN has its tiles; the others show their rates here.
      const value =
        name === firstWan.name
          ? t(TEXT.linkUp, language)
          : `↓ ${rate(wan.download)} · ↑ ${rate(wan.upload)} Mbit/s`;
      items.push({ label, icon: 'globe', value: fit(value, 40), color: WIDGET_COLORS.SUCCESS });
    }
  }
  if (resource?.uptimeSeconds !== null && resource?.uptimeSeconds !== undefined) {
    items.push({
      label: t(TEXT.uptime, language),
      icon: 'clock',
      value: shortDuration(resource.uptimeSeconds, language),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (update?.available && update.latest) {
    items.push({
      label: t(TEXT.update, language),
      icon: 'download',
      value: fit(`${update.installed ?? '?'} → ${update.latest}`, 40),
      color: WIDGET_COLORS.WARNING,
    });
  } else if (resource?.version) {
    items.push({
      label: t(TEXT.version, language),
      icon: 'package',
      value: fit(
        update ? `${resource.version} · ${t(TEXT.upToDate, language)}` : resource.version,
        40,
      ),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (items.length) {
    components.push({ type: 'status', items: items.slice(0, MAX_ROWS) });
  }
  if (hub.config.allowCommands) {
    components.push({
      type: 'button',
      label: t(TEXT.reboot, language),
      icon: 'refresh-cw',
      style: 'danger',
      action: { key: ACTIONS.REBOOT, confirm: true },
    });
  }
  return { ttl_seconds: ttlOf(hub), components };
}

async function actRouter(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REBOOT) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.reboot();
  return {
    message: Object.fromEntries(Object.entries(DONE_TEXT).map(([l, text]) => [l, text.reboot])),
  };
}

// --- presence ----------------------------------------------------------------------

/** The followed clients, with their Gladys name and their presence. */
export function presenceRows(hub) {
  const now = hub.now();
  return hub
    .createdDevices(DEVICE_TYPES.CLIENT)
    .map((device) => {
      const mac = parseDeviceId(hub.gladys, device.external_id).id.toUpperCase();
      const record = hub.presence.get(mac);
      return {
        name: device.name || mac,
        present: record?.present ?? null,
        // Away since it was last seen (nothing when never seen since the start).
        since: record?.present === 0 ? (record.lastSeen ?? null) : null,
        now,
        externalId: clientIds(hub.gladys, mac).device,
      };
    })
    .sort(
      (a, b) =>
        (b.present === 1) - (a.present === 1) ||
        (b.present === 0) - (a.present === 0) ||
        a.name.localeCompare(b.name),
    );
}

async function getPresence(hub, { settings = {}, language = 'en' }) {
  if (!hub.config.host) {
    return message(TEXT.noHost, language);
  }
  const all = presenceRows(hub);
  if (all.length === 0) {
    return message(TEXT.noClient, language);
  }
  const rows = settings.show === 'present' ? all.filter((row) => row.present === 1) : all;
  const presentCount = all.filter((row) => row.present === 1).length;
  const components = [
    {
      type: 'value',
      value: presentCount,
      unit: `/ ${all.length}`.slice(0, 6),
      label: t(TEXT.present, language),
      icon: 'users',
      color: presentCount ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (!hub.snapshot.reachable && hub.snapshot.reachable !== null) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(
        `${t(TEXT.unreachable, language)} · ${hub.router ? routerName(hub.router) : hub.config.host}`,
        80,
      ),
    });
  }
  if (rows.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nobody, language) });
    return { ttl_seconds: 60, components };
  }
  components.push({
    type: 'status',
    items: rows.slice(0, MAX_ROWS).map((row) => {
      if (row.present === 1) {
        return {
          label: fit(row.name, 40),
          icon: 'user-check',
          value: t(TEXT.isPresent, language),
          color: WIDGET_COLORS.SUCCESS,
        };
      }
      if (row.present === 0) {
        const ago = row.since ? ` · ${shortDuration((row.now - row.since) / 1000, language)}` : '';
        return {
          label: fit(row.name, 40),
          icon: 'user-x',
          value: fit(`${t(TEXT.isAway, language)}${ago}`, 40),
          color: WIDGET_COLORS.NEUTRAL,
        };
      }
      return {
        label: fit(row.name, 40),
        icon: 'help-circle',
        value: t(TEXT.unknown, language),
        color: WIDGET_COLORS.NEUTRAL,
      };
    }),
  });
  if (rows.length > MAX_ROWS && components.length < 4) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: `+${rows.length - MAX_ROWS} ${t(TEXT.more, language)}`,
    });
  }
  return { ttl_seconds: 60, components };
}

async function actPresence(_hub, { actionKey }) {
  throw new Error(`Unknown action ${actionKey}`);
}

// --- firewall rules -----------------------------------------------------------------

async function getRules(hub, { language = 'en' }) {
  if (!hub.config.host) {
    return message(TEXT.noHost, language);
  }
  if (hub.config.rules.length === 0) {
    return message(TEXT.noRule, language);
  }
  const components = [];
  const items = hub.config.rules.slice(0, MAX_ROWS).map((comment) => {
    const rule = hub.snapshot.rules.get(comment);
    const label = fit(comment, 40);
    if (!hub.snapshot.reachable) {
      return {
        label,
        icon: 'alert-triangle',
        value: t(TEXT.unreachable, language),
        color: WIDGET_COLORS.DANGER,
      };
    }
    if (!rule?.found) {
      return {
        label,
        icon: 'help-circle',
        value: t(TEXT.missing, language),
        color: WIDGET_COLORS.WARNING,
      };
    }
    return rule.active
      ? { label, icon: 'shield', value: t(TEXT.ruleOn, language), color: WIDGET_COLORS.SUCCESS }
      : {
          label,
          icon: 'shield-off',
          value: t(TEXT.ruleOff, language),
          color: WIDGET_COLORS.NEUTRAL,
        };
  });
  components.push({ type: 'status', items });
  if (!hub.config.allowCommands) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.readOnly, language) });
  } else if (hub.snapshot.reachable) {
    hub.config.rules.slice(0, MAX_RULE_BUTTONS).forEach((comment, index) => {
      const rule = hub.snapshot.rules.get(comment);
      if (!rule?.found) {
        return;
      }
      components.push({
        type: 'button',
        label: fit(comment, 24),
        // The current state is the icon (never the style: `primary` is
        // invisible in dark mode); the tap asks for the other state.
        icon: rule.active ? ACTIVE_ICON : 'circle',
        style: 'secondary',
        action: {
          key: ACTIONS.RULE(index),
          params: { rule: ruleIds(hub.gladys, comment).device, active: !rule.active },
          confirm: true,
        },
      });
    });
  }
  return { ttl_seconds: ttlOf(hub), components };
}

async function actRules(hub, { actionKey, params = {} }) {
  const index = hub.config.rules.findIndex((_, i) => ACTIONS.RULE(i) === actionKey);
  if (index === -1 || typeof params.rule !== 'string') {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const active = params.active === true || params.active === 'true';
  const comment = hub.ruleOf(params.rule);
  await hub.setRule(params.rule, active);
  return {
    message: Object.fromEntries(
      Object.entries(DONE_TEXT).map(([l, text]) => [
        l,
        fit(active ? text.enabled(comment) : text.disabled(comment), 200),
      ]),
    ),
  };
}

export const WIDGETS = {
  [WIDGET_KEYS.ROUTER]: { get: getRouter, action: actRouter },
  [WIDGET_KEYS.PRESENCE]: { get: getPresence, action: actPresence },
  [WIDGET_KEYS.RULES]: { get: getRules, action: actRules },
};
