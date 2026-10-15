# RouterOS answers used by the tests

What RouterOS answers to the reads of the integration, one file per router:

- `ros7-rb5009.json`: a RouterOS 7.18 router (RB5009) with the `wifi` package, an IPv6
  firewall and its WAN on `ether1` in the `WAN` interface list;
- `ros6-hap.json`: a RouterOS 6.49 hAP ac² with the legacy `wireless` package, no IPv6
  package, a PPPoE WAN and health given as one item (the RouterOS 6 format).

Keys are the menus, values the items of a `print`, as the REST API and the API protocol give
them: every value is a string (`"true"`, `"15"`, `"1w2d3h4m5s"`).

The field names and the values come from the test data of the Home Assistant `mikrotik`
integration (`tests/components/mikrotik/const.py`, Apache-2.0) and from the examples of the
RouterOS documentation (help.mikrotik.com). They are anonymized: IP addresses in the
documentation ranges of RFC 5737 (192.0.2.0/24, 198.51.100.0/24), MAC addresses in the
documentation range of RFC 7042 (00:00:5E:00:53:xx), invented serial numbers and software
ids.
