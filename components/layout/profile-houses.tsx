"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConversations } from "@/features/messages";
import { HOUSE_CARD, HouseCard } from "@/components/layout/house-card";
import { CreateGroupFlow } from "@/components/layout/create-group-flow";
import { sq } from "@/lib/square-path";

/**
 * THE HOUSES ON A PROFILE — nodes 534:16949 (the section) and 534:16951 (the
 * rail). A heading, 16, then a horizontal rail of 112-tall cards 16 apart: an
 * "Add new house" tile at 136 and each house at 427.
 *
 * THE CARD ITSELF IS `HouseCard` (components/layout/house-card.tsx), shared
 * with the rail on a stranger's profile (545:47653) — one object, two rails.
 *
 * ─── THE CARD IS AN OUTLINE, NOT A FILL ─────────────────────────────────────
 * Every card — the Add tile included — carries `#FFFFFF` at 18% as a 1px
 * STROKE over the `#101012`/62% fill. It shipped with the fill alone, so the
 * cards dissolved into the page: sampling the export's card edge gives
 * (59,59,60) against a (15,15,16) interior, which is exactly 18% white
 * composited over that fill. The border is what makes the rail read as five
 * objects rather than one dark band.
 *
 * ─── OWN PROFILE ONLY, AND THAT IS THE CONTRACT'S DOING ─────────────────────
 * The list comes from `GET /me/conversations?kind=group` — the same query the
 * chat inbox's Houses tab runs. There is no route for the houses SOMEBODY ELSE
 * belongs to, so this renders on your own profile and is absent on anyone
 * else's rather than showing a visitor an empty rail.
 *
 * The file agrees: the frame it sits in also carries "Add new house", which is
 * only ever your own.
 *
 * ─── WHY IT IS COMPOSED HERE ────────────────────────────────────────────────
 * A house is a CONVERSATION, so this reads the messages slice; the profile is
 * its own slice and the two may not import each other.
 */

export function ProfileHouses() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const houses = useConversations("houses");
  const items = (houses.data?.pages ?? []).flatMap((page) => page.items);

  // Nothing to say yet: the rail is absent rather than a lone "Add" tile
  // floating under a heading with nothing beside it.
  if (houses.isPending || houses.isError) return null;

  return (
    <section aria-label="Houses" className="flex flex-col gap-4">
      {/* 1021:20293 — "Houses" at 12/16 700 in `#F4F4F4`, and opposite it the
          live file's "View All" (1021:20295) at 12/16 700 in white, opening the
          inbox on its Houses tab. */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[12px] font-bold leading-4 text-grey-100">Houses</h2>
        <Link href={sq("/messages?tab=houses")} className="text-[12px] font-bold leading-4 text-white transition-opacity hover:opacity-80">
          View All
        </Link>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 534:16952 — 136 wide against the houses' 427, so it reads as a slot
            rather than as a house with nothing in it.

            The `+` is TYPE, not an icon: Geist 600 at 41.6/62.4, and the label
            is pulled 12 back into it (`itemSpacing: -12`) so the two read as
            one mark. Its measured fill is `#9F5AFF`; painted with
            `--color-create` `#9F65FD`, the ramp's light stop, because the two
            are a hair apart and this repo deliberately keeps two purples. */}
        {/* Opens the create-house modal IN PLACE — it does NOT navigate. It
            used to link to /messages?compose=house, which threw the reader off
            their profile onto the inbox before the sheet showed (ogazboiz,
            2026-09-30). `CreateGroupFlow` is the very flow the inbox opens; on
            success we route to the new house, as its own card's "View House"
            does, and the rail refetches from the create mutation's invalidation. */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className={`${HOUSE_CARD} ws-press flex h-[112px] w-[136px] flex-col items-center justify-center px-4 py-3 transition-colors hover:bg-white/[0.06]`}
        >
          <span aria-hidden className="text-[41.6px] font-semibold leading-[62.4px] text-create">
            +
          </span>
          <span className="-mt-3 text-[13.82px] font-semibold leading-[20.73px] text-grey-400">
            Add new house
          </span>
        </button>

        {items.map((house) => (
          <HouseCard
            key={house.id}
            id={house.id}
            name={house.title ?? "House"}
            imageUrl={house.imageUrl}
            description={house.description}
            members={house.members}
            memberCount={house.memberCount}
            action={{ label: "View House", href: sq(`/messages?conversation=${house.id}`) }}
          />
        ))}
      </div>

      <CreateGroupFlow
        open={createOpen}
        mode="group"
        onClose={() => setCreateOpen(false)}
        onStarted={(conversation) => {
          setCreateOpen(false);
          router.push(sq(`/messages?conversation=${conversation.id}`));
        }}
      />
    </section>
  );
}
