// The tips slice's only public surface. Slices never import each other, so
// `components/layout/*-screen.tsx` composes these into the feed and profile
// through the same route-slot pattern `FollowPill` uses.
export { TipButton } from "./components/tip-button";
export {
  useSendTip,
  useTipCapability,
  useTippingUnavailable,
  // The gift gallery's counts — own profile only, see the hook.
  useReceivedTips,
} from "./hooks/use-tips";
// "They just left" — a 409 the room tells apart from a refusal. See the module.
export { GIFT_PHASE_SAYS, recipientLeftTheRoom, recipientCannotHoldKash, tipAlreadyInFlight, RECIPIENT_GONE } from "./lib/availability";
export type { ReceivedTip } from "./lib/api";
export type { Tip, TipTarget } from "./lib/types";
