// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). They do
// nothing unless "Allow commands" is ticked in the configuration, and the
// router answers with its own refusal when the user's group lacks the policy.
//
//   - enable / disable a firewall rule followed in the configuration (by its
//     comment; the IPv4 and IPv6 rules of that comment together): the
//     parental control "no internet for the kids' tablet after 21:00";
//   - reboot the router.
//
// Never anything else: the integration does not change the router
// configuration beyond the `disabled` flag of the rules the user listed.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async enable_firewall_rule(hub, { fields = {} }) {
    const { active } = await hub.setRule(fields.rule, true);
    return { active };
  },

  async disable_firewall_rule(hub, { fields = {} }) {
    const { active } = await hub.setRule(fields.rule, false);
    return { active };
  },

  async reboot_router(hub) {
    await hub.reboot();
    return undefined;
  },
};
