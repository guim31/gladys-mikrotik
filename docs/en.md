# MikroTik

Follow your [MikroTik](https://mikrotik.com) router from Gladys, over your local
network: know who is home from the phones on your Wi-Fi, see the health of the
router and the rates of your internet link, be told when the WAN drops or when
an unknown device joins, and, if you allow it, cut the internet of the kids'
tablet from a scene.

> **Developed without the hardware: feedback welcome.** This integration was
> built and tested against the answers documented by MikroTik and the test data
> of the Home Assistant integration, not against a real router. If something
> does not work as described, please say so on the
> [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-mikrotik/issues).

This integration is not affiliated with MikroTik.

## What you need

- Gladys Assistant 5.1.0 or later.
- A MikroTik router running **RouterOS 7** (REST API) or **RouterOS 6.43** or
  later (API), reachable from Gladys.
- One of these RouterOS services enabled (**IP** → **Services**): `www-ssl`
  (HTTPS, RouterOS 7), `api-ssl`, `www` (HTTP, RouterOS 7) or `api`. The
  default configuration of RouterOS has `www` and `api` enabled.
- A RouterOS user for Gladys (see below).

## Set up

### The RouterOS user

Create a dedicated user rather than using `admin`. A **read-only** account is
enough for the presence sensors, the measurements, the triggers and the
widgets. In a terminal (WinBox, WebFig or SSH):

```
/user add name=gladys group=read password=a-long-password
```

Check that the group has the `api` policy, and `rest-api` on RouterOS 7
(**System** → **Users** → **Groups**). The commands (firewall rules, reboot)
need a group with the `write` and `reboot` policies, such as `write`.

To go further, allow the service only from the address of Gladys, e.g.
`/ip service set www address=192.168.88.10/32`.

### The configuration

Open **Integrations** → **MikroTik** → **Configuration**:

- **Router address**: its IP address (`192.168.88.1` by default), with `:port`
  if the service does not use its default port.
- **User name** and **Password** of the RouterOS user.
- **Protocol**: _Automatic_ tries REST over HTTPS, API-SSL, REST over HTTP,
  then API, and keeps the first that works; the encrypted ones first. Choose
  one to force it.
- **Accept a self-signed certificate**: for HTTPS and API-SSL. RouterOS uses a
  self-signed certificate unless you installed another one.
- **Refresh interval**: 10 seconds to 1 minute (30 seconds by default).
- **WAN interfaces**: empty, the integration takes the members of the `WAN`
  interface list of RouterOS (the default configuration puts `ether1` in it),
  else `ether1`. Up to four names, separated by commas.
- **Presence**: the **Departure delay (minutes)** and the sources (see below).
- **Firewall rules to follow** and **Allow commands** (see below).
- **Language of the names**: the language of the device and feature names.

Then press **Test the connection**: the report says which protocol is used,
which WAN interfaces are followed, how many clients are seen and whether the
followed rules exist. Finally open the **Discovery** tab and add the devices
you want.

## The devices

### The router

One device, named after the RouterOS identity:

| Feature                   | What it shows                                        |
| ------------------------- | ---------------------------------------------------- |
| CPU load                  | in %                                                 |
| Memory used               | in %                                                 |
| Temperature               | in °C, when the router has a sensor                  |
| Uptime                    | in hours                                             |
| RouterOS version          | e.g. `7.18.2`                                        |
| RouterOS update available | On when RouterOS reports a newer version             |
| Download / Upload         | per WAN interface, in Mbit/s, averaged over a period |
| WAN link                  | per WAN interface: On when the link is up            |

The integration asks RouterOS to check for updates once a day (a read-only
user cannot: then the last check made by RouterOS is shown).

### Presence sensors

The Discovery tab lists the clients of the router: its DHCP leases, its Wi-Fi
registration tables (`wireless`, `wifiwave2`, `wifi` and CAPsMAN) and, if
enabled, its ARP table. Add the phones you want to follow: each becomes a
**Presence** sensor, named after its comment in RouterOS, else its host name.

- A device is **present** as soon as the router sees it: associated to the
  Wi-Fi, or with a live ARP entry if **Also use the ARP table** is ticked, or
  with a bound DHCP lease if **Count a DHCP lease as present** is ticked.
- It becomes **away** only when it has not been seen for the **Departure
  delay** (5 minutes by default): a phone asleep leaves the Wi-Fi for a few
  minutes without leaving home.
- When the router cannot be read, nobody changes state.

A present device is published again every two minutes, so the _Check user
presence_ scene action of Gladys works too; with the departure delay, you
rarely need it.

Phones use a private (random) Wi-Fi address per network. Keep it **fixed**
for your home Wi-Fi (on iOS: _Private Wi-Fi Address_ set to _Fixed_; on
Android: per-network randomization, not per connection), or the device will
look new after a change.

### Firewall rules

To follow a rule, give it a comment in RouterOS (**IP** → **Firewall** →
**Filter Rules**), then enter that comment in **Firewall rules to follow**
(**List the firewall rules** shows the commented rules). Each one becomes a
device with a **Rule enabled** feature (On when the rule is enabled). The IPv4
and IPv6 rules that share the comment count as one.

The state is read only. With **Allow commands** ticked, the scene actions and
the widget can enable or disable the rule: the integration then changes only
the `disabled` flag of these rules, and nothing else in the configuration.

## Dashboard

Three widgets:

- **MikroTik router**: CPU, memory, temperature, download and upload rates of
  the first WAN interface, the state of every WAN link, the uptime, the
  RouterOS version or the update available, and a **Reboot** button (with
  confirmation) when the commands are allowed.
- **Devices at home**: the devices followed as presence sensors, present
  first, with how long the others have been away. Its setting **Show** keeps
  only the present ones.
- **Firewall rules**: the followed rules, and when the commands are allowed,
  one button per rule (four at most) to enable or disable it, with
  confirmation. A check mark shows the enabled rules.

## Scenes

### Triggers

- **Unknown device connected**: a MAC address never seen before joined the
  Wi-Fi or got a DHCP lease. The devices present when the integration starts
  for the first time are learnt without firing. Filter: _Seen by_ (Wi-Fi or
  DHCP lease). Variables: MAC address, IP address, host name, seen by,
  interface.
- **WAN link down**: a WAN interface lost its link. Filter: _Interface_.
  Variable: interface.
- **WAN link restored**: the link is back. Filter: _Interface_. Variables:
  interface, outage in minutes.

### Actions

They need **Allow commands**, and a RouterOS user with the `write` and
`reboot` policies.

- **Enable a firewall rule** and **Disable a firewall rule**: choose a rule
  device. Output: _Rule enabled_.
- **Reboot the MikroTik router**: the network is cut for a minute or two.

### Scene ideas

- _Nobody home_: when the presence of every phone is "No presence", set the
  alarm and lower the heating.
- _Bedtime for the tablet_: every evening at 21:00, **Enable a firewall rule**
  "Block kids tablet"; at 7:00, **Disable a firewall rule**.
- _Internet outage_: on **WAN link down**, send a message through a channel
  that does not need the internet (an SMS gateway on the LAN), and on **WAN
  link restored**, tell how long it lasted.
- _Who is this?_: on **Unknown device connected**, send yourself a message with
  its host name and IP address.

## How often the router is read

The integration reads the router itself, at the refresh interval of the
configuration (Gladys does not poll these devices). A reading is about ten
small listings (resource, health, interfaces, Wi-Fi, ARP, DHCP leases, rules):
negligible for the router. The update status is read every hour, and RouterOS
is asked to check MikroTik's servers once a day. Only the values that change
are sent to Gladys, plus a heartbeat every six hours.

## Troubleshooting

- **"user name or password refused"**: check them in WinBox. After a refusal,
  the integration tries again every five minutes (each try is a line in the
  RouterOS log).
- **"the user group lacks a policy"**: give the group `api` (and `rest-api` on
  RouterOS 7).
- **"certificate refused"**: tick **Accept a self-signed certificate**, or
  install a certificate trusted by Gladys.
- **"does not answer"**: check the address, that the service is enabled in
  **IP** → **Services**, and that its `address` field allows Gladys.
- **No WAN rate**: the rates need two readings; check the names in **WAN
  interfaces**.
- **A phone stays away**: tick **Also use the ARP table**, raise the departure
  delay, and check its private Wi-Fi address is fixed.
- More details: start the integration with `LOG_LEVEL=debug`. At the default
  level the logs show only the start, the router lost and back, the problems
  (once each) and your commands. Passwords never appear in the logs.

## Limits

- One router per integration. With several access points, follow the
  presence on the one that sees every client (the CAPsMAN controller, or the
  router with the ARP table).
- The WAN link state is the state of the interface: an internet outage behind
  a working link (the ISP side) is not seen.
- The rates are averages over the refresh interval, from the interface
  counters.
- The Wi-Fi tables of other brands of access points are not read: use the
  ARP table.
- Device and feature names are set when a device is added to Gladys.
- Firewall filter rules only (not NAT, mangle or Kid Control), found by their
  exact comment.
- Developed without the hardware: the answers of real routers may differ
  from the documented ones. Feedback welcome.
