# ArkPlay's DNA codec, borrowed

Copyright © Tsion Ark. Copied from `arkplay-avatars`, `packages/avatar-engine/src`,
at engine version **1.3.0**. Not a fork: unmodified files, so a refresh is a
re-copy rather than a merge.

## Why it is here

An avatar is a share code — the ~250-character string a render URL is built
from — and only this codec makes one. The avatar service publishes no route
that does: `POST /avatar/v1/codes`, `/encode`, `/share`, `/dna` and
`GET /codes/{code}`, `/decode/{code}` all answer 404, and `POST /me/avatars`,
which would return a code, answers 401 for an ArkPlay sign-in no Square reader
has a way to hold.

Both routes have been asked for. This copy is what lets the studio save and
reopen in the meantime, and it is **server-only**: it is reached through
`app/api/avatar/codes`, never imported into a page, because it is 221K of
schema that readers who never open the studio should not download.

## What was copied

Two import closures and nothing else, 75 files, one external dependency
(`fflate`):

- **`dna/codec.ts`** — 18 files. Turns an avatar into a share code and back.
  Runs on the SERVER only, behind `app/api/avatar/codes`, because it is schema
  rather than something a reader needs.
- **`render/render.ts`** — 69 files (56 of them new; the two closures overlap).
  Draws the avatar. Runs in the BROWSER, behind a dynamic `import()` so it
  lands in its own chunk and only the studio route ever fetches it.

### Why the renderer is here at all

The live preview used to be a round trip: post the document, wait ~1,900ms,
show the answer. The same render in process is **1.9ms** at `detail: low`, 4.9ms
at `high`. A thousandfold is not a gap a debounce or a cache can close, and it
is the difference between a studio where you watch a change happen and one
where every tap is a spinner.

The service still draws what is SAVED — `GET /render/{code}.png` is public,
immutable and CDN-cacheable, and shared by every visitor to a profile. Only the
private live preview is local.

## Verified, not assumed

Against the live service on the day it was copied:

- all five starter avatars encode, and four decode byte-identical; the fifth
  differs only by a dropped `meta.theme` annotation, which is not avatar data
- every code this copy mints renders **200** on `game-server.tsionark.com`,
  which is the only compatibility that matters — Square stores their URL

## The drift this can suffer, and the guard

Encoding walks the item schema (`dna/schema/items.ts`). If ArkPlay adds an item
and this copy does not know it, the catalog — which is fetched live — would
offer something this encoder cannot write.

So the studio compares the live catalog's `engineVersion` against
`ENGINE_VERSION` below and says so when they part company. Pinned at copy time:

```
engine 1.3.0   dnaVersion 1
```

## Not linted, on purpose

`vendor/**` is in the ESLint ignores. Linting it would ask us to EDIT it, which
is the one thing that must not happen to a verbatim copy — and the rules are
ours, not theirs: the renderer has a function called `cover` that calls one
called `use`, which the React hook rules read as a hook outside a component.

## Deleting it

The CODEC half goes when `POST /avatar/v1/codes` and `GET
/avatar/v1/codes/{code}` ship: point `CODEC` in `lib/arkplay-catalog.ts` at the
service, delete `app/api/avatar/codes`, and drop `fflate` if nothing else wants
it. The request shapes were chosen to match what was asked of ArkPlay precisely
so that this is the whole change.

The RENDERER half goes if ArkPlay ever publishes the engine as an installable
package: swap the dynamic `import()` in `lib/arkplay-local-render.ts` for the
package and delete the rest. Nothing else imports it.
