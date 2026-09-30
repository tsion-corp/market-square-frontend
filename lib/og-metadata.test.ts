import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_OG_IMAGE,
  SITE_DESCRIPTION,
  buildPostMetadata,
  buildProfileMetadata,
  clampDescription,
  genericPostMetadata,
  genericProfileMetadata,
  isProfileUsername,
  ogImageUrl,
  parseOgPost,
  parseOgProfile,
  postMetadataFor,
  profileMetadataFor,
  sharePreviewsEnabled,
} from "./og-metadata.ts";

const CLOUD = "https://res.cloudinary.com/dpynyht1l";
const PUBLIC_ID = "uploads/did:privy:cmu1n88rs00fv0dky3lyzhxnz/image/01a0a16c-b39d-7000-9487-c6f96ebad1e9.jpg";
const UPLOADED = `${CLOUD}/image/upload/f_auto,q_auto,w_1280,c_limit/${PUBLIC_ID}`;
const POST_T = "c_fill,g_auto,w_1200,h_630,f_jpg,q_auto:good";
const AVATAR_T = "c_fill,g_face,w_400,h_400,f_jpg,q_auto:good";
const BANNER_T = "c_fill,g_auto,w_912,h_260,f_jpg,q_auto:good";
const SHORT = "0Bs5Ry4ePkLgYnMHsVJd2y";

const author = {
  id: "did:privy:cmu1n88rs00fv0dky3lyzhxnz",
  username: "qingthecreator_",
  generatedUsername: "user_69bqxdc8",
  displayName: "Qing",
  avatarUrl: `${CLOUD}/image/upload/f_auto,q_auto,w_256,c_limit/${PUBLIC_ID}`,
};

describe("og images come only from our own cloud", () => {
  it("replaces the upload transformation rather than stacking a second one, keeping colons in the id", () => {
    assert.equal(ogImageUrl(UPLOADED, "post"), `${CLOUD}/image/upload/${POST_T}/${PUBLIC_ID}`);
    assert.equal(ogImageUrl(UPLOADED, "avatar"), `${CLOUD}/image/upload/${AVATAR_T}/${PUBLIC_ID}`);
    assert.equal(ogImageUrl(UPLOADED, "banner"), `${CLOUD}/image/upload/${BANNER_T}/${PUBLIC_ID}`);
    const out = ogImageUrl(UPLOADED, "post")!;
    assert.equal(out.match(/\/upload\//g)?.length, 1);
    assert.equal(out.includes("w_1280"), false);
    assert.ok(out.includes("did:privy:cmu1n88rs00fv0dky3lyzhxnz"));
  });

  it("inserts the transformation when the upload has none, and keeps a version segment", () => {
    assert.equal(ogImageUrl(`${CLOUD}/image/upload/${PUBLIC_ID}`, "post"), `${CLOUD}/image/upload/${POST_T}/${PUBLIC_ID}`);
    assert.equal(
      ogImageUrl(`${CLOUD}/image/upload/w_100/e_blur:300/v1712345678/${PUBLIC_ID}`, "post"),
      `${CLOUD}/image/upload/${POST_T}/v1712345678/${PUBLIC_ID}`
    );
    // A folder with an underscore is never mistaken for a transformation — and
    // it is still not an upload the service issued, so it is refused.
    assert.equal(ogImageUrl(`${CLOUD}/image/upload/my_photos/a.jpg`, "post"), null);
    assert.equal(
      ogImageUrl(`${CLOUD}/image/upload/f_auto/uploads/my_owner/my_photos/a.jpg`, "post"),
      `${CLOUD}/image/upload/${POST_T}/uploads/my_owner/my_photos/a.jpg`
    );
  });

  it("turns a video into its first frame as a jpg", () => {
    const clip = `${CLOUD}/video/upload/f_auto,q_auto/uploads/did:privy:abc/video/clip.mp4`;
    assert.equal(ogImageUrl(clip, "post"), `${CLOUD}/video/upload/so_0,${POST_T}/uploads/did:privy:abc/video/clip.jpg`);
    // The production clip shape, exactly as the feed serves it.
    assert.equal(
      ogImageUrl(`${CLOUD}/video/upload/f_auto,q_auto,vc_auto,w_720,c_limit/uploads/did:privy:abc/video/01a0.mp4`, "post"),
      `${CLOUD}/video/upload/so_0,${POST_T}/uploads/did:privy:abc/video/01a0.jpg`
    );
    // A clip with no owner folder or no extension is not something we issued.
    assert.equal(ogImageUrl(`${CLOUD}/video/upload/uploads/clip`, "post"), null);
  });

  it("refuses every other host, scheme, cloud and delivery", () => {
    for (const url of [
      `https://evil.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `http://res.cloudinary.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com.evil.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://evil.com/res.cloudinary.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://evil.res.cloudinary.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com@evil.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://user:pw@res.cloudinary.com/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com:8443/dpynyht1l/image/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com/othercloud/image/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com/dpynyht1lx/image/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com/dpynyht1l/image/fetch/https://evil.com/x.jpg`,
      `https://res.cloudinary.com/dpynyht1l/raw/upload/${PUBLIC_ID}`,
      `https://res.cloudinary.com/dpynyht1l/image/private/${PUBLIC_ID}`,
      `https://res.cloudinary.com/dpynyht1l/image/upload/s--abcd1234--/${PUBLIC_ID}`,
      `https://res.cloudinary.com/dpynyht1l/image/upload/`,
      `https://res.cloudinary.com/dpynyht1l/image/upload/f_auto/`,
      `https://res.cloudinary.com/dpynyht1l/image/upload/v123`,
      // Round-2 audit: each survived transformation-stripping and was delivered behind ours.
      `${CLOUD}/image/upload/if_w_gt_1/a.jpg`,
      `${CLOUD}/image/upload/$v_1/a.jpg`,
      `${CLOUD}/image/upload/c_fill/s--abc--/v1/${PUBLIC_ID}`,
      `${CLOUD}/image/upload/..%2F..%2Fother/image/upload/a.jpg`,
      `${CLOUD}/image/upload/w_1`,
      `${CLOUD}/image/upload/f_auto/uploads/did:privy:x/%2E%2E/a.jpg`,
      `${CLOUD}/image/upload/f_auto/uploads/did:privy:x/a%2Fb.jpg`,
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/uploads/x.jpg",
      "not a url",
      "",
      null,
      42,
    ]) {
      assert.equal(ogImageUrl(url, "post"), null, String(url));
    }
  });
});

describe("descriptions", () => {
  it("collapses whitespace and cuts at a word with an ellipsis, never past 200", () => {
    assert.equal(clampDescription("  New   here,\n\nwho’s here?  "), "New here, who’s here?");
    const long = `${"word ".repeat(60)}end`;
    const out = clampDescription(long);
    assert.ok(Array.from(out).length <= 200);
    assert.ok(out.endsWith("…"));
    assert.ok(out.startsWith("word word"));
    assert.equal(out.includes("wor…"), false, "cut mid-word");
    const exact = "a".repeat(200);
    assert.equal(clampDescription(exact), exact);
  });

  it("never splits an emoji and still caps one unbroken run", () => {
    const out = clampDescription("😀".repeat(300));
    assert.equal(Array.from(out).length, 200);
    assert.ok(!/[\uD800-\uDBFF]…$/.test(out));
  });
});

describe("post previews", () => {
  const raw = {
    kind: "update",
    text: "New here,   who’s here?",
    media: [
      { url: "https://evil.com/preview.jpg", kind: "link" },
      { url: UPLOADED, kind: "image", width: null },
    ],
    preview: { imageUrl: "https://evil.com/og.jpg" },
    quotedPost: { id: "q", text: "SOMEONE ELSE'S WORDS" },
    author,
  };

  it("names the author, uses the post's own words and its first picture", () => {
    const meta = buildPostMetadata(parseOgPost(raw)!, SHORT);
    assert.deepEqual(meta.title, { absolute: "Qing on Square" });
    assert.equal(meta.description, "New here, who’s here?");
    assert.equal(meta.openGraph.type, "article");
    assert.equal(meta.openGraph.siteName, "Square");
    assert.equal(meta.openGraph.url, `/p/${SHORT}`);
    assert.deepEqual(meta.alternates, { canonical: `/p/${SHORT}` });
    assert.equal(meta.twitter.card, "summary_large_image");
    assert.deepEqual(meta.openGraph.images, [
      { url: `${CLOUD}/image/upload/${POST_T}/${PUBLIC_ID}`, width: 1200, height: 630, type: "image/jpeg", alt: "Photo from Qing's post" },
    ]);
    assert.deepEqual(meta.twitter.images, meta.openGraph.images);
    const serialised = JSON.stringify(meta);
    assert.equal(serialised.includes("evil.com"), false);
    assert.equal(serialised.includes("SOMEONE ELSE"), false);
    assert.equal(serialised.includes("did:privy"), true, "only inside the Cloudinary public id");
    assert.equal(serialised.replace(/uploads\/did:privy:[a-z0-9]+/g, "").includes("did:"), false);
  });

  it("never prints an id as the name, and falls back the way the profile schema does", () => {
    const unnamed = parseOgPost({ ...raw, author: { id: "did:privy:abcdgt4t", username: null, displayName: null } })!;
    assert.equal(unnamed.authorName, "Member ·GT4T");
    const didName = parseOgPost({ ...raw, author: { ...author, displayName: "did:privy:xyz" } })!;
    assert.equal(didName.authorName, null);
    assert.deepEqual(buildPostMetadata(didName, SHORT).title, { absolute: "A post on Square" });
  });

  it("gives a text-only or unhostable post the branded card, and an empty post a generic line", () => {
    const text = buildPostMetadata(parseOgPost({ ...raw, media: [] })!, SHORT);
    assert.deepEqual(text.openGraph.images, [FALLBACK_OG_IMAGE]);
    const foreign = buildPostMetadata(parseOgPost({ ...raw, media: [{ url: "https://evil.com/a.jpg", kind: "image" }] })!, SHORT);
    assert.deepEqual(foreign.openGraph.images, [FALLBACK_OG_IMAGE]);
    const empty = buildPostMetadata(parseOgPost({ ...raw, text: "   " })!, SHORT);
    assert.equal(empty.description, "A post by Qing on Square.");
  });

  it("uses a clip's first frame, and the legacy single-media fields when the list is absent", () => {
    const clip = `${CLOUD}/video/upload/uploads/did:privy:abc/video/clip.mp4`;
    const video = buildPostMetadata(parseOgPost({ ...raw, media: [{ url: clip, kind: "video" }] })!, SHORT);
    assert.equal(video.openGraph.images[0].url, `${CLOUD}/video/upload/so_0,${POST_T}/uploads/did:privy:abc/video/clip.jpg`);
    assert.equal(video.openGraph.images[0].alt, "Video from Qing's post");
    const legacy = parseOgPost({ kind: "update", text: "x", mediaUrl: UPLOADED, mediaKind: "image", author })!;
    assert.equal(legacy.media?.url, UPLOADED);
  });

  it("gives a story the generic card with no picture of its own", () => {
    const story = buildPostMetadata(parseOgPost({ ...raw, kind: "story" })!, SHORT);
    assert.deepEqual(story, genericPostMetadata(SHORT));
    assert.equal(story.description, SITE_DESCRIPTION);
    assert.deepEqual(story.openGraph.images, [FALLBACK_OG_IMAGE]);
    assert.equal(JSON.stringify(story).includes("Qing"), false);
  });

  it("404s only on an upstream 404, and is generic for everything else", () => {
    assert.equal(postMetadataFor({ status: "not-found" }, SHORT), "not-found");
    assert.deepEqual(postMetadataFor({ status: "unavailable" }, SHORT), genericPostMetadata(SHORT));
    assert.deepEqual(postMetadataFor(null, SHORT), genericPostMetadata(SHORT), "switched off");
    assert.deepEqual(postMetadataFor({ status: "ok", data: { nonsense: true } }, SHORT), genericPostMetadata(SHORT));
    assert.deepEqual(postMetadataFor({ status: "ok", data: raw }, SHORT), buildPostMetadata(parseOgPost(raw)!, SHORT));
  });
});

describe("profile previews", () => {
  const raw = { ...author, bio: "Creative Technologist || Ai engineer" };

  it("titles with the name and @handle, describes with the bio and shows a square avatar", () => {
    const meta = buildProfileMetadata(parseOgProfile(raw)!, "qingthecreator_");
    assert.deepEqual(meta.title, { absolute: "Qing (@qingthecreator_) on Square" });
    assert.equal(meta.description, "Creative Technologist || Ai engineer");
    assert.equal(meta.openGraph.type, "profile");
    assert.equal(meta.twitter.card, "summary");
    assert.equal(meta.openGraph.url, "/u/qingthecreator_");
    assert.deepEqual(meta.alternates, { canonical: "/u/qingthecreator_" });
    assert.deepEqual(meta.openGraph.images, [
      { url: `${CLOUD}/image/upload/${AVATAR_T}/${PUBLIC_ID}`, width: 400, height: 400, type: "image/jpeg", alt: "Qing's profile photo" },
    ]);
  });

  it("canonicalises a minted-handle visit onto the handle the profile answers to", () => {
    const meta = buildProfileMetadata(parseOgProfile(raw)!, "user_69bqxdc8");
    assert.equal(meta.openGraph.url, "/u/qingthecreator_");
    const minted = buildProfileMetadata(parseOgProfile({ ...raw, username: null, displayName: null })!, "user_69bqxdc8");
    assert.deepEqual(minted.title, { absolute: "Member ·HXNZ (@user_69bqxdc8) on Square" });
    assert.equal(minted.openGraph.url, "/u/user_69bqxdc8");
  });

  it("omits the handle rather than print an id, and falls back for a missing bio or avatar", () => {
    const bare = parseOgProfile({ id: "did:privy:abcdgt4t", username: null, generatedUsername: null, displayName: "Ada" })!;
    assert.equal(bare.handle, null);
    const meta = buildProfileMetadata(bare, "whatever");
    assert.deepEqual(meta.title, { absolute: "Ada on Square" });
    assert.equal(meta.description, "Ada is on Square.");
    assert.deepEqual(meta.openGraph.images, [FALLBACK_OG_IMAGE]);
    assert.equal(JSON.stringify(meta).includes("did:"), false);
  });

  it("is generic without a canonical for a handle the service would never answer to", () => {
    assert.equal(genericProfileMetadata("did:privy:abc").alternates, undefined);
    assert.equal(genericProfileMetadata("did:privy:abc").openGraph.url, undefined);
    assert.equal(genericProfileMetadata("ada_lovelace").openGraph.url, "/u/ada_lovelace");
    assert.equal(profileMetadataFor({ status: "not-found" }, "ada_lovelace"), "not-found");
    assert.deepEqual(profileMetadataFor({ status: "unavailable" }, "ada_lovelace"), genericProfileMetadata("ada_lovelace"));
    assert.deepEqual(profileMetadataFor(null, "ada_lovelace"), genericProfileMetadata("ada_lovelace"));
  });

  it("only fetches handles that match the service's rule", () => {
    for (const ok of ["abc", "user_69bqxdc8", "qingthecreator_", "a".repeat(20)]) assert.equal(isProfileUsername(ok), true, ok);
    for (const bad of ["ab", "a".repeat(21), "Ada", "did:privy:abc", "..", "a/b", "a%2Fb", "ada lovelace", "ａｄａ", ""]) {
      assert.equal(isProfileUsername(bad), false, bad);
    }
  });
});

describe("the kill switch", () => {
  it("is on unless explicitly turned off", () => {
    for (const on of [undefined, "", "on", "true", "1"]) assert.equal(sharePreviewsEnabled(on), true, String(on));
    for (const off of ["off", "OFF", " false ", "0", "no", "disabled"]) assert.equal(sharePreviewsEnabled(off), false, off);
  });
});
