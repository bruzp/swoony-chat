import { expect, it } from "vitest";
import { z } from "zod";
import "./zodConfig";

it("runs zod without code generation, which the CSP forbids", () => {
  expect(z.config().jitless).toBe(true);
});
