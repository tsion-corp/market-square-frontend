"use client";

import { useState } from "react";
import { DecaneKit } from "decane-connect-kit";
import { SQUARE_WALLET_PROTECTION } from "@/lib/wallet-protection";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { createQueryClient } from "@/lib/query-client";
import { DEMO_AUTH } from "@/lib/auth-mode";
import { useDecaneCredentials } from "@/hooks/use-decane-credentials";
import { DecaneRecoveryHost } from "@/components/providers/decane-recovery-host";
import { DecaneTokenBridge } from "@/components/providers/decane-token-bridge";
import { SquareHandoff } from "@/components/providers/square-handoff";
import {
  collectRotatedRecoveryPassword,
  deliverRecoveryFile,
  promptForRecoveryFile,
  promptPin,
  promptUnlockPassword,
} from "@/lib/decane-recovery";

/**
 * The chains the embedded wallet holds value on, in Decane's chain-id format.
 * Base is where every Square payment happens; mainnet and Solana are there so
 * one Decane identity is the same wallet set it is in wsws.
 *
 * CELO IS HERE FOR THE GAME PASS, AND FOR NOTHING ELSE. A player who claims a
 * name in a chat signs `mint(username)` on Celo, where GameArena's pass lives.
 * Square holds no value there and pays no gas there — that is GameArena's
 * side — but the chain has to be DECLARED or the session refuses to sign for
 * it at all. It refuses with "Request exceeds defined limit", which reads like
 * a spending cap and is really "you never asked for this chain", so it is
 * written down here rather than rediscovered.
 *
 * The set is declared when a session OPENS, so adding one only reaches readers
 * whose session is opened after this ships — an existing session keeps the set
 * it was created with until it is renewed.
 */
const DECANE_CHAINS = ["evm:8453", "evm:1", "evm:42220", "solana:mainnet"];

function AuthProvider({ children }: { children: React.ReactNode }) {
  if (DEMO_AUTH) return <>{children}</>;
  return <DecaneAuthProvider>{children}</DecaneAuthProvider>;
}

/**
 * Decane, configured the way wsws configures it — both apps are one identity.
 *
 * `showStatusOverlay: false` for the same reason `showWalletUIs: false` was set
 * under Privy: the app owns what the reader sees. The recovery callbacks are
 * not optional: without `promptUnlockPassword` a device with no passkey cannot
 * open its wallet, and without `onRecoveryRotated` the kit refuses to run
 * recovery at all. `DecaneRecoveryHost` renders the dialogs they wait on.
 *
 * The kit cannot mount without its key, and everything below calls kit hooks,
 * so nothing renders until the one same-origin round trip for it lands.
 */
function DecaneAuthProvider({ children }: { children: React.ReactNode }) {
  const decane = useDecaneCredentials();
  if (!decane)
    return <div className="min-h-dvh bg-[#0F0F0F]" aria-busy="true" />;
  return (
    <DecaneKit
      config={{
        appId: decane.appId,
        mode: "social",
        theme: "dark",
        social: {
          apiKey: decane.apiKey,
          authMethods: ["google", "email", "x"],
          chains: DECANE_CHAINS,
          /*
            CELO NEEDS AN ENDPOINT, NOT JUST A DECLARATION.

            Decane carries its own RPC for the chains it ships with; Celo is
            not one of them, and it refuses with "No RPC URL for evm:42220"
            rather than guessing. The other three chains keep Decane's own
            endpoints — only the one it has none for is supplied here.

            Celo's public node, which is also what GameArena read through. No
            key, nothing of ours on it, and it carries ONE transaction: the
            claim that mints a player's game pass.
          */
          rpcUrls: { "evm:42220": "https://forno.celo.org" },
          showStatusOverlay: false,
          // The identity tier: no passkey, no password, nothing stored on the
          // device — ever. Square is a place people read and post first, and
          // signing in is the whole ceremony. Existing readers port on their
          // next sign-in with the same wallet; see lib/wallet-protection for
          // the security statement and why the send gate is a no-op here.
          protection: SQUARE_WALLET_PROTECTION,
          // Keep the session across tabs, not just across reloads. Without it
          // closing the tab reads as being signed out, which is most of what
          // people meant by "it signs me out too quickly" — the enclave session
          // is still valid for hours at that point.
          //
          // The trade: the session handle is the signing credential, so this
          // widens where it can be read from one tab to the whole origin. Square
          // defers device protection anyway, so the wallet is protected at first
          // use rather than at sign-in; this does not change that.
          resumeSessionAcrossTabs: true,
          onRecoveryRotated: collectRotatedRecoveryPassword,
          onRecoveryFileReady: deliverRecoveryFile,
          promptForRecoveryFile,
          promptPin,
          promptUnlockPassword,
        },
      }}
    >
      {children}
      <SquareHandoff />
      <DecaneTokenBridge />
      <DecaneRecoveryHost />
    </DecaneKit>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          theme="dark"
          position="bottom-center"
          toastOptions={{
            style: {
              background: "#0c0c0e",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#fff",
            },
          }}
        />
      </QueryClientProvider>
    </AuthProvider>
  );
}
