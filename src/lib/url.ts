// Resolve the public origin from a request when running on Vercel/SSR.
// Vercel routes inside the lambda use `localhost`, so `new URL(request.url).origin`
// would produce wrong success/cancel URLs. Trust x-forwarded-* headers instead.
export function publicOrigin(request: Request): string {
  const h = request.headers;
  const forwardedHost = h.get('x-forwarded-host');
  const forwardedProto = h.get('x-forwarded-proto');
  if (forwardedHost) {
    return `${forwardedProto ?? 'https'}://${forwardedHost}`;
  }
  const host = h.get('host');
  if (host && !host.startsWith('localhost')) {
    return `https://${host}`;
  }
  // Vercel system env fallback
  const vercelUrl = (globalThis as any).process?.env?.VERCEL_PROJECT_PRODUCTION_URL
    ?? (globalThis as any).process?.env?.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  // Last resort: configured Astro site
  return 'https://gamestatiq.com';
}
