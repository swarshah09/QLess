import type { Metadata, Viewport } from 'next';
import { Manrope, Inter } from 'next/font/google';
import '@/styles/globals.scss';
import { Providers } from './providers';
import { DeviceFrame } from '@/components/layout/DeviceFrame';
import { ServiceWorker } from '@/components/layout/ServiceWorker';

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
      <body>
        <Providers>
          <DeviceFrame>{children}</DeviceFrame>
        </Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
