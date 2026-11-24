import { isBlockedCountry, LIMITS } from "@shared/config";
import { isCountryCode } from "@shared/countries";
import { profileSchema, type Profile } from "@shared/profile";
import {
  entryConsentSchema,
  type ActiveBan,
  type ApiError,
  type SessionBootstrap,
} from "@shared/protocol/api";
import type { MaintenanceState } from "@shared/protocol/admin";
import { CHAT_ID_PATTERN } from "@shared/protocol/chat";
import { isCleanNickname } from "@shared/text/profanity";
import { moderateText } from "@shared/text/moderateText";
import type { z } from "zod";
import { isLocalRequest } from "./admin/accessAuth";
import { withAdminHeaders } from "./admin/adminHeaders";
import { isAdminPagePath, serveAdminPage } from "./admin/adminPage";
import { ADMIN_PATH_PREFIX, handleAdmin } from "./admin/adminRoutes";
import { handleWebAdmin, WEB_ADMIN_PATH_PREFIX } from "./admin/webAdminRoutes";
import { PEER_HEADER, USER_HEADER } from "./chat/ChatRoom";
import { devAdminEmail, type AppDeps } from "./deps";
import { publicHealth } from "./health/healthChecks";
import { json } from "./http/json";
import { clientIp, isSameOrigin, networkKey, requestCountry } from "./http/requestInfo";
import { DEVICE_HEADER } from "./lobby/Lobby";
import { lobbyStub } from "./lobby/lobbyStub";

type RouteHandler = (request: Request, env: Env, deps: AppDeps) => Response | Promise<Response>;

const SWOONY_HEADER_PREFIX = "x-swoony-";
const CHAT_PATH_PREFIX = "/api/chat/";

function apiError(error: ApiError, status: number, setCookie: string | null = null): Response {
  return json(error, status, setCookie);
}

async function deviceFor(
  request: Request,
  deps: AppDeps,
): Promise<{ deviceId: string; setCookie: string | null }> {
  const deviceId = await deps.cookies.read(request);
  if (deviceId) return { deviceId, setCookie: null };
  return deps.cookies.issue();
}

async function activeBanFor(
  deps: AppDeps,
  deviceId: string | null,
  ip: string,
): Promise<ActiveBan | null> {
  try {
    const [deviceHash, networkHash] = await Promise.all([
      deviceId === null ? null : deps.hasher.hash(deviceId),
      deps.hasher.hash(networkKey(ip)),
    ]);
    return await deps.bans.getActiveBan(deviceHash, networkHash);
  } catch {
    console.error("ban_lookup_failed");
    return null;
  }
}

function firstIssueField(error: z.ZodError): string {
  return error.issues[0]?.path.join(".") || "body";
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk: ReadableStreamReadResult<unknown> = await reader.read();
    if (chunk.done) break;
    const { value } = chunk;
    total += value instanceof Uint8Array ? value.byteLength : Infinity;
    if (!(value instanceof Uint8Array) || total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await readBoundedText(request, LIMITS.maxEntryBodyBytes);
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

type ProfileCheck =
  { ok: true; profile: Profile; turnstileToken: string } | { ok: false; error: ApiError };

function checkProfile(body: unknown): ProfileCheck {
  if (body === undefined) return { ok: false, error: { error: "invalid_profile", field: "body" } };
  const profile = profileSchema.safeParse(body);
  if (!profile.success) {
    return {
      ok: false,
      error: { error: "invalid_profile", field: firstIssueField(profile.error) },
    };
  }
  const consent = entryConsentSchema.safeParse(body);
  if (!consent.success) {
    return {
      ok: false,
      error: { error: "invalid_profile", field: firstIssueField(consent.error) },
    };
  }
  if (!isCleanNickname(profile.data.nickname))
    return { ok: false, error: { error: "bad_nickname" } };
  const bio = moderateText(profile.data.bio, LIMITS.bioMax);
  if (!bio.ok && bio.reason !== "empty") {
    return { ok: false, error: { error: "bad_bio", reason: bio.reason } };
  }
  return {
    ok: true,
    profile: { ...profile.data, bio: bio.ok ? bio.text : "" },
    turnstileToken: consent.data.turnstileToken,
  };
}

const MAINTENANCE_STATUS = 503;

function maintenanceResponse(
  maintenance: MaintenanceState,
  setCookie: string | null,
): Response | null {
  if (!maintenance.on) return null;
  return apiError(
    { error: "maintenance", message: maintenance.message },
    MAINTENANCE_STATUS,
    setCookie,
  );
}

const getSession: RouteHandler = async (request, env, deps) => {
  const deviceId = (await deps.cookies.read(request)) ?? undefined;
  const { deviceId: id, setCookie } = await deps.cookies.issue(deviceId);
  const [gate, ban] = await Promise.all([
    lobbyStub(env).sessionGate(deviceId ?? null),
    activeBanFor(deps, id, clientIp(request)),
  ]);
  const closed = maintenanceResponse(gate.maintenance, setCookie);
  if (closed) return closed;
  const country = requestCountry(request);
  const me = gate.me;
  const bootstrap: SessionBootstrap = {
    me,
    suggestedCountry: country && isCountryCode(country) ? country : null,
    ban,
  };
  return json(bootstrap, 200, setCookie);
};

const enter: RouteHandler = async (request, env, deps) => {
  if (!isSameOrigin(request)) return apiError({ error: "bad_origin" }, 403);
  const { deviceId, setCookie } = await deviceFor(request, deps);
  const ip = clientIp(request);
  const ban = await activeBanFor(deps, deviceId, ip);
  if (ban) return apiError({ error: "banned", until: ban.until }, 403, setCookie);
  const lobby = lobbyStub(env);
  const gate = await lobby.sessionGate(deviceId);
  const closed = maintenanceResponse(gate.maintenance, setCookie);
  if (closed) return closed;
  if (gate.me) return json({ me: gate.me }, 200, setCookie);

  const checked = checkProfile(await readJson(request));
  if (!checked.ok) return apiError(checked.error, 400, setCookie);

  const now = deps.now();
  if (!(await lobby.hitDeviceEntryLimit(deviceId, now))) {
    return apiError({ error: "rate_limited" }, 429, setCookie);
  }
  if (!(await deps.botCheck.verify(checked.turnstileToken, ip))) {
    return apiError({ error: "bot_check_failed" }, 403, setCookie);
  }
  if (!(await lobby.hitNetworkEntryLimit(networkKey(ip), now))) {
    return apiError({ error: "rate_limited" }, 429, setCookie);
  }

  const joined = await lobby.join({
    deviceId,
    ip,
    detectedCountry: requestCountry(request),
    profile: checked.profile,
    now,
  });
  if (!joined.ok) {
    if (joined.error === "nickname_taken") return apiError({ error: joined.error }, 409, setCookie);
    const closedMeanwhile = maintenanceResponse(
      (await lobby.sessionGate(null)).maintenance,
      setCookie,
    );
    return closedMeanwhile ?? apiError({ error: "maintenance", message: "" }, 503, setCookie);
  }
  return json({ me: joined.me }, 201, setCookie);
};

type UpgradeCheck = { ok: true; deviceId: string } | { ok: false; response: Response };

async function checkUpgrade(request: Request, deps: AppDeps): Promise<UpgradeCheck> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return { ok: false, response: apiError({ error: "upgrade_required" }, 426) };
  }
  if (!isSameOrigin(request))
    return { ok: false, response: apiError({ error: "bad_origin" }, 403) };
  const deviceId = await deps.cookies.read(request);
  if (!deviceId) return { ok: false, response: apiError({ error: "no_session" }, 401) };
  const ban = await activeBanFor(deps, deviceId, clientIp(request));
  if (ban) return { ok: false, response: apiError({ error: "banned", until: ban.until }, 403) };
  return { ok: true, deviceId };
}

function headersWithoutIdentity(request: Request): Headers {
  const headers = new Headers(request.headers);
  const spoofable = [...headers.keys()].filter((name) => name.startsWith(SWOONY_HEADER_PREFIX));
  for (const name of spoofable) headers.delete(name);
  return headers;
}

const lobbyUpgrade: RouteHandler = async (request, env, deps) => {
  const check = await checkUpgrade(request, deps);
  if (!check.ok) return check.response;
  const headers = headersWithoutIdentity(request);
  headers.set(DEVICE_HEADER, check.deviceId);
  return lobbyStub(env).fetch(new Request(request.url, { headers }));
};

async function chatUpgrade(
  request: Request,
  env: Env,
  deps: AppDeps,
  chatId: string,
): Promise<Response> {
  const check = await checkUpgrade(request, deps);
  if (!check.ok) return check.response;
  const access = await lobbyStub(env).authorizeChat(check.deviceId, chatId);
  if (access === "no_session") return apiError({ error: "no_session" }, 401);
  if (!access) return apiError({ error: "forbidden" }, 403);
  const headers = headersWithoutIdentity(request);
  headers.set(USER_HEADER, access.userId);
  headers.set(PEER_HEADER, access.peerUserId);
  return env.CHAT_ROOM.getByName(chatId).fetch(new Request(request.url, { headers }));
}

function chatIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(CHAT_PATH_PREFIX)) return null;
  const chatId = pathname.slice(CHAT_PATH_PREFIX.length);
  return CHAT_ID_PATTERN.test(chatId) ? chatId : null;
}

const routes: Record<string, RouteHandler> = {
  "GET /api/health": publicHealth,
  "GET /api/session": getSession,
  "POST /api/session": enter,
  "GET /api/lobby": lobbyUpgrade,
};

function isRegionGated(pathname: string): boolean {
  return pathname.startsWith("/api/") && pathname !== "/api/health";
}

async function routeRequest(request: Request, env: Env, deps: AppDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const localDevServer = devAdminEmail(env) !== null && isLocalRequest(request);
  if (isAdminPagePath(pathname)) {
    return withAdminHeaders(await serveAdminPage(request, env, deps), localDevServer);
  }
  if (pathname.startsWith(WEB_ADMIN_PATH_PREFIX)) {
    return withAdminHeaders(await handleWebAdmin(request, env, deps), localDevServer);
  }
  if (isRegionGated(pathname) && isBlockedCountry(requestCountry(request))) {
    return apiError({ error: "region_unavailable" }, 451);
  }
  if (pathname.startsWith(ADMIN_PATH_PREFIX)) return await handleAdmin(request, env, deps);
  const chatId = request.method === "GET" ? chatIdFromPath(pathname) : null;
  if (chatId) return await chatUpgrade(request, env, deps, chatId);
  const route = routes[`${request.method} ${pathname}`];
  if (!route) return apiError({ error: "not_found" }, 404);
  return await route(request, env, deps);
}

const SWITCHING_PROTOCOLS = 101;

function withApiHeaders(response: Response): Response {
  if (response.status === SWITCHING_PROTOCOLS) return response;
  const hardened = new Response(response.body, response);
  hardened.headers.set("Cache-Control", "no-store");
  hardened.headers.set("X-Content-Type-Options", "nosniff");
  return hardened;
}

export async function handleRequest(request: Request, env: Env, deps: AppDeps): Promise<Response> {
  return withApiHeaders(await routeRequest(request, env, deps));
}
