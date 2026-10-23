import type { Metadata, Viewport } from "next";
import { Archivo_Black, Inter } from "next/font/google";
import "./globals.css";

const archivo = Archivo_Black({ variable: "--font-archivo", subsets: ["latin"], weight: "400", display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

// Every page shows live auction data, so nothing is rendered ahead of time (and a build never touches the database).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "StoryChurch Auction", template: "%s · StoryChurch Auction" },
  description: "Bid on silent and live auction items at the StoryChurch fundraiser — right from your phone.",
  icons: { icon: "/brand/storychurch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#f7f5ef", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
