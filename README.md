# MikroTik for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows [MikroTik](https://mikrotik.com) routers through the RouterOS 7 REST API
or the RouterOS API protocol (RouterOS 6.43 and later), over the local network.
No cloud, no account.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the answers documented by MikroTik and the test data
> of the Home Assistant `mikrotik` integration, not against a real router.
> Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-mikrotik/issues).

This project is not affiliated with MikroTik. MikroTik and RouterOS are
trademarks of their owner.

## Features

- **Presence sensors**: the clients the router sees (DHCP leases, Wi-Fi
  registration tables of the `wireless`, `wifiwave2`, `wifi` and CAPsMAN
  packages, and optionally the ARP table) are listed in the Discovery tab; each
  one the user adds becomes a presence sensor. A configurable **departure
  delay** avoids false departures of phones asleep, and an outage of the router
  never marks anyone away.
- **The router as a device**: CPU load, memory used, temperature (when the
  router has a sensor), uptime, RouterOS version and **update available**, and
  for each WAN interface its **download and upload rates** and its **link
  state**. The WAN interfaces come from the `WAN` interface list of RouterOS, or
  from the configuration.
- **Firewall rules** followed by their comment: one device per rule, showing
  whether it is enabled (the IPv4 and IPv6 rules of a comment together).
- **Commands, off by default**: when the user ticks _Allow commands_, scene
  actions and widget buttons (with confirmation) can enable or disable a
  followed rule (parental control) and reboot the router. Nothing else in the
  router configuration is ever changed, and nothing is exposed as a switch.
- **Scene triggers**: _Unknown device connected_ (a MAC address never seen
  before, remembered across restarts), _WAN link down_ and _WAN link restored_
  (with the length of the outage).
- **Dashboard widgets**: _MikroTik router_ (health, rates, links, updates, a
  Reboot button), _Devices at home_, _Firewall rules_ (one button per rule).
- **Test the connection** and **List the firewall rules** in the
  Configuration screen.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A MikroTik router on **RouterOS 7** (REST API, `www-ssl` or `www` service) or
  **RouterOS 6.43** or later (API, `api-ssl` or `api` service).
- A RouterOS user for Gladys. The built-in **read** group is enough for the
  presence, the measurements, the triggers and the widgets (it needs the
  `api` policy, and `rest-api` on RouterOS 7); the commands need the `write`
  and `reboot` policies.

## Installation

1. On the router, create the user: `/user add name=gladys group=read password=…`
2. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-mikrotik`
   (or install **MikroTik** from the catalog once it is listed).
3. In **Configuration**, enter the address of the router, the user and its
   password. Leave the protocol on _Automatic_. Save, then click **Test the
   connection**.
4. Open the **Discover** tab and add the router, the phones to follow and the
   rules.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Protocol**: in _Automatic_ mode, REST over HTTPS, API-SSL, REST over HTTP
  and API are tried in parallel, and the first of that list that logs in is
  kept: the encrypted ones first. RouterOS 6 has no REST API (its WebFig
  answers HTML): the API is used. A certificate that does not verify is
  refused unless _Accept a self-signed certificate_ is ticked; the connection
  test says when the password travels unencrypted.
- **Reading**: every refresh interval (10 s to 1 min, 30 s by default), the
  integration reads `/system/resource`, `/system/health`, `/interface`, the Wi-Fi
  registration tables, `/ip/arp`, `/ip/dhcp-server/lease` and the followed
  firewall rules, with `print` (a `GET` of the REST API) and a property list.
  `/system/package/update` is read hourly; RouterOS is asked to
  `check-for-updates` once a day (skipped for a read-only user). The rates are
  computed from the growth of the interface byte counters between two
  readings. Gladys never polls these devices (`should_poll: false`): the timer
  is the integration's own.
- **States**: only the values that change are sent, for the devices added to
  Gladys only, with a heartbeat every six hours; a present client is sent again
  every two minutes so the _Check user presence_ scene action of Gladys works
  too. Everything is sent again when a device is added or Gladys reconnects.
- **Commands**: `/ip/firewall/filter/set` and `/ipv6/firewall/filter/set` with
  `.id` and `disabled` only, and `/system/reboot`.
- **Storage**: `/data/mikrotik-state.json`, the MAC addresses already seen (for
  the unknown-device trigger) and the date of the last update check.

## Development

```bash
npm install
npm test                 # node --test, against the fake Gladys of the SDK and a fake RouterOS
npm run lint
npm run format:check
```

`scripts/probe.mjs` checks the transports against a real router, read only,
and prints a report without addresses, MACs, serials or names:

```bash
node scripts/probe.mjs 192.168.88.1                                   # an invented account, refused
MIKROTIK_USER=gladys MIKROTIK_PASSWORD=… node scripts/probe.mjs 192.168.88.1
```

## Limits

- One router per integration; the WAN link state is the interface state (an
  outage on the ISP side behind a working link is not seen); the rates are
  averages over the refresh interval; firewall filter rules only, found by
  their exact comment. See the Limits section of the user guide.

## Credits

- The Home Assistant [`mikrotik`](https://www.home-assistant.io/integrations/mikrotik/)
  integration (Apache-2.0): the menus to read and the shape of their answers;
  the test fixtures are derived from its test data.
- [`tomaae/homeassistant-mikrotik_router`](https://github.com/tomaae/homeassistant-mikrotik_router)
  (Apache-2.0): the reading of RouterOS 6 and 7 health, the update status and
  the firewall rules.
- [`librouteros`](https://github.com/luqasz/librouteros) (GPL-2.0), read to
  understand the API protocol; no code was copied. The API transport is written
  from the [RouterOS API documentation](https://help.mikrotik.com/docs/spaces/ROS/pages/47579160/API).
- Built on the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys
  Assistant.

## License

[Apache-2.0](LICENSE)
