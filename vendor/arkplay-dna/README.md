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

The import closure of `dna/codec.ts` and nothing else — 18 files under `core/`,
`dna/` and `dna/schema/`. No renderer, no animation, no parts. One external
dependency, `fflate`.

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

## Deleting it

When `POST /avatar/v1/codes` and `GET /avatar/v1/codes/{code}` ship, point
`CODEC` in `lib/arkplay-catalog.ts` at the service, delete this directory and
`app/api/avatar/codes`, and drop `fflate` if nothing else wants it. The request
shapes were chosen to match what was asked of ArkPlay precisely so that this is
the whole change.
