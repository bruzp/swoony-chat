import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnterRequest } from "@shared/protocol/api";
import { ApiRequestError, enter, fetchSession } from "./api";

const me = { userId: "u", nickname: "mika", gender: "female", age: 25, country: "PH", bio: "" };

const body: EnterRequest = {
  nickname: "mika",
  gender: "female",
  age: 25,
  country: "PH",
  confirmedAdult: true,
  turnstileToken: "tok",
};

function mockFetch(status: number, json: unknown) {
  const fn = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(json), { status })),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("fetchSession returns the bootstrap", async () => {
    const fetchMock = mockFetch(200, { me: null, suggestedCountry: "PH", ban: null });
    await expect(fetchSession()).resolves.toEqual({ me: null, suggestedCountry: "PH", ban: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session");
  });

  it("fetchSession throws an error carrying the API error code", async () => {
    mockFetch(451, { error: "region_unavailable" });
    await expect(fetchSession()).rejects.toThrow(ApiRequestError);
    await expect(fetchSession()).rejects.toMatchObject({ status: 451, code: "region_unavailable" });
  });

  it("enter posts JSON and returns me on success", async () => {
    const fetchMock = mockFetch(201, { me });
    await expect(enter(body)).resolves.toEqual({ ok: true, me });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/session");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it("enter passes field and until through on errors", async () => {
    mockFetch(400, { error: "invalid_profile", field: "age" });
    await expect(enter(body)).resolves.toEqual({
      ok: false,
      error: "invalid_profile",
      field: "age",
    });
    mockFetch(403, { error: "banned", until: 123 });
    await expect(enter(body)).resolves.toEqual({ ok: false, error: "banned", until: 123 });
  });

  it("enter reports a network failure or an unreadable reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(enter(body)).resolves.toEqual({ ok: false, error: "network" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html>", { status: 502 }))),
    );
    await expect(enter(body)).resolves.toEqual({ ok: false, error: "server" });
  });
});
