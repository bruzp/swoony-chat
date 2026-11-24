const INVISIBLE_CHARACTERS = /[\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]|\uFE0E|\uFE0F|\u20E3/gu;
const ZEROS_INSIDE_LETTERS = /(?<=\p{L})0+(?=\p{L})/gu;
const DOT_LOOKALIKES = /[\u00B7\u2022\u2219\u3002\u30FB\uFF61\uFF65]/g;
const NON_ASCII_DIGIT = /(?![0-9])\p{Nd}/gu;
const DIGIT = /^\p{Nd}$/u;

function asciiDigit(digit: string): string {
  let codePoint = digit.codePointAt(0) ?? 0;
  let offset = 0;
  while (DIGIT.test(String.fromCodePoint(codePoint - 1))) {
    codePoint -= 1;
    offset += 1;
  }
  return String(offset % 10);
}

export function normalizeForChecks(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(NON_ASCII_DIGIT, asciiDigit)
    .replace(DOT_LOOKALIKES, ".")
    .replace(ZEROS_INSIDE_LETTERS, (zeros) => "o".repeat(zeros.length));
}
