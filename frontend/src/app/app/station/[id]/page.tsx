import StationDetailsPage from './StationDetails';

// The page is rendered entirely on the client, so every station id shares the
// same HTML shell. With no params listed at build time and dynamicParams on,
// each id is rendered once on its first request and then served as a static
// page, instead of invoking a server function on every visit and client-side
// navigation (and paying its cold start).
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export default function Page() {
  return <StationDetailsPage />;
}
