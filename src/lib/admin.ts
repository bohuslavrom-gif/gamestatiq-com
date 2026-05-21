// Super-admin (Master / God mode) — gated access to /admin/* routes.
//
// Allowlist of email addresses. Configured via Vercel env var SUPER_ADMIN_EMAILS
// (comma-separated). Example: "bohuslav.rom@gmail.com,partner@example.com".
//
// Why env var (not DB row): single-source of truth in Vercel settings, easy to
// rotate, no risk of accidentally elevating someone via SQL UPDATE, and a clean
// "boot" knob (clear the env var → access immediately revoked on next request).

const ADMIN_EMAILS = (import.meta.env.SUPER_ADMIN_EMAILS ?? '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean);

export function isSuperAdmin(user: { email?: string | null } | null | undefined): boolean {
  if (!user?.email) return false;
  return ADMIN_EMAILS.includes(user.email.toLowerCase());
}

export function superAdminEmails(): string[] {
  return ADMIN_EMAILS.slice();
}
