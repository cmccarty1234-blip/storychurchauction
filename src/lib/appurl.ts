/**
 * The app's public base URL (used in QR codes and to decide whether cookies are Secure).
 * An explicit NEXT_PUBLIC_APP_URL wins; on Vercel the production domain is supplied automatically
 * (VERCEL_PROJECT_PRODUCTION_URL), so nothing needs to be set there unless you add a custom domain.
 */
export function appUrl() {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined
  return (process.env.NEXT_PUBLIC_APP_URL || vercel || 'http://localhost:3000').replace(/\/+$/, '')
}
