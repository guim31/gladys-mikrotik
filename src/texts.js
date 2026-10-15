// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widgets (src/widgets.js):
// connection status, errors, the reports of the configuration actions, the
// errors of the commands. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// Protocol and product names (REST, API-SSL, RouterOS, WinBox) stay as is.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './routeros/errors.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address of your MikroTik router in the configuration.',
    fr: "Saisissez l'adresse de votre routeur MikroTik dans la configuration.",
    de: 'Gib die Adresse deines MikroTik-Routers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su router MikroTik en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.88.1',
    fr: 'Adresse incomprise, ex. 192.168.88.1',
    de: 'Adresse nicht verstanden, z. B. 192.168.88.1',
    es: 'Dirección no válida, p. ej. 192.168.88.1',
  },
  connecting: {
    en: 'Connecting to the router…',
    fr: 'Connexion au routeur…',
    de: 'Verbindung zum Router…',
    es: 'Conectando con el router…',
  },
};

// One short explanation per error kind (src/routeros/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the router does not answer at this address',
    fr: 'le routeur ne répond pas à cette adresse',
    de: 'der Router antwortet unter dieser Adresse nicht',
    es: 'el router no responde en esta dirección',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept a self-signed certificate"',
    fr: 'certificat refusé : cochez « Accepter un certificat auto-signé »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar un certificado autofirmado»',
  },
  [ERROR_KINDS.NOT_ROUTEROS]: {
    en: 'no RouterOS REST API nor API service on this port',
    fr: 'ni API REST ni service API de RouterOS sur ce port',
    de: 'weder REST-API noch API-Dienst von RouterOS auf diesem Port',
    es: 'ni API REST ni servicio API de RouterOS en este puerto',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused by the router',
    fr: "nom d'utilisateur ou mot de passe refusé par le routeur",
    de: 'Benutzername oder Passwort vom Router abgelehnt',
    es: 'nombre de usuario o contraseña rechazados por el router',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'the user group lacks a policy (api, rest-api or read)',
    fr: "il manque une permission au groupe de l'utilisateur (api, rest-api ou read)",
    de: 'der Benutzergruppe fehlt eine Berechtigung (api, rest-api oder read)',
    es: 'al grupo del usuario le falta un permiso (api, rest-api o read)',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this RouterOS does not know the command',
    fr: 'ce RouterOS ne connaît pas la commande',
    de: 'dieses RouterOS kennt den Befehl nicht',
    es: 'este RouterOS no conoce la orden',
  },
  [ERROR_KINDS.PROTOCOL]: {
    en: 'unexpected answer from the router, see the logs',
    fr: 'réponse inattendue du routeur, voir les logs',
    de: 'unerwartete Antwort des Routers, sieh in den Protokollen nach',
    es: 'respuesta inesperada del router, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    connected: (protocol, name, version) =>
      `Connected with ${protocol} to ${name} (RouterOS ${version}).`,
    wan: 'WAN',
    noWan: 'No WAN interface found: enter them in the configuration.',
    wanSource: {
      config: 'from the configuration',
      list: 'from the WAN interface list',
      fallback: 'ether1 by default',
    },
    up: 'up',
    down: 'down',
    missing: 'not found',
    clients: ({ wifi, leases, arp }) =>
      `Seen now: ${wifi} on Wi-Fi, ${leases} DHCP leases, ${arp} in ARP.`,
    ruleOn: 'rule found, enabled',
    ruleOff: 'rule found, disabled',
    ruleMissing: 'no rule with this comment',
    commandsOn: 'Commands enabled.',
    commandsOff: 'Commands disabled (read only).',
    tlsHint:
      'An encrypted service answers with a self-signed certificate: tick "Accept a self-signed certificate" to use it.',
    plainHint: 'The password travels unencrypted on your network: prefer HTTPS or API-SSL.',
  },
  fr: {
    connected: (protocol, name, version) =>
      `Connecté en ${protocol} à ${name} (RouterOS ${version}).`,
    wan: 'WAN',
    noWan: 'Aucune interface WAN trouvée : saisissez-les dans la configuration.',
    wanSource: {
      config: 'de la configuration',
      list: 'de la liste d’interfaces WAN',
      fallback: 'ether1 par défaut',
    },
    up: 'actif',
    down: 'coupé',
    missing: 'introuvable',
    clients: ({ wifi, leases, arp }) =>
      `Vus maintenant : ${wifi} en Wi-Fi, ${leases} baux DHCP, ${arp} dans l’ARP.`,
    ruleOn: 'règle trouvée, activée',
    ruleOff: 'règle trouvée, désactivée',
    ruleMissing: 'aucune règle avec ce commentaire',
    commandsOn: 'Commandes activées.',
    commandsOff: 'Commandes désactivées (lecture seule).',
    tlsHint:
      'Un service chiffré répond avec un certificat auto-signé : cochez « Accepter un certificat auto-signé » pour l’utiliser.',
    plainHint: 'Le mot de passe circule en clair sur votre réseau : préférez HTTPS ou API-SSL.',
  },
  de: {
    connected: (protocol, name, version) =>
      `Verbunden über ${protocol} mit ${name} (RouterOS ${version}).`,
    wan: 'WAN',
    noWan: 'Keine WAN-Schnittstelle gefunden: Gib sie in der Konfiguration ein.',
    wanSource: {
      config: 'aus der Konfiguration',
      list: 'aus der Schnittstellenliste WAN',
      fallback: 'standardmäßig ether1',
    },
    up: 'aktiv',
    down: 'getrennt',
    missing: 'nicht gefunden',
    clients: ({ wifi, leases, arp }) =>
      `Gerade gesehen: ${wifi} im WLAN, ${leases} DHCP-Leases, ${arp} im ARP.`,
    ruleOn: 'Regel gefunden, aktiviert',
    ruleOff: 'Regel gefunden, deaktiviert',
    ruleMissing: 'keine Regel mit diesem Kommentar',
    commandsOn: 'Befehle aktiviert.',
    commandsOff: 'Befehle deaktiviert (nur lesen).',
    tlsHint:
      'Ein verschlüsselter Dienst antwortet mit einem selbstsignierten Zertifikat: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“, um ihn zu nutzen.',
    plainHint:
      'Das Passwort wird unverschlüsselt in deinem Netzwerk übertragen: Nutze lieber HTTPS oder API-SSL.',
  },
  es: {
    connected: (protocol, name, version) =>
      `Conectado por ${protocol} a ${name} (RouterOS ${version}).`,
    wan: 'WAN',
    noWan: 'No se ha encontrado ninguna interfaz WAN: introdúzcalas en la configuración.',
    wanSource: {
      config: 'de la configuración',
      list: 'de la lista de interfaces WAN',
      fallback: 'ether1 por defecto',
    },
    up: 'activo',
    down: 'cortado',
    missing: 'no encontrado',
    clients: ({ wifi, leases, arp }) =>
      `Vistos ahora: ${wifi} por Wi-Fi, ${leases} concesiones DHCP, ${arp} en ARP.`,
    ruleOn: 'regla encontrada, activada',
    ruleOff: 'regla encontrada, desactivada',
    ruleMissing: 'ninguna regla con este comentario',
    commandsOn: 'Órdenes activadas.',
    commandsOff: 'Órdenes desactivadas (solo lectura).',
    tlsHint:
      'Un servicio cifrado responde con un certificado autofirmado: marque «Aceptar un certificado autofirmado» para usarlo.',
    plainHint: 'La contraseña viaja sin cifrar por su red: es preferible HTTPS o API-SSL.',
  },
};

// The "List the firewall rules" report.
export const RULES_TEXT = {
  en: {
    intro: 'Firewall rules with a comment (copy the comment into the configuration):',
    none: 'No firewall rule has a comment: add one in WinBox or WebFig.',
    on: 'enabled',
    off: 'disabled',
  },
  fr: {
    intro: 'Règles de pare-feu commentées (copiez le commentaire dans la configuration) :',
    none: "Aucune règle de pare-feu n'a de commentaire : ajoutez-en un dans WinBox ou WebFig.",
    on: 'activée',
    off: 'désactivée',
  },
  de: {
    intro: 'Firewall-Regeln mit Kommentar (kopiere den Kommentar in die Konfiguration):',
    none: 'Keine Firewall-Regel hat einen Kommentar: Füge einen in WinBox oder WebFig hinzu.',
    on: 'aktiviert',
    off: 'deaktiviert',
  },
  es: {
    intro: 'Reglas de cortafuegos con comentario (copie el comentario en la configuración):',
    none: 'Ninguna regla de cortafuegos tiene comentario: añada uno en WinBox o WebFig.',
    on: 'activada',
    off: 'desactivada',
  },
};

// Errors of the commands (scene actions and widget buttons), shown in Gladys.
export const ACTION_TEXT = {
  disabled: {
    en: 'Commands are disabled: tick "Allow commands" in the configuration.',
    fr: 'Les commandes sont désactivées : cochez « Autoriser les commandes » dans la configuration.',
    de: 'Befehle sind deaktiviert: Aktiviere „Befehle erlauben“ in der Konfiguration.',
    es: 'Las órdenes están desactivadas: marque «Permitir órdenes» en la configuración.',
  },
  unknownRule: {
    en: 'This device is not a firewall rule followed in the configuration.',
    fr: "Cet appareil n'est pas une règle de pare-feu suivie dans la configuration.",
    de: 'Dieses Gerät ist keine in der Konfiguration verfolgte Firewall-Regel.',
    es: 'Este dispositivo no es una regla de cortafuegos seguida en la configuración.',
  },
  ruleNotFound: {
    en: 'No firewall rule of the router has this comment any more.',
    fr: "Plus aucune règle de pare-feu du routeur n'a ce commentaire.",
    de: 'Keine Firewall-Regel des Routers hat diesen Kommentar mehr.',
    es: 'Ninguna regla de cortafuegos del router tiene ya este comentario.',
  },
  permission: {
    en: 'Refused by the router: the user group needs the write and reboot policies.',
    fr: "Refusé par le routeur : le groupe de l'utilisateur doit avoir les droits write et reboot.",
    de: 'Vom Router abgelehnt: Die Benutzergruppe braucht die Rechte write und reboot.',
    es: 'Rechazado por el router: el grupo del usuario necesita los permisos write y reboot.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK] ?? '';
