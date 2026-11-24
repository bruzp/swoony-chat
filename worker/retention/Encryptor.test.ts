import { describe, expect, it } from "vitest";
import { Encryptor } from "./Encryptor";
import { flipCharacterNearEnd } from "../test/tamper";

const base64Bytes = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const KEY = base64Bytes(new Uint8Array(32).map((_, i) => i));

describe("Encryptor", () => {
  it("round-trips values with a fresh IV each time", async () => {
    const encryptor = new Encryptor(KEY);
    const value = { nickname: "Mika", ip: "1.2.3.4", n: 3 };
    const a = await encryptor.encrypt(value);
    const b = await encryptor.encrypt(value);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await encryptor.decrypt(a)).toEqual(value);
  });

  it("rejects bad keys", () => {
    expect(() => new Encryptor(base64Bytes(new Uint8Array(16)))).toThrow();
    expect(() => new Encryptor("")).toThrow();
    expect(() => new Encryptor("!!not base64!!")).toThrow();
  });

  it("rejects tampering and a different key", async () => {
    const encryptor = new Encryptor(KEY);
    const payload = await encryptor.encrypt("secret");
    const tampered = flipCharacterNearEnd(payload);
    await expect(encryptor.decrypt(tampered)).rejects.toThrow();
    await expect(encryptor.decrypt("garbage")).rejects.toThrow();
    const other = new Encryptor(base64Bytes(new Uint8Array(32).fill(9)));
    await expect(other.decrypt(payload)).rejects.toThrow();
  });

  it("bytes round-trip and two seals of the same input differ", async () => {
    const encryptor = new Encryptor(KEY);
    const plain = new Uint8Array([1, 2, 3, 250, 0, 7]);
    const a = await encryptor.encryptBytes(plain);
    const b = await encryptor.encryptBytes(plain);
    expect(a).not.toEqual(b);
    expect(a.length).toBe(12 + plain.length + 16);
    expect(await encryptor.decryptBytes(a)).toEqual(plain);
  });

  it("rejects tampered or too-short sealed bytes", async () => {
    const encryptor = new Encryptor(KEY);
    const sealed = await encryptor.encryptBytes(new Uint8Array([5, 6, 7]));
    const tampered = sealed.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(encryptor.decryptBytes(tampered)).rejects.toThrow();
    await expect(encryptor.decryptBytes(new Uint8Array(5))).rejects.toThrow();
  });
});
