import type { BotCheck } from "./BotCheck";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 10_000;

type FailureReason =
  | "invalid_token"
  | "network_error"
  | "http_error"
  | "invalid_response"
  | "not_success"
  | "hostname_mismatch"
  | "action_mismatch";

interface SiteverifyResult {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
}

function isSiteverifyResult(body: unknown): body is SiteverifyResult {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

export interface TurnstileBotCheckOptions {
  secret: string;
  expectedHostnames: string[];
  expectedAction: string | null;
  fetcher?: typeof fetch;
}

export class TurnstileBotCheck implements BotCheck {
  private readonly secret: string;
  private readonly expectedHostnames: string[];
  private readonly expectedAction: string | null;
  private readonly fetcher: typeof fetch;

  constructor(options: TurnstileBotCheckOptions) {
    if (!options.secret) throw new Error("TurnstileBotCheck needs a secret");
    this.secret = options.secret;
    this.expectedHostnames = options.expectedHostnames;
    this.expectedAction = options.expectedAction;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async verify(token: string, ip: string): Promise<boolean> {
    const failure = await this.findFailure(token, ip);
    if (failure === null) return true;
    console.warn("bot_check_failed", { reason: failure });
    return false;
  }

  private async findFailure(token: string, ip: string): Promise<FailureReason | null> {
    if (!token || token.length > MAX_TOKEN_LENGTH) return "invalid_token";
    let response: Response;
    try {
      response = await this.fetcher(SITEVERIFY_URL, {
        method: "POST",
        body: new URLSearchParams({ secret: this.secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
      });
    } catch {
      return "network_error";
    }
    if (!response.ok) return "http_error";
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return "invalid_response";
    }
    if (!isSiteverifyResult(body)) return "invalid_response";
    const result = body;
    if (result.success !== true) return "not_success";
    if (
      this.expectedHostnames.length > 0 &&
      !this.expectedHostnames.some((hostname) => hostname === result.hostname)
    ) {
      return "hostname_mismatch";
    }
    if (this.expectedAction !== null && result.action !== this.expectedAction) {
      return "action_mismatch";
    }
    return null;
  }
}
