import type { Metadata, Viewport } from "next";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GhostShift — Epoch-Fenced Handoff Audit Desk",
  description:
    "Interactive audit workbench showing how GhostShift blocks split-brain zombie agent writes on NEAR with monotonic epoch fencing, Yield & Resume, scoped function-call keys, signed offline verifier fixtures, live Testnet reads and NEAR Intents 1Click quote previews.",
};

export const viewport: Viewport = {
  themeColor: "#121211",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    // Browser auto-translation rewrote identifiers ("Epoch fencing" became a fencing-sport term, "NEAR Intents"
    // became "near intentions"), which misstates what the page verifies; the UI copy is English by design.
    <html lang="en" translate="no">
      <body>{children}</body>
    </html>
  );
}
