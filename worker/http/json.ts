export function json(body: unknown, status = 200, setCookie: string | null = null): Response {
  const response = Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (setCookie) response.headers.append("Set-Cookie", setCookie);
  return response;
}
