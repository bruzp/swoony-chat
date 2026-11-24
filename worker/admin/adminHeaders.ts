function adminCsp(scriptSource: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const STRICT_CSP = adminCsp("'self'");
const LOCAL_DEV_CSP = adminCsp("'self' 'unsafe-inline'");

const ADMIN_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function withAdminHeaders(response: Response, localDevServer = false): Response {
  const hardened = new Response(response.body, response);
  for (const [name, value] of Object.entries(ADMIN_HEADERS)) hardened.headers.set(name, value);
  hardened.headers.set("Content-Security-Policy", localDevServer ? LOCAL_DEV_CSP : STRICT_CSP);
  return hardened;
}
