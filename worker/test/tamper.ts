export function flipCharacterNearEnd(text: string): string {
  const index = text.length - 5;
  const replacement = text[index] === "A" ? "g" : "A";
  return text.slice(0, index) + replacement + text.slice(index + 1);
}
