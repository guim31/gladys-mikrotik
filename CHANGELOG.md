# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- MikroTik routers on RouterOS 7 (REST API, over HTTPS or HTTP) and RouterOS
  6.43 or later (API, plain or SSL), the protocol detected automatically, the
  encrypted ones first. A read-only RouterOS user is enough.
- Presence sensors: add the phones and computers seen by the router (DHCP
  leases, Wi-Fi registration tables of the `wireless`, `wifiwave2`, `wifi`
  and CAPsMAN packages, optionally the ARP table) from the Discovery tab. A
  departure delay avoids false departures of phones asleep, and an outage of
  the router never sends anyone away.
- The router as a device: CPU load, memory used, temperature, uptime,
  RouterOS version and update available, and for each WAN interface its
  download and upload rates and its link state.
- Firewall rules followed by their comment, as devices showing whether the
  rule is enabled (IPv4 and IPv6 rules together).
- Commands, off by default ("Allow commands"): enable or disable a followed
  firewall rule, reboot the router, from a scene action or a widget button
  with confirmation. Nothing else in the router configuration is ever changed.
- Scene triggers "Unknown device connected", "WAN link down" and "WAN link
  restored" (with the length of the outage).
- Dashboard widgets "MikroTik router" (health and rates), "Devices at home"
  and "Firewall rules" (one button per rule).
- "Test the connection" and "List the firewall rules" in the Configuration
  screen.
- Texts and documentation in English, French, German and Spanish.
