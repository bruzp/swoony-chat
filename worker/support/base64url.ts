const BASE64URL = /^[A-Za-z0-9_-]+$/;

const CHUNK_BYTES = 0x8000;

function toBinaryString(view: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < view.length; start += CHUNK_BYTES) {
    binary += String.fromCharCode(...view.subarray(start, start + CHUNK_BYTES));
  }
  return binary;
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(toBinaryString(view)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
