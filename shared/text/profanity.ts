import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from "obscenity";
import { containsContactDetails } from "./contact";
import { normalizeForChecks } from "./normalize";

const EXTRA_SEXUAL_TERMS = [
  pattern`nude`,
  pattern`|noods|`,
  pattern`|noodz|`,
  pattern`phuck`,
  pattern`|phuk|`,
  pattern`horny`,
  pattern`sexting`,
  pattern`sex chat`,
  pattern`sexchat`,
  pattern`|cum`,
  pattern`boobs`,
  pattern`|tits|`,
  pattern`blowjob`,
  pattern`handjob`,
  pattern`nsfw`,
  pattern`|fap`,
  pattern`jerk[?]of|`,
  pattern`jerkof|`,
  pattern`|bj|`,
  pattern`milf`,
  pattern`|dtf|`,
  pattern`send pics`,
  pattern`cam show`,
];

const profanityMatcher = new RegExpMatcher({
  ...new DataSet<{ originalWord?: string }>()
    .addAll(englishDataset)
    .addPhrase((phrase) =>
      EXTRA_SEXUAL_TERMS.reduce((built, term) => built.addPattern(term), phrase),
    )
    .build(),
  ...englishRecommendedTransformers,
});

const SPACED_OUT_LETTERS = /\b[a-z](?:[\s.\-_*]+[a-z]\b){2,}/g;

function joinSpacedOutLetters(normalized: string): string {
  return normalized.replace(SPACED_OUT_LETTERS, (run) => run.replace(/[\s.\-_*]+/g, ""));
}

export function containsProfanity(text: string): boolean {
  return profanityIn(normalizeForChecks(text));
}

export function profanityIn(normalized: string): boolean {
  return (
    profanityMatcher.hasMatch(normalized) ||
    profanityMatcher.hasMatch(joinSpacedOutLetters(normalized))
  );
}

export function isCleanNickname(nickname: string): boolean {
  return !containsProfanity(nickname) && !containsContactDetails(nickname);
}
