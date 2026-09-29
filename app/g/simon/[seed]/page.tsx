import { SimonChallengeScreen } from "@/components/layout/simon-challenge-screen";

/**
 * A challenge opened by its link rather than from its card.
 *
 * Inside a thread the card replaces the message text, so nobody normally
 * arrives here. This route exists because the message a challenge travels as
 * CONTAINS that link — it has to, so the message degrades into a sentence and
 * a link rather than into line noise — and a link in every game message that
 * leads to a 404 is worse than no link at all.
 */
export default async function SimonChallengePage({
  params,
  searchParams,
}: {
  params: Promise<{ seed: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { seed } = await params;
  const { s } = await searchParams;
  return <SimonChallengeScreen seed={seed} rawTarget={s} />;
}
