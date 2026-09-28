"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/use-auth";
import { useMe } from "@/hooks/use-me";
import { useLogout } from "@/hooks/use-logout";
import { errorCode } from "@/lib/api/envelope";
import { countryOptions } from "@/lib/countries";
import { SignInPrompt } from "@/components/ui/states";
import { Toggle } from "@/components/ui/toggle";
import { ColumnHeader } from "@/components/layout/column-header";
import { ChatView } from "@/components/layout/chat-view";
import { SAVING_SOON } from "@/components/layout/settings-copy";
import { NotificationsView } from "@/components/layout/notifications-view";
import { HouseNotificationsView } from "@/components/layout/house-notifications-view";
import {
  useHouseNotificationSettings,
  useOpenConversation,
  useUpdateHouseNotificationSettings,
} from "@/features/messages";
import { useProfile, useUpdateMe } from "@/features/profile";
import { SUPPORT_EMAIL, SUPPORT_USERNAME } from "@/lib/support";
import { COMMUNITY_GUIDELINES, PRIVACY_POLICY, type LegalDocument } from "@/lib/legal";
import { usePushNotifications, useSettings, useUpdateSettings, type LocationPrecision } from "@/features/settings";
import {
  IconArrowLeft,
  IconCheckbox,
  IconCheckboxChecked,
  IconCheckCircle,
  IconSettingsCard,
  IconSettingsBell,
  IconUnlock,
  IconSettingsMessage,
  IconSettingsChevron,
  IconExternalLink,
  IconLogout,
} from "@/components/ui/icons";
import { sq } from "@/lib/square-path";

/*
  SETTINGS, IN HOME'S FRAME.

  It opens as ONE pane: the list, across the frame. Tap a row and, from lg, it
  becomes two — the list narrows to the left and the chosen setting opens in a
  second column beside it, which is the design. Both panes sit inside the
  shell's FULL frame (Home's column plus rail, no rail drawn), and both open
  with the shared header style, so the page lines up with the top bar. Below lg
  there is no room for two panes, so the list and the setting swap, and the
  header's back arrow walks back up: sub-page → section → list.
*/

// ---------------------------------------------------------------------------
// Types & data
// ---------------------------------------------------------------------------

type Section = "subscription" | "notifications" | "privacy" | "help";

const SECTIONS: Array<{
  key: Section;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Figma icon size — message-question is 20px, the rest are 24px. */
  iconSize: string;
}> = [
  {
    key: "subscription",
    title: "Subscription",
    description: "Manage plan details and billing.",
    icon: IconSettingsCard,
    iconSize: "size-6",
  },
  {
    key: "notifications",
    title: "Notifications",
    // Push and a daily email summary exist now, beside in-app alerts.
    description: "Customize push, email, and live room activity alerts.",
    icon: IconSettingsBell,
    iconSize: "size-6",
  },
  {
    key: "privacy",
    title: "Privacy & Security",
    description: "Control account visibility, data, and permissions.",
    icon: IconUnlock,
    iconSize: "size-6",
  },
  {
    key: "help",
    title: "Help Centre",
    description: "Access FAQs, guidelines, and direct support.",
    icon: IconSettingsMessage,
    iconSize: "size-5",
  },
];

type PrivacyView = "main" | "location" | "chat";
type HelpView = "main" | "terms" | "privacy-policy" | "community-guidelines" | "contact";

/*
  FOUR choices, not the design's three: the city stays on profiles (the
  decision was "keep city, add country"), so showing it is a choice of its own.
  "City, region and country" is the service's default, which is why nothing
  anyone already shows changes until they pick something narrower.
*/
const LOCATION_CHOICES: Array<{ key: LocationPrecision; label: string }> = [
  { key: "city_region_country", label: "City, region and country" },
  { key: "region_country", label: "Region and country" },
  { key: "country", label: "Country" },
  { key: "continent", label: "Continent" },
];

const HELP_TITLES: Record<Exclude<HelpView, "main">, string> = {
  terms: "Terms of Service",
  "privacy-policy": "Privacy Policy",
  "community-guidelines": "Community Guidelines",
  contact: "Contact us",
};

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

/** A menu row — 81px tall, icon circle + text + chevron. */
function MenuRow({
  section,
  isActive,
  onClick,
}: {
  section: (typeof SECTIONS)[number];
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "flex h-[81px] w-full items-center justify-between border-b border-white/15 px-4 py-6 text-left transition-colors hover:bg-white/[0.03]",
        isActive && "lg:bg-white/[0.04]",
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10">
          <Icon className={cn(section.iconSize, "text-create")} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-base font-bold leading-4 text-white">
            {section.title}
          </p>
          <p className="text-[13px] font-normal leading-5 text-white/50">
            {section.description}
          </p>
        </div>
      </div>
      <IconSettingsChevron className="size-6 shrink-0 text-white/50" />
    </button>
  );
}

/**
 * The second pane's header, from lg — the shared header's own look (the
 * `ws-head` bar, a 20px display title, the hairline under it) at the same
 * height as the list's header beside it, so the two read as one bar. A back
 * arrow only below a section's top level; the list is always one column away.
 */
function PaneHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <div className="ws-head sticky top-[var(--ws-topbar-h)] z-20 hidden min-h-14 items-center gap-5 px-4 py-2.5 lg:flex">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="ws-press -ml-2 rounded-full p-2 text-heading transition-colors hover:bg-white/10"
        >
          <IconArrowLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="ws-display truncate text-xl">{title}</h2>
        {subtitle && <p className="truncate text-[13px] text-meta">{subtitle}</p>}
      </div>
    </div>
  );
}

/** A detail row — text block + trailing control. */
function DetailRow({
  title,
  description,
  trailing,
  onClick,
}: {
  title: string;
  description: string;
  trailing: React.ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 border-b border-white/15 px-4 py-6 text-left",
        onClick && "transition-colors hover:bg-white/[0.03]",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 pr-4">
        <p className="text-base font-bold leading-6 text-white">{title}</p>
        <p className="text-[13px] font-normal leading-5 text-white/50">
          {description}
        </p>
      </div>
      <div className="shrink-0">{trailing}</div>
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Privacy & Security — main view
// ---------------------------------------------------------------------------

function PrivacyMain({
  personalizePlaces,
  onPersonalizePlacesChange,
  personalizeDisabled,
  visibilityOnSpace,
  onVisibilityOnSpaceChange,
  visibilityDisabled,
  onOpenLocation,
  onOpenChat,
}: {
  personalizePlaces: boolean;
  onPersonalizePlacesChange: (v: boolean) => void;
  personalizeDisabled: boolean;
  visibilityOnSpace: boolean;
  onVisibilityOnSpaceChange: (v: boolean) => void;
  visibilityDisabled: boolean;
  onOpenLocation: () => void;
  onOpenChat: () => void;
}) {
  return (
    <div className="flex flex-col">
      <DetailRow
        title="Personalize based on places you've been"
        // The service reads ONLY the place a person put on their profile —
        // nothing records where anybody goes — so the line says exactly that.
        description="Personalize your feed using the place on your profile."
        trailing={
          <Toggle
            disabled={personalizeDisabled}
            title={personalizeDisabled ? SAVING_SOON : undefined}
            checked={personalizePlaces}
            onChange={onPersonalizePlacesChange}
            label="Personalize based on places you've been"
          />
        }
      />
      <DetailRow
        title="Location"
        description="Manage the location associated with your account."
        onClick={onOpenLocation}
        trailing={
          <IconSettingsChevron className="size-6 shrink-0 text-white/50" />
        }
      />
      <DetailRow
        title="Chat"
        description="Manage who can message you directly."
        onClick={onOpenChat}
        trailing={
          <IconSettingsChevron className="size-6 shrink-0 text-white/50" />
        }
      />
      <DetailRow
        title="Visibility on Space"
        description="Allow followers to see which Spaces you're listening to."
        trailing={
          <Toggle
            disabled={visibilityDisabled}
            title={visibilityDisabled ? SAVING_SOON : undefined}
            checked={visibilityOnSpace}
            onChange={onVisibilityOnSpaceChange}
            label="Visibility on Space"
          />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy — Location sub-view
// ---------------------------------------------------------------------------

function LocationView({
  country,
  onCountryChange,
  countryDisabled,
  precision,
  onPrecisionChange,
  precisionDisabled,
}: {
  /** ISO code, or null when none is set. */
  country: string | null;
  onCountryChange: (code: string | null) => void;
  countryDisabled: boolean;
  precision: LocationPrecision;
  onPrecisionChange: (v: LocationPrecision) => void;
  precisionDisabled: boolean;
}) {
  // Named by the platform in the reader's language; built once per mount.
  const options = useMemo(() => countryOptions(), []);
  return (
    <div className="flex flex-col">
      <label className="flex w-full items-center justify-between gap-4 border-b border-white/15 px-4 py-5">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-bold leading-6 text-white">Country</span>
          <span className="text-[13px] leading-5 text-white/50">The country on your profile.</span>
        </span>
        <select
          value={country ?? ""}
          disabled={countryDisabled}
          title={countryDisabled ? SAVING_SOON : undefined}
          onChange={(event) => onCountryChange(event.target.value || null)}
          className="max-w-[55%] shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[14px] text-white outline-none transition-colors focus:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">Not set</option>
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-8 flex h-6 items-center px-4">
        <p className="text-sm font-normal leading-[16.5px] text-white/50">Show on your profile</p>
      </div>
      {LOCATION_CHOICES.map((choice) => {
        const checked = precision === choice.key;
        return (
          <button
            key={choice.key}
            onClick={() => onPrecisionChange(choice.key)}
            disabled={precisionDisabled}
            aria-pressed={checked}
            title={precisionDisabled ? SAVING_SOON : undefined}
            className="flex h-16 w-full items-center justify-between border-b border-white/15 px-4 py-4 text-left transition-colors hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <p className="text-base font-bold leading-6 text-white">
              {choice.label}
            </p>
            {checked ? (
              <IconCheckboxChecked className="size-4 text-spotlight" />
            ) : (
              <IconCheckbox className="size-4 text-white/50" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription plans
// ---------------------------------------------------------------------------

type Plan = {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  isCurrent?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Square Basic",
    price: "Free",
    description:
      "Kick off your journey with all the basics you need to get started.",
    features: [
      "Access to core Square platform",
      "Meet and network with new people",
      "Access to core AI tools",
      "Access to core Square platform",
      "Meet and network with new people",
      "Access to core AI tools",
    ],
    isCurrent: true,
  },
  {
    name: "King and Queen",
    price: "$100",
    period: "/month",
    description:
      "Kick off your journey with all the basics you need to get started.",
    features: [
      "All basic feature",
      "Profile verification tag",
      "Unlock king and queen badge",
      "Access to core Square platform",
      "Meet and network with new people",
      "Access to core AI tools",
    ],
  },
  {
    name: "Lord Emperor",
    price: "$500",
    period: "/month",
    description:
      "Kick off your journey with all the basics you need to get started.",
    features: [
      "All king and queen feature",
      "Meet and network with new people",
      "Access to core AI tools",
      "Access to core Square platform",
      "Meet and network with new people",
      "Access to core AI tools",
    ],
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-6">
      {/* Header row: plan name + CURRENT badge */}
      <div className="flex items-center justify-between">
        <p className="text-base font-medium text-white/50">{plan.name}</p>
        {plan.isCurrent && (
          <span className="rounded-[30px] bg-gradient-to-r from-create to-create-deep px-3 py-1 text-xs font-medium text-white">
            CURRENT
          </span>
        )}
      </div>

      {/* Price */}
      <div className="mt-4 flex items-baseline">
        <span className="text-[40px] font-bold leading-normal text-[#f6f6f6]">
          {plan.price}
        </span>
        {plan.period && (
          <span className="ml-2 text-[17px] font-normal text-white/50 opacity-80">
            {plan.period}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="mt-2 text-sm font-light text-white/50">
        {plan.description}
      </p>

      {/* Features list */}
      <div className="mt-8 flex flex-col gap-4">
        {plan.features.map((feature, i) => (
          <div key={i} className="flex items-center gap-4">
            <IconCheckCircle className="size-4 shrink-0 text-create" />
            <span className="text-base font-normal text-white">{feature}</span>
          </div>
        ))}
      </div>

      {/* Upgrade — only for non-current plans. VISIBLE AND INERT: there is no
          subscription or billing on the service, so a live button would be a
          promise nothing can keep. A real disabled button, with the reason. */}
      {!plan.isCurrent && (
        <button
          type="button"
          disabled
          title="Subscriptions are coming soon"
          className="mt-8 flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-gradient-to-r from-create to-create-deep text-base font-semibold text-[#f6f6f6] opacity-60"
        >
          Upgrade
          <span className="rounded-full border border-white/30 px-2 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide">
            Coming soon
          </span>
        </button>
      )}
    </div>
  );
}

function SubscriptionDetail() {
  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      {PLANS.map((plan) => (
        <PlanCard key={plan.name} plan={plan} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help Centre detail
// ---------------------------------------------------------------------------

const HELP_ROWS: Array<{
  label: string;
  view?: HelpView;
  external?: boolean;
}> = [
  { label: "Terms of Service", view: "terms" },
  { label: "Privacy Policy", view: "privacy-policy" },
  { label: "Community Guidelines", view: "community-guidelines" },
  { label: "Contact us", view: "contact" },
];

function HelpCentreMain({ onNavigate }: { onNavigate: (v: HelpView) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {HELP_ROWS.map((row) => (
        <button
          key={row.label}
          onClick={() => row.view && onNavigate(row.view)}
          disabled={!row.view}
          className="flex h-16 w-full items-center justify-between border-b border-white/15 px-4 py-4 text-left transition-colors hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
        >
          <p className="text-base font-bold leading-6 text-white">
            {row.label}
          </p>
          {row.external ? (
            <IconExternalLink className="size-6 shrink-0 text-white/50" />
          ) : (
            <IconSettingsChevron className="size-6 shrink-0 text-white/50" />
          )}
        </button>
      ))}
    </div>
  );
}

function TermsOfServiceView() {
  return (
    <div>
      <p className="px-4 pt-6 text-sm leading-[16.5px] text-white/50">
        Created on 8 September, 2026
      </p>
      <div className="px-4 pt-6 pb-12 text-[15px] font-normal leading-6 text-white">
        <p className="mb-4 font-bold">1. Acceptance of Terms</p>
        <p className="mb-4">
          By accessing or using Square, Market Square, or Gistrooms
          (collectively, the &quot;Platform&quot;), you agree to be bound by
          these Terms of Service. If you do not agree, you may not access or use
          our services.
        </p>

        <p className="mb-2 font-bold">2. Account Registration &amp; Security</p>
        <ul className="mb-4 list-disc space-y-1 pl-6">
          <li>
            You must be at least 13 years old (or the legal age in your
            jurisdiction) to create an account.
          </li>
          <li>
            You are responsible for safeguarding your login credentials and for
            all activities that occur under your account.
          </li>
          <li>
            You agree to provide accurate, current, and complete profile
            information.
          </li>
        </ul>

        <p className="mb-2 font-bold">3. User Content &amp; Conduct</p>
        <ul className="mb-4 list-disc space-y-1 pl-6">
          <li>
            Ownership: You retain ownership of the content, audio streams, and
            messages you create or host on the Platform.
          </li>
          <li>
            License: By hosting live audio, posting, or sharing content, you
            grant Square a non-exclusive, worldwide, royalty-free license to
            host, display, and distribute your content across the Platform.
          </li>
          <li>
            Prohibited Behavior: You may not host or post content that is
            illegal, harmful, harassing, defamatory, or infringes on third-party
            intellectual property rights. We reserve the right to terminate
            accounts that violate community standards.
          </li>
        </ul>

        <p className="mb-2 font-bold">4. Tips and Digital Transactions</p>
        <ul className="mb-4 list-disc space-y-1 pl-6">
          <li>
            Features such as creator tipping or paid Gistrooms are subject to
            transaction fees where applicable.
          </li>
          <li>
            All tips and virtual purchases are final and non-refundable unless
            required by law.
          </li>
        </ul>

        <p className="mb-2 font-bold">
          5. Service Availability &amp; Modifications
        </p>
        <p className="mb-4">
          We reserve the right to modify, suspend, or discontinue any feature or
          portion of the Platform at any time without prior notice.
        </p>

        <p className="mb-2 font-bold">6. Limitation of Liability</p>
        <p className="mb-4">
          To the maximum extent permitted by law, Square and its affiliates
          shall not be liable for any indirect, incidental, or consequential
          damages resulting from your use of or inability to use the Platform.
        </p>

        <p className="mb-2 font-bold">7. Termination</p>
        <p className="mb-4">
          We reserve the right to suspend or terminate your access to the
          Platform at our sole discretion, without notice, for conduct that
          violates these Terms.
        </p>

        <p className="mb-2 font-bold">8. Governing Law</p>
        <p>
          These Terms are governed by and construed in accordance with applicable
          laws, without regard to conflict of law principles.
        </p>
      </div>
    </div>
  );
}

/**
 * Contact us — both ways the support team can be reached: a chat with the
 * official TsionArk Support account, and the email address that account
 * publishes. The chat row is inert on a server without the account; email
 * always works.
 */
function ContactView({ onChat, chatBusy }: { onChat?: () => void; chatBusy: boolean }) {
  return (
    <div className="flex flex-col">
      <DetailRow
        title="Chat with TsionArk Support"
        description={
          !onChat
            ? "Chat support is coming soon."
            : chatBusy
              ? "Opening chat…"
              : "Opens a chat with the official support account."
        }
        onClick={onChat && !chatBusy ? onChat : undefined}
        trailing={<IconSettingsChevron className={cn("size-6 shrink-0", onChat ? "text-white/50" : "text-white/20")} />}
      />
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="flex w-full items-center gap-4 border-b border-white/15 px-4 py-6 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2 pr-4">
          <p className="text-base font-bold leading-6 text-white">Email support</p>
          <p className="text-[13px] font-normal leading-5 text-white/50">{SUPPORT_EMAIL}</p>
        </div>
        <IconExternalLink className="size-6 shrink-0 text-white/50" />
      </a>
    </div>
  );
}

/** A policy page from `lib/legal.ts`, in the Terms of Service's own layout. */
function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  return (
    <div>
      <p className="px-4 pt-6 text-sm leading-[16.5px] text-white/50">{doc.updated}</p>
      <div className="px-4 pt-6 pb-12 text-[15px] font-normal leading-6 text-white">
        {doc.sections.map((section, index) => (
          <section key={section.heading} className="mb-4">
            <p className="mb-2 font-bold">
              {index + 1}. {section.heading}
            </p>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mb-2">
                {paragraph}
              </p>
            ))}
            {section.points && (
              <ul className="mb-2 list-disc space-y-1 pl-6">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SettingsScreen({ username }: { username: string }) {
  const { ready, authenticated } = useAuth();
  const me = useMe();
  const router = useRouter();
  const logout = useLogout();
  /*
    SETTINGS ARE YOUR OWN. The route carries a username, so
    `/u/<someone-else>/settings` is a URL anybody can type — it lands on the
    reader's own settings instead of drawing a page that looks like the other
    person's.
  */
  useEffect(() => {
    if (me.data && me.data.username.toLowerCase() !== username.toLowerCase()) {
      router.replace(sq(`/u/${me.data.username}/settings`));
    }
  }, [me.data, username, router]);

  const [active, setActive] = useState<Section | null>(null);
  const [privacyView, setPrivacyView] = useState<PrivacyView>("main");
  const [helpView, setHelpView] = useState<HelpView>("main");
  const [house, setHouse] = useState<{ id: string; title: string } | null>(null);
  /*
    EVERY STAGE DECIDES FROM WHAT THE SERVICE SENDS. Notifications and Chat
    read and write `/me/settings` (a 404 means not deployed here). Location is
    live once that payload carries `privacy` (stage 3), and the two privacy
    toggles once `privacy` carries their keys (stage 4). Until then each
    control is disabled with the reason — never a switch that saves nothing.
  */
  const settings = useSettings();
  const save = useUpdateSettings();
  const push = usePushNotifications();
  const updateMe = useUpdateMe();
  /* Contact us: the official support account, looked up by username. */
  const support = useProfile(SUPPORT_USERNAME);
  const openChat = useOpenConversation();
  const settingsLive = settings.isSuccess;
  const settingsGone = settings.isError && errorCode(settings.error) === "NOT_FOUND";
  const privacy = settings.data?.privacy;
  const stage3 = Boolean(privacy);
  const stage4 = privacy?.showListening !== undefined && privacy?.personalizeByPlace !== undefined;
  /* A house's notification levels (stage 2b), read only while one is open. */
  const houseSettings = useHouseNotificationSettings(house?.id ?? "", house !== null);
  const saveHouse = useUpdateHouseNotificationSettings(house?.id ?? "");
  const houseGone = houseSettings.isError && errorCode(houseSettings.error) === "NOT_FOUND";

  const openSection = (next: Section) => {
    setPrivacyView("main");
    setHelpView("main");
    setHouse(null);
    setActive(next);
    window.scrollTo({ top: 0 });
  };

  /** One level up: sub-page → section → the list (the last step only below lg). */
  const stepBack = () => {
    if (house) setHouse(null);
    else if (active === "privacy" && privacyView !== "main") setPrivacyView("main");
    else if (active === "help" && helpView !== "main") setHelpView("main");
    else setActive(null);
    window.scrollTo({ top: 0 });
  };

  if (ready && !authenticated) {
    return (
      <>
        <ColumnHeader title="Settings" back />
        <div className="px-4 py-6">
          <SignInPrompt
            title="Sign in to see your settings"
            body="Your notifications, privacy and plan live here."
          />
        </div>
      </>
    );
  }

  const title =
    active === null
      ? "Settings"
      : active === "notifications" && house
        ? house.title
        : active === "privacy" && privacyView === "location"
          ? "Location"
          : active === "privacy" && privacyView === "chat"
            ? "Chat"
            : active === "help" && helpView !== "main"
              ? HELP_TITLES[helpView]
              : (SECTIONS.find((section) => section.key === active)?.title ?? "Settings");
  const subtitle = active === "notifications" && house ? "House notifications" : undefined;
  /** Below a section's top level — the second pane's header gets a back arrow. */
  const subLevel =
    house !== null ||
    (active === "privacy" && privacyView !== "main") ||
    (active === "help" && helpView !== "main");

  const onSettingsScreen = (active === "notifications" && !house) || active === "privacy";
  const savingSoon =
    (active === "notifications" && house !== null && houseGone) ||
    (onSettingsScreen && settingsGone) ||
    (active === "privacy" && privacyView === "main" && settingsLive && !stage4) ||
    (active === "privacy" && privacyView === "location" && settingsLive && !stage3);
  const loadFailed =
    (onSettingsScreen && settings.isError && !settingsGone) ||
    (active === "notifications" && house !== null && houseSettings.isError && !houseGone);

  return (
    <div className="lg:flex lg:min-h-[calc(var(--ws-vvh,100dvh)-var(--ws-crumb-h)-var(--ws-nav-h))]">
      {/* THE LIST — the whole page until a setting is chosen; then, from lg,
          the narrow left pane beside it (below lg it steps aside). */}
      <div
        className={cn(
          active === null ? "w-full" : "hidden lg:block lg:w-[360px] lg:shrink-0 lg:border-r lg:border-white/10"
        )}
      >
        <ColumnHeader title="Settings" back />
        <nav className={cn("flex flex-col", active === null ? "gap-4" : "gap-0")} aria-label="Settings">
          {SECTIONS.map((section) => (
            <MenuRow
              key={section.key}
              section={section}
              isActive={active === section.key}
              onClick={() => openSection(section.key)}
            />
          ))}
        </nav>

        {/*
          LOG OUT — an account ACTION, not a preference, so it sits APART at the
          foot of the list rather than among the toggles inside a section. It is
          also the one place a person can sign out of on desktop now that the
          account menu dropped it (app-shell, 2026-09-22), so it earns a real
          home here. `useLogout` carries the whole flow — the "you're live"
          confirm, the session teardown and the hard reload to /auth — so this
          is only the trigger. Destructive tone is house-menu's #FF6B6B, the
          app's own for a row like this; it is never the reserved --color-like
          (a heart) or --color-down (a value delta).
        */}
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-4 flex h-[81px] w-full items-center gap-4 border-y border-white/15 px-4 py-6 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#FF6B6B]/10">
            <IconLogout className="size-5 text-[#FF6B6B]" />
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-base font-bold leading-4 text-[#FF6B6B]">Log out</p>
            <p className="text-[13px] font-normal leading-5 text-white/50">
              Sign out of your account on this device.
            </p>
          </div>
        </button>
      </div>

      {/* THE CHOSEN SETTING — only once one is chosen: the second column from
          lg; below lg it takes the list's place, with the shared header and its
          back arrow. */}
      {active !== null && (
        <div className="min-w-0 flex-1">
          <div className="lg:hidden">
            <ColumnHeader title={title} subtitle={subtitle} back onBack={stepBack} />
          </div>
          <PaneHeader title={title} subtitle={subtitle} onBack={subLevel ? stepBack : undefined} />

          <div className="flex flex-col pb-10">
            {/* One quiet line, only where there are controls that cannot save. */}
            {savingSoon && (
              <p className="px-4 pt-4 pb-2 text-[13px] leading-5 text-white/50">
                Saving these settings is coming soon.
              </p>
            )}
            {loadFailed && (
              <p className="px-4 pt-4 pb-2 text-[13px] leading-5 text-white/50">
                Couldn&apos;t load your settings.{" "}
                <button
                  type="button"
                  onClick={() => void (house ? houseSettings.refetch() : settings.refetch())}
                  className="font-bold text-white underline-offset-2 hover:underline"
                >
                  Try again
                </button>
              </p>
            )}

            {active === "subscription" && <SubscriptionDetail />}

            {active === "notifications" &&
              (house ? (
                <HouseNotificationsView
                  messagesFrom={houseSettings.data?.messages ?? "all"}
                  onMessagesFromChange={(value) => saveHouse.mutate({ messages: value })}
                  gistroomsFrom={houseSettings.data?.rooms ?? "all"}
                  onGistroomsFromChange={(value) => saveHouse.mutate({ rooms: value })}
                  disabled={!houseSettings.isSuccess}
                />
              ) : (
                <NotificationsView
                  friendsRoom={settings.data?.notifications.friendsRooms ?? true}
                  onFriendsRoomChange={(value) => save.mutate({ notifications: { friendsRooms: value } })}
                  directNotifications={settings.data?.notifications.direct ?? true}
                  onDirectNotificationsChange={(value) => save.mutate({ notifications: { direct: value } })}
                  onOpenHouse={(next) => {
                    setHouse(next);
                    window.scrollTo({ top: 0 });
                  }}
                  push={push}
                  emailDigest={{
                    // Present once the service has email (stage B). Re-read,
                    // never cached: the email's unsubscribe link turns it off.
                    checked: settings.data?.notifications.emailDigest ?? false,
                    disabled: settings.data?.notifications.emailDigest === undefined,
                    description:
                      settings.data?.notifications.emailDigest === undefined
                        ? "Email summaries aren't available here yet."
                        : "One email a day at most, only when something new is waiting.",
                    onChange: (value) => save.mutate({ notifications: { emailDigest: value } }),
                  }}
                  disabled={!settingsLive}
                />
              ))}

            {active === "privacy" && privacyView === "location" && (
              <LocationView
                country={me.data?.country ?? null}
                onCountryChange={(code) => updateMe.mutate({ country: code })}
                countryDisabled={!stage3 || !me.data || updateMe.isPending}
                precision={privacy?.locationPrecision ?? "city_region_country"}
                onPrecisionChange={(value) => save.mutate({ privacy: { locationPrecision: value } })}
                precisionDisabled={!stage3}
              />
            )}
            {active === "privacy" && privacyView === "chat" && (
              <ChatView
                messagesFrom={settings.data?.chat.messagesFrom ?? "everyone"}
                onMessagesFromChange={(value) => save.mutate({ chat: { messagesFrom: value } })}
                allowHouseMembers={settings.data?.chat.allowHouseMembers ?? true}
                onAllowHouseMembersChange={(value) => save.mutate({ chat: { allowHouseMembers: value } })}
                allowPastAudience={settings.data?.chat.allowPastAudience ?? false}
                onAllowPastAudienceChange={(value) => save.mutate({ chat: { allowPastAudience: value } })}
                addToHousesFrom={settings.data?.chat.addToHousesFrom}
                onAddToHousesFromChange={(value) => save.mutate({ chat: { addToHousesFrom: value } })}
                disabled={!settingsLive}
              />
            )}
            {active === "privacy" && privacyView === "main" && (
              <PrivacyMain
                personalizePlaces={privacy?.personalizeByPlace ?? true}
                onPersonalizePlacesChange={(value) => save.mutate({ privacy: { personalizeByPlace: value } })}
                personalizeDisabled={!stage4}
                visibilityOnSpace={privacy?.showListening ?? true}
                onVisibilityOnSpaceChange={(value) => save.mutate({ privacy: { showListening: value } })}
                visibilityDisabled={!stage4}
                onOpenLocation={() => setPrivacyView("location")}
                onOpenChat={() => setPrivacyView("chat")}
              />
            )}

            {active === "help" && helpView === "main" && <HelpCentreMain onNavigate={setHelpView} />}
            {active === "help" && helpView === "contact" && (
              <ContactView
                onChat={
                  support.data
                    ? () =>
                        openChat.mutate(support.data, {
                          onSuccess: (conversation) => router.push(sq(`/messages?c=${conversation.id}`)),
                        })
                    : undefined
                }
                chatBusy={openChat.isPending}
              />
            )}
            {active === "help" && helpView === "terms" && <TermsOfServiceView />}
            {active === "help" && helpView === "privacy-policy" && <LegalDocumentView doc={PRIVACY_POLICY} />}
            {active === "help" && helpView === "community-guidelines" && <LegalDocumentView doc={COMMUNITY_GUIDELINES} />}
          </div>
        </div>
      )}
    </div>
  );
}
