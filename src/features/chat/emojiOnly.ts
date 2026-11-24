const EMOJI_ONLY_MAX = 3;
const EMOJI_PARTS =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}|\u{20E3})+$/u;
const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u;

export function isEmojiOnly(text: string): boolean {
  if (typeof Intl.Segmenter !== "function") return false;
  const graphemes = new Intl.Segmenter().segment(text.trim());
  const segments = Array.from(graphemes, ({ segment }) => segment);
  return (
    segments.length > 0 &&
    segments.length <= EMOJI_ONLY_MAX &&
    segments.every((segment) => EMOJI_PARTS.test(segment) && PICTURE.test(segment))
  );
}
