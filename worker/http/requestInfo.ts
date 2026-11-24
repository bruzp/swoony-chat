const LOCALHOST = "127.0.0.1";
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? LOCALHOST;
}

function expandIpv6(ip: string): string[] {
  const [head = "", tail] = ip.toLowerCase().split("::");
  const headGroups = head ? head.split(":") : [];
  if (tail === undefined) return headGroups;
  const tailGroups = tail ? tail.split(":") : [];
  const zeros = Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0");
  return [...headGroups, ...zeros, ...tailGroups];
}

export function networkKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const prefix = expandIpv6(ip)
    .slice(0, 4)
    .map((group) => (parseInt(group, 16) || 0).toString(16));
  return `${prefix.join(":")}::/64`;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function requestCountry(request: Request): string | null {
  const country: unknown = request.cf?.country;
  return typeof country === "string" ? country : null;
}
