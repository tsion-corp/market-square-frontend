// Display formatting only. KASH amounts are decimal strings end-to-end and are
// never parsed for arithmetic — parseFloat here exists purely to prettify.

export function formatKash(amount: string): string {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return `${amount} KASH`;
  return `${kashAmount(amount)} KASH`;
}

/**
 * A KASH amount, cut to as many decimals as the number actually needs.
 *
 * ─── THE RULE ────────────────────────────────────────────────────────────────
 * TWO decimals at or above 1 KASH, THREE below it, and a non-zero amount is
 * NEVER rendered as zero — however small it is, the digits are extended until
 * the first significant one shows.
 *
 * Always CUT, never rounded. This is somebody's money: rounding 80.999 up
 * shows a balance they do not have, and rounding a 0.025 earning up to 0.03
 * overstates what they were paid. Worked on the decimal STRING, so no float
 * ever touches the digits.
 *
 * ─── WHY IT IS NOT JUST TWO ──────────────────────────────────────────────────
 * It was, and this file asserted it: `kashAmount("0.009") === "0"`. That was
 * correct while every credit was a whole number of cents. Then gifts became a
 * 50/50 SPLIT, and half of the cheapest and most-tapped gift in the tray is
 * below a cent:
 *
 *   Rose   0.01 KASH  ->  recipient 0.005  ->  rendered "0 KASH"
 *   Book   0.05 KASH  ->  recipient 0.025  ->  rendered "0.02 KASH"
 *
 * A row reading "okayy gifted you a Rose — 0 KASH" says the sender sent
 * nothing. That is worse than an imprecise number: it makes a gift that
 * worked look broken, and it is the first thing anybody would report.
 *
 * The second line matters too, and it is why the fix is three decimals rather
 * than only a zero guard. Earnings rows sit directly under the BALANCE, and
 * people add them up. Five 0.025 gifts shown as "0.02" each total 0.10 beside
 * a balance of 0.125 — a list that does not agree with the figure above it.
 *
 * ─── WHY MAGNITUDE AND NOT A FLAT THREE ──────────────────────────────────────
 * Three decimals everywhere would print ticket prices and balances as "80.500"
 * — noise on a number where the third decimal is worth nothing. Below 1 KASH
 * that same digit is most of the amount. The precision follows the money.
 */
export function kashAmount(amount: string): string {
  const trimmed = amount.trim();
  /*
    Exponential notation reaches a plain decimal string BEFORE the rule runs.

    This branch used to collapse to two decimals itself
    (`Math.trunc(n * 100) / 100`), which turned 5e-3 into "0.00" and then into
    "0" — reintroducing the exact bug above for any caller handed a small
    number in exponential form. `toFixed(18)` matches KASH's own precision and
    lets the one rule below decide, so there is only ever one rule.
  */
  if (/e/iu.test(trimmed)) {
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? kashAmount(n.toFixed(18)) : trimmed;
  }
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace(/^[+-]/u, "").split(".");
  const wholeText = String(Number(whole || "0"));

  // Below 1 KASH the third decimal is real money; at or above it, it is noise.
  const places = wholeText === "0" ? 3 : 2;
  let digits = fraction.slice(0, places).padEnd(2, "0");
  // A third place that is zero adds nothing: 0.100 is 0.10, not "0.100".
  if (digits.length === 3 && digits.endsWith("0")) digits = digits.slice(0, 2);

  /*
    A NON-ZERO AMOUNT NEVER RENDERS AS ZERO.

    Below 0.001 even three decimals disappear, so the digits run on to the
    first significant one. This is the invariant that survives the next change
    to gift prices or to the split — it is not pinned to today's ladder, and it
    is why a future 0.0005 credit cannot silently become "0" again.

    SCOPED TO AMOUNTS UNDER 1 KASH, and the scope is the rule. Without it the
    guard fired on 1.005 and 80.009 too, printing a third decimal on exactly
    the amounts the magnitude rule says should not have one — and those never
    displayed as zero in the first place. The promise is that a non-zero amount
    never reads as ZERO, not that no digit is ever cut: 80.999 shows 80.99 for
    the same reason it always has.
  */
  if (wholeText === "0" && !/[1-9]/u.test(digits) && /[1-9]/u.test(fraction)) {
    digits = fraction.slice(0, fraction.search(/[1-9]/u) + 1);
  }

  const text = /^0*$/u.test(digits) ? wholeText : `${wholeText}.${digits}`;
  return negative && text !== "0" ? `-${text}` : text;
}

export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(count);
}

const UNITS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.34, "week"],
  [12, "month"],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  let delta = (then - now) / 1000;
  for (const [step, unit] of UNITS) {
    if (Math.abs(delta) < step) return rtf.format(Math.round(delta), unit);
    delta /= step;
  }
  return rtf.format(Math.round(delta), "year");
}

// Date only — for anniversaries and billing dates, where a clock time is
// noise. Invalid input yields "" so callers can render nothing.
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "02:41:09" style countdown for scheduled streams. Negative distances clamp
// to zero so a stream that just flipped live never shows "-0:01".
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * WHEN A SCHEDULED ROOM OPENS, short enough for a card's pill.
 *
 * "Opens 14:30" today, "Opens Fri 14:30" inside the next week, "Opens 12 Oct"
 * beyond it — the room card's pill is 11px in a 20px box, so a full date and
 * time does not fit and a countdown would need a ticking clock to stay true.
 * A time already past reads "Opening soon": the host has not started it yet,
 * and saying "Opens 10:00" about ten minutes ago is the one thing that is
 * certainly wrong.
 */
export function opensAtLabel(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return "Not open yet";
  if (ms <= now) return "Opening soon";
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = new Date(now).toDateString() === at.toDateString();
  if (sameDay) return `Opens ${time}`;
  if (ms - now < 7 * 24 * 60 * 60 * 1000) {
    return `Opens ${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  }
  return `Opens ${at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/**
 * "Starts in 3h 55m" — the countdown the upcoming room card carries
 * (1295:140172 writes "Starts in 203h 55m", so hours run past a day rather
 * than rolling into days until a week is reached).
 *
 * Under a minute, and anything already due, reads "Starting soon": a host who
 * has not opened the room yet makes "Starts in 0m" a lie the moment it renders.
 */
/** How long a host may be late before the countdown stops promising. */
const OPENING_GRACE_MS = 2 * 60_000;

export function startsInLabel(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return "Starting soon";
  /*
    PAST ITS TIME AND STILL NOT OPEN IS ITS OWN FACT.

    One branch used to answer two very different questions — "a room a minute
    from opening" and "a room whose host never showed" — so a 5:13 gist room
    still read "Starting soon" at 17:26 (ogazboiz saw exactly that). A card
    that promises a room is about to start, thirteen minutes after it did not,
    is the small dishonesty that makes every other time on the page suspect.

    The grace is for the host who is opening right now: at the moment the
    clock passes, they are plausibly mid-soundcheck. Past that, the truth is
    that the room is waiting on them, and the card says so.
  */
  if (ms < -OPENING_GRACE_MS) return "Waiting for host";
  if (ms < 60_000) return "Starting soon";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 168) return `Starts in ${Math.floor(hours / 24)}d`;
  if (hours === 0) return `Starts in ${minutes}m`;
  return `Starts in ${hours}h ${minutes % 60}m`;
}

/** "9:00 AM" — the upcoming card's own clock (1295:140166). */
export function clockLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Sep 19, 2026" — the upcoming card's date line (1295:140186). */
export function shortDateLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
