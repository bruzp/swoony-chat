import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const PAGES = [
  "index.html",
  "chat/index.html",
  "terms/index.html",
  "privacy/index.html",
  "safety/index.html",
  "faq/index.html",
  "unavailable/index.html",
  "404.html",
];

function headerRules(): Map<string, string> {
  const lines = read("public/_headers").split("\n");
  const rules = new Map<string, string>();
  let inAllPaths = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) {
      inAllPaths = line.trim() === "/*";
      continue;
    }
    if (!inAllPaths) continue;
    const [name, ...value] = line.trim().split(":");
    if (name) rules.set(name.toLowerCase(), value.join(":").trim());
  }
  return rules;
}

function cspDirectives(): Map<string, string[]> {
  const csp = headerRules().get("content-security-policy") ?? "";
  return new Map(
    csp
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name = "", ...sources]) => [name, sources]),
  );
}

describe("security headers", () => {
  it("forbid framing and allow only Turnstile and analytics as outside sources", () => {
    const csp = cspDirectives();
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual([
      "'self'",
      "https://challenges.cloudflare.com",
      "https://static.cloudflareinsights.com",
    ]);
    expect(csp.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "wss://swoony.chat",
      "https://cloudflareinsights.com",
    ]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
  });

  it("set the other protective headers", () => {
    const rules = headerRules();
    expect(rules.get("strict-transport-security")).toBe("max-age=31536000");
    expect(rules.get("x-content-type-options")).toBe("nosniff");
    expect(rules.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(rules.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });
});

describe("pages", () => {
  it.each(PAGES)("%s has no inline script", (page) => {
    const html = read(page);
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    for (const tag of scripts) expect(tag).toMatch(/\ssrc=/);
  });

  it.each(PAGES)("%s uses no em dash", (page) => {
    expect(read(page)).not.toContain("—");
  });

  it.each(PAGES.filter((page) => page !== "chat/index.html"))(
    "%s applies the theme before paint and loads the shared styles",
    (page) => {
      const html = read(page);
      expect(html).toContain('<script src="/theme-init.js"></script>');
      expect(html).toContain('href="/src/static/static.css"');
    },
  );

  it("the privacy page carries the agreed core wording and the retention periods", () => {
    const privacy = read("privacy/index.html").replace(/\s+/g, " ");
    expect(privacy).toContain(
      "No one at Swoony reads your chats. Chats disappear from your screen when they end. To comply with Philippine law, we keep basic connection records for 6 months and the messages of all chats for 1 year, encrypted and only for law enforcement.",
    );
    expect(privacy).toContain("Draft: pending legal review.");
    expect(privacy).toContain("Data Protection Officer");
    expect(privacy).not.toMatch(/end-to-end|encrypted chat|nobody can read/i);
  });

  it("the terms prohibit OSAEC and CSAEM including streaming, and state the 18+ rule", () => {
    const terms = read("terms/index.html").replace(/\s+/g, " ");
    expect(terms).toContain("OSAEC");
    expect(terms).toContain("CSAEM");
    expect(terms).toContain("streaming");
    expect(terms).toContain("18 or older");
    expect(terms).toContain("Draft: pending legal review.");
  });

  it("the safety page lists the abuse contact and a law-enforcement section", () => {
    const safety = read("safety/index.html");
    expect(safety).toContain("mailto:abuse@swoony.chat");
    expect(safety).toContain("For law enforcement");
  });

  it("the FAQ carries the agreed privacy wording and never claims encrypted chat", () => {
    const faq = read("faq/index.html").replace(/\s+/g, " ");
    expect(faq).toContain(
      "No one at Swoony reads your chats. Chats disappear from your screen when they end. To comply with Philippine law, we keep basic connection records for 6 months and the messages of all chats for 1 year, encrypted and only for law enforcement.",
    );
    expect(faq).toContain("mailto:abuse@swoony.chat");
    expect(faq).not.toMatch(/end-to-end|encrypted chat|nobody can read/i);
  });

  it("the unavailable page uses the agreed copy", () => {
    expect(read("unavailable/index.html")).toContain("Swoony isn't available in your country yet.");
  });

  it("the landing page has the hero, an 18+ note and a way into the chat", () => {
    const landing = read("index.html").replace(/\s+/g, " ");
    expect(landing).toMatch(
      /<h1> ?Cosy .*one-on-one.* chats with new people\. No sign-up\. ?<\/h1>/,
    );
    expect(landing).toContain("18+");
    expect(landing).toContain('href="/chat/"');
    expect(landing).toMatch(/<meta name="description"/);
    expect(landing).toMatch(/<meta property="og:title"/);
  });
});

describe("accuracy of the drafts", () => {
  it("claims no target market the owner did not decide", () => {
    for (const page of ["terms/index.html", "privacy/index.html"]) {
      expect(read(page)).not.toContain("Southeast Asia");
    }
  });

  it("lists the owner's access log, taken-down chats and how long holds last", () => {
    const privacy = read("privacy/index.html").replace(/\s+/g, " ");
    expect(privacy).toContain("Log of each time the owner searches, downloads or acts on records");
    expect(privacy).toContain("or of a chat taken down after a notice from the authorities");
    expect(privacy).toContain("we keep them until the date the request asks for");
    expect(privacy).not.toContain("until that request ends");
  });

  it("the privacy page's messages section points to the 1-year records", () => {
    const privacy = read("privacy/index.html").replace(/\s+/g, " ");
    expect(privacy).toContain("except the encrypted records we keep for the law (section 4)");
  });

  it("says every chat's messages are kept for 1 year, not only reported ones", () => {
    for (const page of ["privacy/index.html", "faq/index.html", "terms/index.html"]) {
      const text = read(page).replace(/\s+/g, " ");
      expect(text).toContain("the messages of all chats for 1 year");
      expect(text).not.toContain("Messages are deleted when your chat ends");
      expect(text).not.toMatch(/messages (from|of) reported chats for up to 1 year/);
    }
  });

  it("describes stored device ids as hashed and the seen-message marker honestly", () => {
    const privacy = read("privacy/index.html").replace(/\s+/g, " ");
    expect(privacy).toContain("hashed device id");
    expect(privacy).not.toContain("never sent to us");
  });

  it.each(["unavailable/index.html", "404.html"])(
    "%s links to Terms, Privacy and Safety",
    (page) => {
      const html = read(page);
      for (const path of ["/terms/", "/privacy/", "/safety/", "/faq/"])
        expect(html).toContain(`href="${path}"`);
    },
  );
});

describe("build", () => {
  it("caches hashed assets for a year", () => {
    const headers = read("public/_headers");
    expect(headers).toContain(
      ["/assets/*", "  Cache-Control: public, max-age=31536000, immutable"].join("\n"),
    );
  });

  it("never inlines fonts as data: URIs, which the CSP font-src would block", () => {
    expect(read("vite.config.ts")).toMatch(/assetsInlineLimit:.*woff2.*false/s);
  });

  it("builds every page", () => {
    const config = read("vite.config.ts");
    for (const page of PAGES) expect(config).toContain(`"${page}"`);
  });

  it("publishes robots.txt and a sitemap of the public pages", () => {
    expect(read("public/robots.txt")).toContain("Sitemap: https://swoony.chat/sitemap.xml");
    const sitemap = read("public/sitemap.xml");
    for (const path of ["/", "/terms/", "/privacy/", "/safety/", "/faq/"]) {
      expect(sitemap).toContain(`<loc>https://swoony.chat${path}</loc>`);
    }
  });
});

describe("dash-free wording", () => {
  it("the landing page body writes one-on-one with a heart instead of 1-on-1", () => {
    const body = read("index.html").split("<body>")[1] ?? "";
    expect(body).not.toContain("1-on-1");
    expect(body.match(/class="heart"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the hero headline reads and copies as plain 1 on 1", () => {
    const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(read("index.html"))?.[1] ?? "";
    const text = h1
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    expect(text).toBe("Cosy 1 on 1 chats with new people. No sign-up.");
  });

  it("the tab title and search and social previews say 1 on 1 without dashes", () => {
    const head = read("index.html").split("<body>")[0] ?? "";
    expect(head).not.toContain("1-on-1");
    expect(head).toContain("<title>Swoony: anonymous 1 on 1 chat for adults</title>");
  });
});

describe("footer", () => {
  it.each(PAGES.filter((page) => page !== "chat/index.html"))(
    "%s shows the copyright and brand notice",
    (page) => {
      expect(read(page)).toContain('<small class="site-footer-note">© 2026 Swoony™</small>');
    },
  );
});
