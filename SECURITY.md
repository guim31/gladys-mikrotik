# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the RouterOS user name and password are fields of the Gladys
  configuration (the password a `secret` field). The integration reads them
  from Gladys at startup, keeps them in memory, sends them only to the router
  typed in the configuration (HTTP basic authentication of the REST API, or
  the login of the API protocol), and never writes them to `/data` nor to the
  logs. A read-only RouterOS user is enough unless the commands are allowed.
- **Stored in `/data`**: `mikrotik-state.json`, the MAC addresses already seen
  on the network with the date they were first seen (for the "Unknown device
  connected" trigger, 5,000 at most), and the date of the last update check.
  Nothing else.
- **Network**: requests go only to the router address of the configuration,
  on the local network: REST over HTTPS (443) or HTTP (80), API-SSL (8729) or
  API (8728). With HTTP and the plain API, the password travels unencrypted on
  the LAN; the automatic mode prefers the encrypted protocols, and the
  connection test says so. Certificates are verified unless the user ticks
  "Accept a self-signed certificate" (then API-SSL also accepts the anonymous
  suites RouterOS offers without a certificate). The integration opens no
  port and calls no cloud service; RouterOS itself contacts MikroTik's update
  servers once a day when the integration asks it to check for updates.
- **Changes to the router**: none unless "Allow commands" is ticked. Then
  only the `disabled` flag of the firewall filter rules whose comment the user
  listed, and a reboot, from a scene action or a widget button with
  confirmation. Nothing is exposed as a switch.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
RouterOS itself (see MikroTik's
[security page](https://mikrotik.com/supportsec)), and the other devices and
services of your network.
