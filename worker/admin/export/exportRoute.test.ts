import { LIMITS } from "@shared/config";
import { canonicalRecordsJson } from "@shared/legal/canonical";
import { EXPORT_PARTS_HEADER, EXPORT_SHA256_HEADER } from "@shared/protocol/admin";
import { env } from "cloudflare:workers";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { beforeEach, expect, it, vi } from "vitest";
import { sha256BytesHex, sha256Hex } from "../../support/hash";
import { webAdminCall } from "../../test/adminAccess";
import { deps, enter, openPairChat, resetLobby, uniqueIp, uniqueName } from "../../test/helpers";
import { ContentArchive } from "../../retention/ContentArchive";
import { Encryptor } from "../../retention/Encryptor";
import { RetentionStore } from "../../retention/RetentionStore";

beforeEach(async () => {
  await resetLobby();
  await env.DB.prepare("DELETE FROM admin_audit").run();
});

const FAR_FUTURE = 8_640_000_000_000_000;
const WINDOW = { from: 0, to: FAR_FUTURE };
const CASE = "NBI-2026/7";

async function bytesOf(res: Response): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await res.arrayBuffer());
}

it("exports a search as one zip of connections, chats and messages CSVs", async () => {
  const nickname = uniqueName("Zip");
  const ip = uniqueIp();
  const { me } = await enter({ nickname }, { ip });
  const res = await webAdminCall("export", {
    caseRef: CASE,
    format: "csv",
    scope: { query: { userId: me.userId, ...WINDOW } },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/zip");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Content-Disposition")).toMatch(
    /^attachment; filename="NBI-2026-7-\d{4}-\d{2}-\d{2}\.zip"$/,
  );
  const files = unzipSync(await bytesOf(res));
  expect(Object.keys(files).sort()).toEqual([
    "chats.csv",
    "connections.csv",
    "fingerprint.txt",
    "messages.csv",
  ]);
  const connections = strFromU8(files["connections.csv"] ?? new Uint8Array());
  expect(connections).toContain(`${me.userId},${nickname},${ip},PH`);
});

it("exports a search as a PDF case file with the records fingerprint", async () => {
  const { me } = await enter();
  const query = { userId: me.userId, ...WINDOW };
  const res = await webAdminCall("export", { caseRef: CASE, format: "pdf", scope: { query } });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/pdf");
  const pdf = await PDFDocument.load(await bytesOf(res));
  const fingerprint = await sha256Hex(canonicalRecordsJson(await deps.retention.lookup(query)));
  expect(pdf.getSubject()).toBe(`Records fingerprint ${fingerprint}`);
  expect(pdf.getTitle()).toContain(CASE);
});

it("exports one saved chat as a PDF", async () => {
  const { a, ca, cb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "evidence 😀" });
  await cb.next("message");
  await deps.retention.snapshotReport(chatId, "harassment", [
    { from: a.me.userId, text: "evidence 😀", sentAt: Date.now() },
  ]);
  const res = await webAdminCall("export", { caseRef: CASE, format: "pdf", scope: { chatId } });
  expect(res.status).toBe(200);
  const records = await deps.retention.chatRecords(chatId);
  expect(records.content).toHaveLength(1);
  expect(records.connections.map((c) => c.userId)).toContain(a.me.userId);
});

it("downloads a long chat in parts and names the part in the file", async () => {
  const chatId = "f".repeat(64);
  const bundle = LIMITS.exportPartMessages / 2;
  const encryptor = new Encryptor(env.RETENTION_KEY);
  const archive = new ContentArchive(env.DB, env.ARCHIVE, encryptor, () => Date.now());
  for (let b = 0; b < 5; b++) {
    await archive.store(
      chatId,
      Array.from({ length: bundle }, (_, i) => ({ from: "u", text: "x", sentAt: b * bundle + i })),
    );
  }
  const part = async (scope: object) =>
    webAdminCall("export", { caseRef: CASE, format: "csv", scope });
  const whole = await part({ chatId });
  expect(whole.status).toBe(200);
  expect(whole.headers.get(EXPORT_PARTS_HEADER)).toBe("3");
  const second = await part({ chatId, part: 2 });
  expect(second.status).toBe(200);
  const files = unzipSync(await bytesOf(second));
  expect(strFromU8(files["fingerprint.txt"] ?? new Uint8Array())).toContain(
    `Search: Saved chat ${chatId}, part 2 of 3`,
  );
  const lines = strFromU8(files["messages.csv"] ?? new Uint8Array())
    .trim()
    .split("\n");
  expect(lines).toHaveLength(LIMITS.exportPartMessages + 1);
  expect((await part({ chatId, part: 4 })).status).toBe(400);
  expect((await part({ chatId, part: 0 })).status).toBe(400);
});

it("stores the hash of the exact file sent in the activity log", async () => {
  const { me } = await enter();
  const res = await webAdminCall("export", {
    caseRef: CASE,
    format: "csv",
    scope: { query: { userId: me.userId, ...WINDOW } },
  });
  const fileHash = await sha256BytesHex(await bytesOf(res));
  expect(res.headers.get(EXPORT_SHA256_HEADER)).toBe(fileHash);
  const row = await env.DB.prepare("SELECT * FROM admin_audit").first();
  expect(row).toMatchObject({
    action: "export",
    case_ref: CASE,
    export_sha256: fileHash,
    target_kind: "user",
  });
});

it("refuses an export whose search was cut short at the row cap", async () => {
  const lookup = vi.spyOn(RetentionStore.prototype, "lookup").mockResolvedValue({
    connections: [],
    chats: [],
    content: [],
    truncated: true,
  });
  try {
    const res = await webAdminCall("export", {
      caseRef: CASE,
      format: "csv",
      scope: { query: { nickname: "mika", from: 0, to: 1 } },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "export_too_large" });
  } finally {
    lookup.mockRestore();
  }
});

it("refuses exports over the size limit with a readable error", async () => {
  const chatId = "e".repeat(64);
  const messages = Array.from({ length: LIMITS.exportMaxMessages + 1 }, (_, i) => ({
    from: "u",
    text: "x",
    sentAt: i,
  }));
  await deps.retention.snapshotReport(chatId, "spam", messages);
  const res = await webAdminCall("export", { caseRef: CASE, format: "pdf", scope: { chatId } });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "export_too_large" });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit").first("n")).toBe(0);
});

it("refuses bad export requests without writing a log row", async () => {
  const bad = [
    { format: "pdf", scope: { chatId: "e".repeat(64) } },
    { caseRef: CASE, format: "docx", scope: { chatId: "e".repeat(64) } },
    { caseRef: CASE, format: "pdf", scope: {} },
    { caseRef: CASE, format: "pdf", scope: { query: { from: 0, to: FAR_FUTURE } } },
  ];
  for (const body of bad) expect((await webAdminCall("export", body)).status).toBe(400);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit").first("n")).toBe(0);
});
