import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { ConsoleWelcome } from "@/components/ConsoleWelcome"
import { DevErrorSuppressor } from "@/components/DevErrorSuppressor";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { PermissionPrompts } from "@/components/PermissionPrompts";
import { PushTokenRegistration } from "@/components/PushTokenRegistration";
import { CookieConsentBanner } from "@/components/CookieConsent";

// Using system font stack to avoid Google Fonts network dependency during build
const fontClassName = "font-sans";

export const metadata: Metadata = {
  title: "MySchools - Comprehensive School Management System",
  description: "A modern, full-featured school management system for administrators, teachers, and students.",
  keywords: ["school management", "education", "student portal", "teacher portal", "admin dashboard"],
  authors: [{ name: "MySchools" }],
  creator: "MySchools",
  publisher: "MySchools",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/icon-transbg.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.png", type: "image/png" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/apple-icon.png", sizes: "512x512", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://myschools.com",
    title: "MySchools - Comprehensive School Management System",
    description: "A modern, full-featured school management system for administrators, teachers, and students.",
    siteName: "MySchools",
  },
  twitter: {
    card: "summary_large_image",
    title: "MySchools - Comprehensive School Management System",
    description: "A modern, full-featured school management system for administrators, teachers, and students.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${fontClassName} antialiased`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider>
              <OfflineBanner />
              <PermissionPrompts />
              <PushTokenRegistration />
              <ConsoleWelcome />
              <DevErrorSuppressor />
              <CookieConsentBanner />
              {children}
              <Toaster position="top-right" richColors />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

