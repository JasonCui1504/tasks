import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Same typeface as jascui.com.
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

// Installs on the iPhone Home Screen as "Tasks" (Safari → Share → Add to Home Screen).
export const metadata: Metadata = {
  metadataBase: new URL("https://tasks.jascui.com"),
  title: "Tasks",
  description: "Everything outstanding: deadlines, payments, subscriptions and trips.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Tasks", statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1110",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
