"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { errorCode } from "@/lib/api/envelope";
import { msApi } from "@/lib/api/service";
import { MentionSchema, ProfileSchema } from "@/lib/api/schemas";
import { fetchStreams } from "@/features/streams/lib/api";

/**
 * ONE HOUSE, READ BY ANYBODY — `GET /conversations/:id`.
 *
 * The route is OPTIONAL-AUTH, which is what makes a house profile possible at
 * all: a signed-out reader gets a public house back with 200, and the page
 * they land on is the same page a member sees with a different button on it.
 * Verified against the running service rather than the spec — it answers
 * `{ title, description, imageUrl, memberCount, visibility, viewerIsMember,
 * canJoin }` to a request with no token.
 *
 * `viewerIsMember` is what decides Join House from View House, and `canJoin`
 * is the service's own answer about THIS viewer — false when signed out, false
 * for a private house. Neither is re-derived here: a client that decides who
 * may join is a client that will eventually disagree with the service.
 *
 * WHAT IT DOES NOT CARRY, and what the design draws: no members roster (the
 * face pile on `/conversations/discover` items is not on this read), no
 * website, no location, no rooms-per-week. Those sections are left OUT of the
 * page rather than stubbed — the gaps are with the backend, and an empty shelf
 * is worse than a shorter page.
 */
export const HouseSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional().default(null),
  description: z.string().nullable().optional().default(null),
  imageUrl: z.string().nullable().optional().default(null),
  memberCount: z.number().nullable().optional().default(null),
  visibility: z.enum(["public", "private"]).optional().default("private").catch("private"),
  viewerIsMember: z.boolean().optional().default(false),
  canJoin: z.boolean().optional().default(false),
  /*
    THE THREE FIELDS THAT ARRIVE WITH THE SERVICE, PARSED BEFORE THEY DO.

    All optional, so this reads today's payload unchanged — and the page draws
    each section the moment the field appears, with no frontend deploy to wait
    for. That is the whole point of parsing them early: the release becomes a
    backend deploy rather than a coordinated pair, which is the ordering that
    has bitten this app twice.

    `members` is the capped roster (4), PUBLIC HOUSES ONLY. A private house
    answers `[]` to anyone not in it, which is why an empty array must never be
    read as "no members" — `memberCount` is the true total and is unaffected.
    `website` is http(s)-only, enforced at the service's boundary.
    `weeklyRoomLimit` is null for every house today; null means UNCAPPED, and
    there is no default to invent.
  */
  members: z.array(ProfileSchema).optional().default([]),
  website: z.string().nullable().optional().default(null),
  /**
   * WHO THE DESCRIPTION @-MENTIONS — the same `Mention` rows a post and a DM
   * already carry, rendered by the same `PostText`.
   *
   * A separate array rather than handles parsed out of the text, for the
   * reason posts have one: the handle in the string is a SNAPSHOT and the
   * person behind it is not. A house description lives for months, so a
   * regex-linkified mention breaks at the first rename while a row carrying
   * the profile id survives it.
   *
   * Optional with an empty default, so a service that has not shipped it
   * renders the description as plain text — with its line breaks — rather
   * than failing to parse.
   */
  descriptionMentions: z.array(MentionSchema).optional().default([]).catch([]),
  weeklyRoomLimit: z.number().nullable().optional().default(null),
});

export type House = z.infer<typeof HouseSchema>;

export function useHouse(id: string) {
  const query = useQuery({
    queryKey: ["ms", "house", id],
    queryFn: async () => HouseSchema.parse(await msApi.get(`/conversations/${id}`)),
    enabled: id.length > 0,
    // A 404 here is a house that does not exist, or one a private reader may
    // not see. Retrying either is noise.
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
  return { ...query, missing: errorCode(query.error) === "NOT_FOUND" };
}

/**
 * A HOUSE'S MEMBERS — `GET /conversations/:id/members`.
 *
 * `ConversationMember` is `{ profile, role, joinedAt }`. Unlike the house read
 * this one is bearerAuth, so it answers for a signed-in reader and not for a
 * signed-out one, and a house you are not in may refuse it outright. Either
 * way the section simply does not render: `unavailable` covers both, because
 * "we cannot read the roster" and "there is no roster" must not look the same
 * on screen.
 *
 * The design draws this row in the NON-MEMBER state, which this cannot serve
 * — that needs the capped roster on the house read itself, the way
 * `/conversations/discover` items already carry one. It is with the backend.
 */
const MemberSchema = z.object({
  /*
    PARSED AS A FULL PROFILE, not a four-field summary, and that is not
    greed — the tile's wink and follow controls take a `Profile`, and the
    roster on the house read is already one. Narrowing this would give the
    page two member shapes and force a cast at the join. `ProfileSchema`
    defaults every field the summary omits, so a thin payload still parses.
  */
  profile: ProfileSchema,
  role: z.string().nullable().optional().default(null),
});

export type HouseMember = z.infer<typeof MemberSchema>;

/*
  THE ROUTE ANSWERS AN OBJECT, NOT AN ARRAY — and this parsed an array.

  `z.array(MemberSchema).parse(...)` THREW on every call, so the query was
  never anything but an error and `unavailable` was permanently true. The
  fallback it exists to be was therefore dead: a house whose read carries no
  roster showed no Members row at all, and nothing said why.

  Checked against the DEPLOYED spec rather than the repo's, because the two can
  differ and it is the deployed one that answers this client:

    GET /conversations/{id}/members -> data: { items, title, lastActiveAt }

  `title` and `lastActiveAt` ride along for the group header, which is a
  different surface; they are parsed so the shape is stated in one place, and
  the hook returns the items because that is what a roster is.
*/
const MembersResponseSchema = z.object({
  items: z.array(MemberSchema),
  title: z.string().nullable().optional().default(null),
  lastActiveAt: z.string().nullable().optional().default(null),
});

export function useHouseMembers(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["ms", "house", id, "members"],
    queryFn: async () =>
      MembersResponseSchema.parse(await msApi.authedGet(`/conversations/${id}/members`)).items,
    enabled: enabled && id.length > 0,
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 1,
  });
  return { ...query, unavailable: query.isError };
}

/**
 * A HOUSE'S PAST ROOMS — the Replays rail (node 1285:37015).
 *
 * `GET /streams?houseConversationId=<id>&status=ended`. The filter is on the
 * contract and indexed (`streams_house_created_idx`), which is what makes this
 * one house's history rather than everybody's filtered down on the client —
 * and the client version breaks on page two, which is precisely when a house
 * has enough history for this rail to exist at all.
 *
 * Absent when there is nothing: a house that has never opened a room shows no
 * Replays heading rather than an empty shelf under one.
 */
export function useHouseReplays(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["ms", "house", id, "replays"],
    queryFn: () => fetchStreams({ houseConversationId: id, status: "ended", limit: 12 }),
    enabled: enabled && id.length > 0,
    // A house's history does not change while somebody reads the page.
    staleTime: 5 * 60_000,
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 1,
  });
  return { ...query, items: query.data?.items ?? [] };
}
