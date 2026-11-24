import { afterEach, expect, it, vi } from "vitest";
import { saveFile } from "./saveFile";

afterEach(() => {
  vi.useRealTimers();
});

it("keeps the download link alive long enough for mobile browsers to start the download", () => {
  vi.useFakeTimers();
  URL.createObjectURL = vi.fn(() => "blob:case-file");
  const revoke = vi.fn();
  URL.revokeObjectURL = revoke;
  saveFile({ blob: new Blob(["x"]), fileName: "case.pdf", sha256: "ab", parts: 1 });
  vi.advanceTimersByTime(5_000);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(revoke).toHaveBeenCalledWith("blob:case-file");
});
