import type { Metadata, Viewport } from "next";
import "./globals.css";

// Installs on the iPhone Home Screen as "Tasks" (Safari → Share → Add to Home Screen).
export const metadata: Metadata = {
  metadataBase: new URL("https://tasks.jascui.com"),
  title: "Tasks",
  description: "Everything outstanding: deadlines, payments, subscriptions and trips.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Tasks", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
