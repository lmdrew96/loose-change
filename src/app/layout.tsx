import type { Metadata, Viewport } from "next";
import { Nunito, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { InstallPrompt } from "@/components/InstallPrompt";
import { OfflineSyncBootstrap } from "@/components/OfflineSyncBootstrap";
import { OfflineNotice } from "@/components/OfflineNotice";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const yellowYaks = localFont({
  src: "../../public/Assets/YellowYaksYelpAndYodelMedium-Zaqx.ttf",
  variable: "--font-yellow-yaks",
  weight: "500",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Loose Change",
  description: "Frictionless voice/text capture for stray thoughts.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Loose Change",
  },
};

export const viewport: Viewport = {
  themeColor: "#15342E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${nunito.variable} ${geistMono.variable} ${yellowYaks.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <ConvexClientProvider>
            <ToastProvider>
              <OfflineNotice />
              {children}
              <OfflineSyncBootstrap />
            </ToastProvider>
          </ConvexClientProvider>
          <ServiceWorkerRegistration />
          <InstallPrompt />
        </body>
      </html>
    </ClerkProvider>
  );
}
