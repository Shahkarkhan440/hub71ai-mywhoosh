import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NESQA — Voice Grocery Assistant",
  description: "Abu Dhabi’s AI grocery shopping agent. Speak your list, compare vendors, and build the best-value basket with NESQA.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
