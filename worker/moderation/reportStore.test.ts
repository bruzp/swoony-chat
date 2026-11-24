import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { ReportStore } from "./reportStore";

const store = new ReportStore(env.DB);
const HOUR = 3_600_000;

function uniqueHash(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

it("counts independent reporters (distinct networks) since a cutoff", async () => {
  const reported = uniqueHash("rs-target");
  const base = { reportedDevice: reported, reason: "spam" as const };
  await store.addUserReport({ ...base, reporterDevice: "d1", reporterNetwork: "n1", createdAt: 0 });
  await store.addUserReport({
    ...base,
    reporterDevice: "d2",
    reporterNetwork: "n2",
    createdAt: HOUR,
  });
  await store.addUserReport({
    ...base,
    reporterDevice: "d3",
    reporterNetwork: "n2",
    createdAt: HOUR,
  });
  await store.addUserReport({
    ...base,
    reporterDevice: "d4",
    reporterNetwork: "n3",
    createdAt: HOUR,
  });
  expect(await store.independentReporters(reported, -1)).toBe(3);
  expect(await store.independentReporters(reported, 0)).toBe(2);
  expect(await store.independentReporters(uniqueHash("rs-other"), -1)).toBe(0);
});

it("counts system kicks separately from user reports", async () => {
  const reported = uniqueHash("rs-kicked");
  await store.addSystemKick(reported, 10);
  await store.addSystemKick(reported, 20);
  await store.addUserReport({
    reportedDevice: reported,
    reporterDevice: "d",
    reporterNetwork: "n",
    reason: "other",
    createdAt: 20,
  });
  expect(await store.systemKicks(reported, 0)).toBe(2);
  expect(await store.systemKicks(reported, 10)).toBe(1);
  expect(await store.independentReporters(reported, 0)).toBe(1);
});

it("counts one device reporting from several networks as one reporter", async () => {
  const reported = uniqueHash("rs-hopper");
  const base = { reportedDevice: reported, reporterDevice: "same", reason: "spam" as const };
  await store.addUserReport({ ...base, reporterNetwork: "wifi", createdAt: 1 });
  await store.addUserReport({ ...base, reporterNetwork: "mobile", createdAt: 2 });
  await store.addUserReport({ ...base, reporterNetwork: "vpn", createdAt: 3 });
  expect(await store.independentReporters(reported, 0)).toBe(1);
});
