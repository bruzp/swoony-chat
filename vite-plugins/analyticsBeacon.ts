import type { HtmlTagDescriptor, Plugin } from "vite";

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function beaconTag(token: string | undefined): HtmlTagDescriptor[] {
  if (!token) return [];
  if (!TOKEN_PATTERN.test(token)) throw new Error("VITE_CF_ANALYTICS_TOKEN has an invalid token");
  return [
    {
      tag: "script",
      attrs: { defer: true, src: BEACON_SRC, "data-cf-beacon": JSON.stringify({ token }) },
      injectTo: "body",
    },
  ];
}

const UNTRACKED_PAGE_PREFIX = "/s-admin/";

export function beaconTagFor(token: string | undefined, pagePath: string): HtmlTagDescriptor[] {
  return pagePath.startsWith(UNTRACKED_PAGE_PREFIX) ? [] : beaconTag(token);
}

export function analyticsBeacon(token: string | undefined): Plugin {
  return {
    name: "swoony-analytics-beacon",
    apply: "build",
    transformIndexHtml(_html, context) {
      return beaconTagFor(token, context.path);
    },
  };
}
