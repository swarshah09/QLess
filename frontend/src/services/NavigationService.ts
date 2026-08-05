import type { NavProvider } from '@/types';

export interface NavProviderOption {
  id: NavProvider;
  label: string;
}

// NavigationService — builds external navigation deep-links. No turn-by-turn.
export const NavigationService = {
  // Return providers appropriate to the current platform where possible.
  getProviders(): NavProviderOption[] {
    const ua =
      typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const providers: NavProviderOption[] = [
      { id: 'google', label: 'Google Maps' },
      { id: 'waze', label: 'Waze' },
    ];
    if (isIOS) providers.push({ id: 'apple', label: 'Apple Maps' });
    providers.push({ id: 'default', label: 'Default Maps' });
    return providers;
  },

  buildUrl(
    provider: NavProvider,
    lat: number,
    lng: number,
    stationName: string,
  ): string {
    const q = encodeURIComponent(stationName);
    switch (provider) {
      case 'google':
        return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${q}`;
      case 'apple':
        return `https://maps.apple.com/?daddr=${lat},${lng}&q=${q}`;
      case 'waze':
        return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
      case 'default':
      default:
        return `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
    }
  },

  open(provider: NavProvider, lat: number, lng: number, stationName: string): void {
    const url = this.buildUrl(provider, lat, lng, stationName);
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },
};
