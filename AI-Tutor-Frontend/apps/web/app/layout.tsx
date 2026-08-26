import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { CreditsProvider } from '@/lib/contexts/credits-context';
import { DbStatusProvider } from '@/lib/contexts/db-status-context';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';

const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-sans',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'AI-Tutor',
  description:
    'The open-source AI interactive classroom. Upload a PDF to instantly generate an immersive, multi-agent learning experience.',
};

/**
 * Blocking inline script — runs synchronously before first paint.
 *
 * Reads the saved theme from localStorage and applies the `dark` class to
 * <html> immediately, preventing a flash of the incorrect (light) theme on
 * hard refresh, navigation, and redirects. The ThemeProvider reads the
 * already-applied class on mount so React never resets it.
 *
 * The script also stores the resolved preference in data attributes so the
 * ThemeProvider can initialize its state without re-reading localStorage.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t===null){t='system';}var s;if(t==='system'){s=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}else if(t==='dark'){s='dark';}else{s='light';}var r=document.documentElement;if(s==='dark'){r.classList.add('dark');}else{r.classList.remove('dark');}r.setAttribute('data-theme',t);r.setAttribute('data-resolved-theme',s);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <I18nProvider>
            <CreditsProvider>
              <DbStatusProvider>
                <ServerProvidersInit />
                {children}
                <Toaster />
              </DbStatusProvider>
            </CreditsProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
