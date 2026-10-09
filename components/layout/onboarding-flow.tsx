"use client";

import { GENDER_OPTIONS } from "@/lib/gender";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/button";
import { errorCode } from "@/lib/api/envelope";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/use-me";
import { useImageUpload } from "@/components/ui/use-image-upload";
import { usePeople } from "@/features/discovery";
import { useMigrationLinked } from "@/features/migrate";
import { PersonQuickActions, useUpdateMe } from "@/features/profile";
import { hasSeenWelcome } from "@/components/layout/welcome/welcome-flow";
import { DEMO_AUTH, LEGACY_PRIVY_APP_ID } from "@/lib/auth-mode";
import {
  dismissMoveOffer,
  moveOfferDismissed,
  shouldOfferLegacyMove,
} from "@/lib/legacy-move-offer";
import { asset, sq } from "@/lib/square-path";
import { fetchVapidPublicKey, pushSupported, subscribeThisBrowser } from "@/lib/push-client";

/**
 * ONBOARDING — nodes 107:1821, 122:2906, 125:3616 and 126:3769.
 *
 * Four screens: a welcome splash, then a card that steps through claiming a
 * tag name, granting permissions and finding people. The card, its 34px radius
 * over `white/3` inside a 1px `white/10`, the 600x~708 footprint, the lockup
 * above it and the three-segment progress bar are all shared; only the middle
 * changes.
 *
 * ─── WHAT DECIDES WHETHER IT RUNS ────────────────────────────────────────────
 * The one piece of SERVER truth in the flow is whether the account has a
 * username: `usernameUnclaimed` is what the old `ClaimUsernameGate` read, and
 * it is the only step whose completion outlives the browser. Everything else is
 * local by nature — a browser permission belongs to the browser, and "I looked
 * at the people list" is not a fact worth a column — so the remaining steps are
 * remembered in `localStorage` and every storage access is try/caught.
 *
 * That means a person who claims a name on their phone and opens the laptop
 * does NOT get asked for a name again; they may see the permission step again,
 * which is correct, because that laptop genuinely has not been asked.
 *
 * ─── THREE THINGS THE FILE ASKS FOR THAT THE SERVICE CANNOT DO ───────────────
 * Each is drawn, and each says what it is rather than pretending:
 *
 *   1. SMS VERIFICATION. The card's subtitle is "By continuing you may receive
 *      an SMS for verification." There is no phone number on `PublicProfile`,
 *      no `POST /verify/sms`, nothing. So the subtitle is NOT shown — a promise
 *      that a code is coming, made to somebody who will never receive one, is
 *      worse than no subtitle at all.
 *   2. CONTACTS. "See which friends are already here" needs the address book
 *      AND a matching endpoint. The web has no contacts API worth the name
 *      (`navigator.contacts` is Android Chrome only, behind a user gesture, and
 *      returns nothing anywhere else), and there is no route to match against.
 *      The row is drawn and genuinely disabled, with the reason on it.
 *   3. FRIENDS ON SQUARE. Without contacts there is nobody to match, so this
 *      step shows the PEOPLE DIRECTORY — real accounts, in the server's own
 *      order — rather than an empty grid. The heading says "People on Square",
 *      because calling strangers your friends is the kind of small lie that
 *      makes everything else on the screen suspect.
 *
 * All three are written up for the backend.
 */

const DONE_KEY = "ms:onboarding:done";
const STEP_KEY = "ms:onboarding:step";
const STEPS = 4;

/** Every storage access is guarded: a browser refusing it must not trap
    somebody in a flow, and must not repeat one they finished. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignored. See above.
  }
}

export function OnboardingFlow() {
  const me = useMe();
  const update = useUpdateMe();

  /*
    ─── HOW OFTEN THIS SHOWS: ONCE PER ACCOUNT, AND IT RESUMES ────────────────

    THREE sources, each answering the question it is actually able to answer:

      · the CLAIM screen      -> `usernameUnclaimed` (server)
      · the SPLASH and PEOPLE -> `hasOnboarded`      (server)
      · the PERMISSIONS step  -> localStorage        (this device)

    The split is the point, and the middle row is what makes "once, ever" true:
    `hasOnboarded` is on `GET /me`, so a cleared cache or a second laptop no
    longer replays the tour. Existing members were backfilled `true` against the
    same rule the username check already used, so nobody who has been using the
    app gets re-onboarded because a column arrived.

    PERMISSIONS STAY LOCAL, deliberately, and a server flag must never suppress
    them. A microphone grant belongs to one browser on one machine — suppress
    that screen from a server flag and the person meets the browser's own prompt
    later, mid-room, with no context for why it is asking.

    RESUMING is local too. The furthest step is stored as it happens, so closing
    the tab on the permissions screen returns you to it rather than to the
    splash. Which screen somebody stopped on is a device convenience; the server
    has no reason to learn it, and a write per screen would be a write nobody
    reads twice.

    `hasOnboarded` is written ONCE, as `true`, when the flow ends. The service
    answers 400 to `false` by design — finishing cannot become less true — so
    nothing here ever sends it any other way.
  */
  const [localDone, setLocalDone] = useState(() =>
    typeof window === "undefined" ? false : read(DONE_KEY) === "1"
  );
  const [step, setStep] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = Number(read(STEP_KEY));
    return Number.isFinite(stored) && stored > 0 && stored <= STEPS ? stored : 0;
  });
  const [offerDeclined, setOfferDeclined] = useState(() =>
    typeof window === "undefined" ? false : moveOfferDismissed()
  );
  // Whether this account has already been joined to an old one. Null while it
  // is loading or cannot be told, which still offers — see the hook.
  const alreadyLinked = useMigrationLinked();

  const profile = me.data ?? null;
  if (!profile) return null;

  const mustClaim = profile.usernameUnclaimed;
  // The account is done AND this browser has been asked for its permissions.
  if (profile.hasOnboarded && localDone && !mustClaim) return null;

  /** Advance, and remember it — so closing the tab loses nothing. */
  const go = (next: number) => {
    write(STEP_KEY, String(next));
    setStep(next);
  };

  const finish = () => {
    write(DONE_KEY, "1");
    setLocalDone(true);
    // Best effort, and never blocking: the screen closes either way. A failed
    // write means the account sees the splash once more, which is a far smaller
    // cost than trapping somebody behind a retry.
    if (!profile.hasOnboarded) update.mutate({ hasOnboarded: true });
  };

  /*
    WHERE IT OPENS.

    An account that is already onboarded but on a NEW BROWSER needs the
    permission screen and nothing else — no splash, no welcome, no people it has
    already seen. It opens straight there.
  */
  /*
    NO SECOND WELCOME. A newcomer arrives through the signed-out welcome
    sequence (welcome-flow.tsx), signs up at its end, and lands here with
    `hasOnboarded` false — which used to open the SPLASH, "Welcome to Square"
    all over again. People read that as being sent back to the beginning. If
    this browser has been through the welcome, the flow opens on the first
    step that is actually new to them: the claim if they need one, otherwise
    permissions. The splash still runs for an account created any other way.
  */
  const entry = mustClaim ? 1 : profile.hasOnboarded || hasSeenWelcome() ? 2 : 0;
  const current = step === 0 ? entry : step;
  /*
    Before the handle, not after. Claiming one is what turns the empty profile
    Square provisioned on sign-in into somebody's account, and from that moment
    an old account can no longer move onto this id — see lib/legacy-move-offer.
  */
  const offerMove = shouldOfferLegacyMove({
    mustClaim,
    legacyAvailable: !DEMO_AUTH && Boolean(LEGACY_PRIVY_APP_ID),
    dismissed: offerDeclined,
    alreadyLinked: alreadyLinked === true,
  });

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-grey-900">
      {current === 0 ? (
        <Welcome onContinue={() => go(mustClaim ? 1 : 2)} />
      ) : (
        <div className="flex min-h-full flex-col items-center px-4 py-10">
          {/* The lockup sits above the card on all three carded steps. */}
          <Image
            src={asset("/onboarding/logo-lockup.png")}
            alt="Square"
            width={210}
            height={154}
            priority
            className="mb-6 h-[77px] w-auto"
          />

          <div className="w-full max-w-[600px] rounded-[34px] border border-white/10 bg-white/[0.03] p-6">
            {current === 1 &&
              (offerMove ? (
                <BringOldAccountStep
                  onNew={() => {
                    dismissMoveOffer();
                    setOfferDeclined(true);
                  }}
                />
              ) : (
                <ClaimStep onDone={() => go(2)} />
              ))}
            {current === 2 && (
              <PermissionsStep
                // Already onboarded and just here for the browser's permissions:
                // this IS the last screen, so it ends the flow rather than
                // walking them through people they have met.
                onDone={() => (profile.hasOnboarded ? finish() : go(3))}
              />
            )}
            {current === 3 && <PhotosStep onDone={() => go(4)} />}
            {current === 4 && <PeopleStep onDone={finish} />}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The card's head — title, optional subtitle, and the three-segment bar.
 *
 * The bar is the file's: 8 tall at a 25px radius, the active segment 50 wide in
 * `#7E3BEB` and the rest `#D9D9D9`, on a 5px gap. It is `aria-hidden` and paired
 * with a real "Step n of 3", because three coloured pills say nothing to a
 * screen reader.
 */
function CardHead({
  title,
  subtitle,
  step,
}: {
  title: string;
  subtitle?: string;
  step: number;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-[24px] font-bold leading-[27.81px] text-white">{title}</h1>
      {subtitle && (
        <p className="mt-3 text-[16px] font-medium leading-[27.81px] text-[#999999]">{subtitle}</p>
      )}
      <p className="sr-only">Step {step} of {STEPS}</p>
      <div aria-hidden className="mt-6 flex items-center gap-[5px]">
        {Array.from({ length: STEPS }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "h-2 rounded-[25px]",
              index === step - 1 ? "w-[50px] bg-[#7E3BEB]" : "w-[19px] bg-[#D9D9D9]"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** The file's 440x49 pill. Purple when it can act, `#1F1F1F` when it cannot. */
function StepButton({
  children,
  onClick,
  disabled,
  loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "ws-press mx-auto flex h-[49px] w-full max-w-[440px] items-center justify-center gap-3 rounded-full text-[16px] font-medium leading-[27.81px] transition-opacity",
        disabled
          ? "bg-[#1F1F1F] text-[#999999]"
          : "bg-[linear-gradient(90deg,#9F65FD_0%,#5B05E6_100%)] text-white hover:opacity-90"
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/**
 * THE SPLASH — node 107:1821.
 *
 * The 3D mark over "Welcome to **Square**" — one text node, two weights: the
 * file sets `Welcome to` at Medium inside a Black run, so the emphasis lands on
 * the product name. Then the body at 50% white and the 58-tall gradient pill.
 *
 * The rings behind it are a single SVG at 30% opacity, 1836 across and bleeding
 * off every edge, so it reads as depth rather than as a circle on a page.
 */
function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <Image
        src={asset("/onboarding/rings.svg")}
        alt=""
        aria-hidden
        width={1836}
        height={1836}
        priority
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 opacity-30"
      />

      <div className="relative flex w-full max-w-[627px] flex-col items-center gap-[71px]">
        <div className="flex flex-col items-center gap-9">
          <Image
            src={asset("/onboarding/logo-3d.png")}
            alt=""
            aria-hidden
            width={413}
            height={302}
            priority
            className="h-[151px] w-auto"
          />
          <div className="flex flex-col items-center gap-5 text-center">
            <h1 className="text-[42px] font-medium leading-tight text-white sm:text-[57.7px]">
              Welcome to <span className="font-black">Square</span>
            </h1>
            <p className="max-w-[481px] text-[14.6px] leading-[21.97px] text-white/50">
              Join conversations, create rooms, go live, and connect with communities to share
              and chat with people who matter to you.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="ws-press flex h-[58px] w-full max-w-[365px] items-center justify-center rounded-full bg-[linear-gradient(90deg,#9F65FD_0%,#5B05E6_100%)] text-[16px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/**
 * STEP 1 — node 122:2906.
 *
 * ─── TWO CORRECTIONS TO THE FILE, BOTH DELIBERATE ────────────────────────────
 *
 *  1. The field is labelled "Enter your number" in the file, which is a
 *     mistake — CONFIRMED with the designer. It is the username: the card's own
 *     title says "Claim your Square tag name" and the placeholder is
 *     `@Sirgappy`. The label reads "Enter your username". A field asking for a
 *     number while rejecting everything but letters is a form that fights the
 *     person filling it in.
 *  2. The subtitle promising an SMS is not rendered. See the module header.
 *
 * Gender is the file's two options, Male and Female, and nothing else.
 *
 * It is not REQUIRED: Continue is gated on the tag name alone, so somebody who
 * picks neither simply has no gender stored — `PATCH /me` sends a blank and the
 * service reads that as a clear. Nothing is invented for them, and they can set
 * it later from the profile editor.
 */
/**
 * BRING YOUR OLD ACCOUNT — shown in the claim slot, before the handle.
 *
 * Square provisioned an empty profile under this Decane id the moment the
 * reader signed in. That shell is absorbed when an old account is linked, but
 * only while it stays untouched — and claiming a handle is exactly what makes
 * it somebody's account, after which the two can never be joined without a
 * human. See `lib/legacy-move-offer`.
 *
 * So the question comes first, and the two answers lead opposite ways: linking
 * returns their old handle, so there is nothing to invent; "I'm new here" is
 * remembered on this browser and never asked again.
 */
function BringOldAccountStep({ onNew }: { onNew: () => void }) {
  const router = useRouter();
  return (
    <>
      <CardHead
        title="Had a Square account before?"
        subtitle="Upgrade it now and your handle, followers and posts come with it."
        step={1}
      />
      <div className="mt-10 space-y-3">
        <StepButton onClick={() => router.push(sq("/move-account"))}>
          Upgrade your account
        </StepButton>
        <button
          type="button"
          onClick={onNew}
          className="ws-press mx-auto flex h-[49px] w-full max-w-[440px] items-center justify-center rounded-full text-[16px] font-medium leading-[27.81px] text-[#999999] transition-colors hover:text-white"
        >
          I&apos;m new here
        </button>
      </div>
      {/* Said plainly, because it is the whole reason this screen exists and
          the cost of finding out later is two accounts. */}
      <p className="mt-6 text-center text-[13px] leading-normal text-[#777777]">
        Choosing a new name first means an old account can no longer be upgraded into this one.
      </p>
    </>
  );
}

function ClaimStep({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const update = useUpdateMe();
  const [tag, setTag] = useState(me.data?.usernameUnclaimed ? "" : (me.data?.username ?? ""));
  const [gender, setGender] = useState(me.data?.gender ?? "");
  const taken = errorCode(update.error) === "CONFLICT";
  const valid = /^[a-z0-9_]{3,20}$/.test(tag);

  return (
    <>
      <CardHead title="Claim your Square tag name" step={1} />

      <label className="block">
        <span className="mb-2.5 block text-[14px] font-medium leading-[27.81px] text-white">
          Enter your username
        </span>
        <div className="flex h-[54px] items-center gap-2 rounded-lg bg-[rgba(51,51,51,0.31)] px-6">
          <span className="text-[16px] text-white/40">@</span>
          <input
            autoFocus
            value={tag}
            onChange={(event) =>
              setTag(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            maxLength={20}
            placeholder="sirgappy"
            aria-label="Your username"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-white/30"
          />
        </div>
        {taken && <p className="mt-2 text-[13px] text-danger">That username is taken.</p>}
      </label>

      <div className="mt-8">
        <span className="mb-2.5 block text-[14px] font-medium leading-[27.81px] text-white">
          Gender
        </span>
        <div
          role="radiogroup"
          aria-label="Gender"
          className="overflow-hidden rounded-lg bg-[rgba(51,51,51,0.31)]"
        >
          {/* The file's two, and only those two — the one list in `lib/gender.ts`. */}
          {GENDER_OPTIONS.map((option) => {
            const value = option.value;
            const on = gender.toLowerCase() === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setGender(value)}
                className="ws-press flex w-full items-center justify-between px-6 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="text-[20px] font-medium leading-[27.81px] text-white">
                  {option.label}
                </span>
                <TickSquare on={on} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-10">
        <StepButton
          disabled={!valid}
          loading={update.isPending}
          onClick={() =>
            update.mutate(
              {
                username: tag,
                // Blank clears — the service reads it that way, which is what
                // "Prefer not to say" has to mean.
                gender,
              },
              { onSuccess: onDone }
            )
          }
        >
          Continue
        </StepButton>
      </div>
    </>
  );
}

/**
 * STEP 2 — node 125:3616.
 *
 * Three 117-tall rows at a 12px radius inside a 1px `white/10`, each carrying
 * its own art, a 20/27.81 title, a 16/27.81 line at `#999999` and a 24px tick
 * at the right.
 *
 * ─── THESE ARE REAL BROWSER PROMPTS, NOT CHECKBOXES ──────────────────────────
 * Tapping a row asks the browser, and the tick reflects what the BROWSER said —
 * not what the person tapped. That distinction is the whole value of the
 * screen: a tick that turns on when you click it, while the permission was
 * actually refused, teaches people the app is lying to them the first time
 * their microphone does not work.
 *
 * A refusal is not an error. It is recorded, the row stays readable, and
 * Continue is never blocked by it — none of these is required to use the
 * square, and a wall that demands a microphone before you can look around is
 * how an install gets deleted.
 */
type PermState = "idle" | "granted" | "denied" | "unsupported";

function PermissionsStep({ onDone }: { onDone: () => void }) {
  /*
    Seeded from what the BROWSER already holds, not from zero.

    A permission is browser state, and this component is not the only thing that
    can have asked for it — the gist room calls `getUserMedia` too, and somebody
    may have granted it there, or on a previous visit, or from the address bar.
    Starting every row unticked would tell them they had not done something they
    had, and a tick that disagrees with the browser is the whole failure this
    screen exists to avoid.

    The Permissions API is the only way to read a grant WITHOUT prompting.
    Firefox has never shipped `name: "microphone"` and Safari shipped it late,
    so a rejected query leaves the row at `idle` — unknown, ask if you want to —
    rather than claiming a state we could not read.
  */
  const [mic, setMic] = useState<PermState>("idle");
  const [notify, setNotify] = useState<PermState>(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission === "granted"
      ? "granted"
      : Notification.permission === "denied"
        ? "denied"
        : "idle";
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const status = await navigator.permissions?.query({
          name: "microphone" as PermissionName,
        });
        if (!alive || !status) return;
        if (status.state === "granted") setMic("granted");
        else if (status.state === "denied") setMic("denied");
      } catch {
        // Unsupported query — leave it at `idle`. See the note above.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const askMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setMic("unsupported");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release it immediately — this is a permission prompt, not a recording,
      // and holding the device would leave the browser's "in use" indicator on
      // for the rest of the session.
      stream.getTracks().forEach((track) => track.stop());
      setMic("granted");
    } catch {
      setMic("denied");
    }
  };


  /*
    THE NOTIFICATION ASK, WHICH THIS ROW SPENT MONTHS NOT MAKING.

    It was drawn and disabled on the grounds that nothing consumed the grant —
    no service worker, no subscription, no route to register a device against —
    and that spending the browser's ONE prompt on a promise we could not keep
    would burn the real ask for ever. All three now exist: `public/sw.js`,
    `pushManager.subscribe`, and `POST /me/push-subscriptions`.

    IT STILL DOES NOT ASK BLIND. `subscribeThisBrowser` needs the deployment's
    VAPID key, and a deployment without one cannot deliver anything — so the
    key is read FIRST and the row stays disabled, with the reason, when there
    is none. The prompt is only spent where a wink can actually arrive.
  */
  const askNotify = async () => {
    if (!pushSupported()) return setNotify("unsupported");
    try {
      const key = await fetchVapidPublicKey();
      // No key means this deployment cannot deliver a push. Say nothing, ask
      // nothing, and leave the browser's single prompt unspent.
      if (!key) return setNotify("unsupported");
      const allowed = await subscribeThisBrowser(key);
      setNotify(allowed ? "granted" : "denied");
    } catch {
      // A failed subscribe is not a refusal: the grant may have been given and
      // the recording lost. Read the browser back rather than claim either.
      setNotify(Notification.permission === "granted" ? "granted" : "idle");
    }
  };

  return (
    <>
      <CardHead
        title="Enable Permissions"
        subtitle="Select the buttons to enable permissions."
        step={2}
      />

      <div className="flex flex-col gap-3">
        <PermissionRow
          art={asset("/onboarding/perm-mic.png")}
          title="Microphone"
          body="Enable this to turn on your microphone"
          state={mic}
          onAsk={askMic}
        />
        <PermissionRow
          art={asset("/onboarding/perm-bell.png")}
          title="Notifications"
          body="Allow notifications so you know when someone winked at you"
          state={notify}
          onAsk={askNotify}
        />
        <PermissionRow
          art={asset("/onboarding/perm-contact.png")}
          title="Contact"
          body="See which friends are already here"
          state="idle"
          // The web has no contacts API worth the name and there is no route to
          // match an address book against. Drawn, disabled, reason on it.
          disabledReason="Finding friends from your contacts isn't available on the web yet."
        />
      </div>

      <div className="mt-8">
        {/* Never blocked on a permission. Everything here is optional and the
            square works without any of it. */}
        <StepButton onClick={onDone}>Continue</StepButton>
      </div>
    </>
  );
}

function PermissionRow({
  art,
  title,
  body,
  state,
  onAsk,
  disabledReason,
}: {
  art: string;
  title: string;
  body: string;
  state: PermState;
  onAsk?: () => void;
  disabledReason?: string;
}) {
  const off = Boolean(disabledReason) || !onAsk;
  return (
    <button
      type="button"
      disabled={off || state === "granted"}
      title={disabledReason}
      onClick={onAsk}
      aria-pressed={state === "granted"}
      className={cn(
        "flex min-h-[117px] w-full items-center gap-4 rounded-xl border border-white/10 px-4 text-left transition-colors",
        off ? "cursor-not-allowed opacity-50" : "ws-press hover:bg-white/[0.04]"
      )}
    >
      <Image src={art} alt="" aria-hidden width={122} height={122} className="h-[90px] w-[90px] shrink-0 object-contain" />
      <span className="min-w-0 flex-1">
        <span className="block text-[20px] font-medium leading-[27.81px] text-white">{title}</span>
        <span className="block text-[16px] font-medium leading-snug text-[#999999]">{body}</span>
        {state === "denied" && (
          // Named, not hidden: somebody who said no needs to know WHERE to
          // change it, because the app cannot ask twice.
          <span className="mt-1 block text-[13px] leading-4 text-white/50">
            Not allowed — you can change this in your browser&apos;s site settings.
          </span>
        )}
        {state === "unsupported" && (
          <span className="mt-1 block text-[13px] leading-4 text-white/50">
            This browser doesn&apos;t support it.
          </span>
        )}
      </span>
      <TickSquare on={state === "granted"} />
    </button>
  );
}

/**
 * STEP 3 — node 126:3769.
 *
 * The file's grid of 110.96-wide people cards on a 24px gutter, each the same
 * plate-with-badges the gist room draws, then Continue and a Skip beneath it.
 *
 * ─── IT IS "PEOPLE ON SQUARE", NOT "FRIENDS" ─────────────────────────────────
 * The file's heading says Friends, and its subtitle is left over from the
 * previous screen ("Select the buttons to enable permissions"), which is a
 * copy-paste rather than a decision. Friends would require the contacts match
 * that does not exist, so these are accounts from the people directory —
 * strangers, in the server's own order. Calling them friends is the kind of
 * small lie that makes every other claim on the screen suspect.
 *
 * The wink and follow badges are the profile slice's own `PersonQuickActions`,
 * unchanged: one wink path, one follow path, in the app.
 */
/**
 * A FACE AND A COVER, before anybody is asked to decide about them.
 *
 * It sits after the permissions and before the people, deliberately: the next
 * screen offers somebody a deck of strangers to follow and wink at, and a few
 * of those strangers will look back. Arriving at that moment as a grey circle
 * is the worst first impression the product can make, and it is the one thing
 * here that cannot be fixed later by somebody who never returns.
 *
 * ─── IT IS SKIPPABLE, AND THAT IS NOT A CONTRADICTION ───────────────────────
 * Blocking onboarding on an upload would lose the people who do not have a
 * picture to hand, which is a worse trade than an empty avatar. Home's
 * completeness prompt is the second ask, and it is why skipping here is safe:
 * the request comes back, at a moment of their choosing, rather than once.
 *
 * ─── IT SAVES EACH PICTURE AS IT LANDS ──────────────────────────────────────
 * Not on Continue. Somebody who uploads a photo and then closes the tab has
 * still set their photo — the upload already finished, and holding it behind a
 * button would throw away work they watched complete.
 */
function PhotosStep({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const update = useUpdateMe();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me.data?.avatarUrl ?? null);
  const [coverUrl, setCoverUrl] = useState<string | null>(me.data?.coverUrl ?? null);

  const avatar = useImageUpload(avatarUrl, (url) => {
    setAvatarUrl(url);
    if (url) update.mutate({ avatarUrl: url });
  });
  const cover = useImageUpload(coverUrl, (url) => {
    setCoverUrl(url);
    if (url) update.mutate({ coverUrl: url });
  });

  const busy = avatar.progress !== null || cover.progress !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[22px] font-semibold leading-7 text-white">Add your photos</h2>
        <p className="mt-1 text-[14px] leading-5 text-white/60">
          A face and a cover. People are about to decide whether to say hello.
        </p>
      </div>

      {/* The cover is the ground and the avatar sits on it, the same
          arrangement the profile draws, so what is being set is obvious
          without a label explaining which is which. */}
      <div className="relative h-[132px] w-full overflow-hidden rounded-[22px] bg-white/[0.06]">
        {cover.shown && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.shown} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
        )}
        <button
          type="button"
          onClick={cover.open}
          disabled={busy}
          aria-label={coverUrl ? "Change cover photo" : "Add a cover photo"}
          className="ws-press ws-btn-sm absolute right-3 top-3 rounded-full bg-black/55 px-3 text-[11px] font-semibold text-white backdrop-blur disabled:opacity-60"
        >
          {cover.progress !== null
            ? `${Math.round(cover.progress * 100)}%`
            : coverUrl
              ? "Change cover"
              : "Add cover"}
        </button>
        <input {...cover.inputProps} />

        <div className="absolute bottom-3 left-4 flex items-end gap-3">
          <button
            type="button"
            onClick={avatar.open}
            disabled={busy}
            aria-label={avatarUrl ? "Change profile photo" : "Add a profile photo"}
            className="ws-press relative size-[72px] overflow-hidden rounded-[22px] border-2 border-grey-900 bg-white/10 disabled:opacity-60"
          >
            {avatar.shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar.shown} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-[11px] font-semibold text-white/70">
                {avatar.progress !== null ? `${Math.round(avatar.progress * 100)}%` : "Add photo"}
              </span>
            )}
          </button>
          <input {...avatar.inputProps} />
        </div>
      </div>

      {/* Upload failures are the person's to act on — a silent one looks like a
          broken button. */}
      {(avatar.error || cover.error) && (
        <p role="alert" className="text-[13px] leading-5 text-danger">
          {avatar.error ?? cover.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="ws-btn-create ws-btn-md ws-press flex-1 rounded-full font-semibold text-white disabled:opacity-60"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="ws-btn-md ws-press rounded-full px-4 text-[14px] text-white/60 transition-colors hover:text-white"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function PeopleStep({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const people = usePeople("", "followers", true);
  const items = (people.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((profile) => profile.id !== me.data?.id)
    .slice(0, 8);

  return (
    <>
      <CardHead
        title="People on Square"
        subtitle="Follow a few to fill your feed. You can skip this."
        step={3}
      />

      {people.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-meta" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-[15px] text-meta">
          Nobody to show yet — you&apos;re early.
        </p>
      ) : (
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-5">
          {items.map((profile) => (
            <div key={profile.id} className="flex w-[111px] flex-col gap-2">
              <div className="relative h-[125px] w-[111px]">
                <div className="h-[113px] w-[111px] overflow-hidden rounded-[32px] bg-white/10">
                  <Avatar
                    name={profile.displayName || profile.username}
                    seed={profile.id}
                    src={profile.avatarUrl}
                    size={113}
                    sizeClassName="h-full w-full"
                    className="rounded-none border-0"
                  />
                </div>
                <span className="absolute left-1/2 top-[101px] -translate-x-1/2">
                  <PersonQuickActions username={profile.username} />
                </span>
              </div>
              <span className="w-full truncate text-center text-[14px] leading-6 text-white">
                {profile.displayName || profile.username}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <StepButton onClick={onDone}>Continue</StepButton>
        <button
          type="button"
          onClick={onDone}
          className="ws-press text-[16px] font-medium leading-[27.81px] text-[#999999] transition-colors hover:text-white"
        >
          Skip
        </button>
      </div>
    </>
  );
}

/** The file's 24px `tick-square` — an empty rounded square, filled when on. */
function TickSquare({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border transition-colors",
        on ? "border-spotlight bg-spotlight text-white" : "border-white/50"
      )}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l5 5 9-10" />
        </svg>
      )}
    </span>
  );
}
