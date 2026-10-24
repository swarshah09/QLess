import type { Metadata, Viewport } from 'next';
import { Manrope, Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '@/styles/globals.scss';
import { Providers } from './providers';
import { DeviceFrame } from '@/components/layout/DeviceFrame';
import { ServiceWorker } from '@/components/layout/ServiceWorker';
import { ApiWarmup } from '@/components/layout/ApiWarmup';
import { API_ORIGIN } from '@/lib/api/config';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'QLess — Fuel Up. Wait Less.',
  description:
    'Live CNG availability, queues and pressure near you. Know before you queue.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // `capable` is deliberately omitted: Next emits the deprecated
    // `apple-mobile-web-app-capable` tag for it. The standard
    // `mobile-web-app-capable` below covers iOS too on current Safari.
    statusBarStyle: 'default',
    title: 'QLess',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${inter.variable}`}>
      <head>
        {/* The API lives on another origin; opening the connection with the
            HTML saves DNS + TCP + TLS on the first data request. Credentialed,
            because the API client fetches with credentials: 'include' and
            browsers keep separate connection pools for the two modes. */}
        <link rel="preconnect" href={API_ORIGIN} crossOrigin="use-credentials" />
      </head>
      <body>
        <Providers>
          <DeviceFrame>{children}</DeviceFrame>
        </Providers>
        <ServiceWorker />
        <ApiWarmup />
        {/* Page views (Web Analytics) and Core Web Vitals — LCP, INP, CLS,
            FCP, TTFB — from real visits (Speed Insights). Both must also be
            enabled per project in the Vercel dashboard. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
