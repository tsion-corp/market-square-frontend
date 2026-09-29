// Governance-sensitive capabilities default OFF. They are enabled only after
// product/legal/commercial approval and a backend entitlement or ledger path.
export const MARKET_FLAGS = {
  vipAccess: process.env.NEXT_PUBLIC_MS_VIP_ACCESS_ENABLED === "true",
  liveGifts: process.env.NEXT_PUBLIC_MS_LIVE_GIFTS_ENABLED === "true",
  /**
   * Let somebody claim a player name BEFORE proving they are a real person.
   *
   * OFF by default, which means verification is REQUIRED — that is the
   * production rule and the reason the integration exists: a score only counts
   * for GameArena when it belongs to a verified human, and their Month 3
   * target is verified humans rather than wallets.
   *
   * ON reverses the order for testing, so the name claim can be exercised
   * without standing through a face scan every time. It is deliberately a flag
   * rather than a code change, so switching production back is one variable
   * and nobody has to remember which branch the real rule lives on.
   *
   * ONE HONEST CONSEQUENCE of turning it on: claiming a name is a transaction,
   * and its gas is funded on GameArena's side only for verified humans
   * (FAUCET_REQUIRE_GOODDOLLAR). So an unverified claim can fail for want of
   * gas. That is said at the point it happens rather than by hiding the field.
   */
  gamesVerifyOptional: process.env.NEXT_PUBLIC_MS_GAMES_VERIFY_OPTIONAL === "true",
  /**
   * Replays: recorded playback of an ended stream.
   *
   * OFF because the capability does not exist yet, not because of policy.
   * Recording needs **LiveKit egress running** and **a storage bucket
   * configured to receive it**, and neither is provisioned — so `replayUrl` is
   * null on every stream and always will be until both land. Every replay
   * surface was therefore promising something that could never happen: a
   * "Watch the replay" card, a play button on ended stream cards, a Replays
   * section, and a player that would have tried to load nothing.
   *
   * TO TURN ON: egress must be running AND a replay bucket configured, so the
   * service actually returns a non-null `replayUrl`. Flip this only after
   * confirming a real ended stream comes back with one — the flag makes the
   * surfaces reappear, it cannot make the recordings exist.
   */
  replays: process.env.NEXT_PUBLIC_MS_REPLAYS_ENABLED === "true",
  /**
   * Promoting the ARK Store in primary navigation.
   *
   * This gates PROMOTION, never the feature: `/store` and `/store/[slug]` keep
   * working, deep links resolve, and Explore's Products tab still lists items.
   * What it hides is the app telling people to go there — the sidebar entry,
   * the mobile bar and drawer, the Explore category tile and the empty-state
   * CTA. Turning it on is one switch, and nothing behind it needs to change.
   */
  storeNav: process.env.NEXT_PUBLIC_MS_STORE_NAV_ENABLED === "true",
  /**
   * The labelled desktop SIDEBAR, instead of the bottom dock.
   *
   * Off by default, which is the shipped design: `BottomDock` (748:15721)
   * replaced the sidebar on desktop and the tab bar on a phone, so the dock is
   * the app's only bottom navigation. This is the way back.
   *
   * IT IS A LAYOUT SWITCH, NOT A CAPABILITY, so it does NOT follow the
   * visible-and-inert rule the other flags do — there is nothing to grey out.
   * On, the sidebar returns on desktop with its eleven destinations, its
   * drag-to-resize and its unread badges, and the dock steps back to phones
   * only so the two never both claim the navigation.
   *
   * `NEXT_PUBLIC_MS_SIDEBAR_ENABLED=true`, then REBUILD — not just restart.
   * Every `NEXT_PUBLIC_*` value is inlined into the bundle at build time,
   * so `next start` against an existing build serves the OLD value however
   * many times it is restarted. This said "and restart" and cost real time:
   * the flag was set, the server bounced, and the dock kept showing.
   */
  sidebar: process.env.NEXT_PUBLIC_MS_SIDEBAR_ENABLED === "true",

  /**
   * Houses: audio-only rooms where anyone can open a table and raise a hand.
   *
   * This gates PROMOTION, never the room. `/gist-rooms/[id]` always resolves — a
   * link somebody was sent has to work, and hiding an entry must never break a
   * route. What it hides is the app pointing at it: the street link in
   * navigation and the "Open a gist room" entry point.
   *
   * OFF by default with the rest, and it is a soft launch switch rather than a
   * governance one: nothing behind it takes money, issues an entitlement, or
   * needs legal sign-off.
   */
  houses: process.env.NEXT_PUBLIC_MS_HOUSES_ENABLED === "true",
  /**
   * The ws-gateway, for a realtime "the lane's head changed" signal.
   *
   * A URL rather than a boolean, because the address IS the switch: absent
   * means no socket is ever constructed and the feed keeps its 30-second
   * head check alone, which stays as the floor either way. Set it to the
   * gateway's origin (`wss://<host>/`) to layer the signal on top. Public
   * lanes only — `following` is per-reader and never subscribes.
   *
   * `NEXT_PUBLIC_MS_WS_GATEWAY_URL=wss://…` and rebuild (inlined at build).
   */
  wsGatewayUrl: process.env.NEXT_PUBLIC_MS_WS_GATEWAY_URL ?? "",
  moneyLinkedGames: false,
  predictions: false,
  staking: false,
} as const;
