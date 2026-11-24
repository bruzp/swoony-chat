import { ArrowLeft, Heart } from "lucide-react";
import { useEffect, useId, useMemo, useState, type SubmitEvent } from "react";
import { LIMITS } from "@shared/config";
import { COUNTRY_CODES, countryName, isCountryCode } from "@shared/countries";
import { GENDERS, type Gender, type PublicUser } from "@shared/profile";
import { isCleanNickname } from "@shared/text/profanity";
import { useAppStore } from "@/app/store";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { enter, type EnterResult } from "@/lib/api";
import { BIO_NOT_ALLOWED, bioError } from "@/lib/bioRules";
import { formatLocalDateTime } from "@/lib/formatTime";
import { GENDER_LABELS } from "@/lib/userMeta";
import { TurnstileField } from "./TurnstileField";

type FieldErrors = Partial<Record<FieldName, string | undefined>>;

const FIELD_NAMES = ["nickname", "gender", "age", "country", "bio"] as const;
type FieldName = (typeof FIELD_NAMES)[number];
const UNAVAILABLE_PAGE = "/unavailable/";
const ADULT_ERROR = "Confirm you're 18 or older to continue.";
const BOT_CHECK_ERROR = "We couldn't verify you're human. Please refresh and try again.";

function OneOnOne() {
  return (
    <span className="whitespace-nowrap">
      1<span className="sr-only"> on </span>
      <Heart
        aria-hidden="true"
        strokeWidth={0}
        className="mx-[0.1em] inline size-[0.78em] align-[-0.04em] fill-primary"
      />
      1
    </span>
  );
}

function isFieldName(value: string | undefined): value is FieldName {
  return FIELD_NAMES.some((name) => name === value);
}
const GENERIC_ERROR = "Something went wrong. Please refresh and try again.";
const DIFFERENT_NICKNAME = "Please choose a different nickname.";

const FORM_ERRORS: Record<string, string> = {
  rate_limited: "Too many tries. Please wait a few minutes.",
  bot_check_failed: "We couldn't verify you're human. Please try again.",
};

const inputClass = "h-11 rounded-xl px-3 text-base";

function nicknameError(nickname: string): string | undefined {
  const { min, max, pattern } = LIMITS.nickname;
  if (nickname.length === 0) return "Pick a nickname.";
  if (!pattern.test(nickname)) return "Use only letters, numbers and _ (no spaces).";
  if (nickname.length < min || nickname.length > max) {
    return `Use ${String(min)} to ${String(max)} characters.`;
  }
  if (!isCleanNickname(nickname)) return DIFFERENT_NICKNAME;
  return undefined;
}

function parseAge(value: string): number | null {
  return /^\d{1,3}$/.test(value) ? Number(value) : null;
}

function ageError(value: string): string | undefined {
  const age = parseAge(value);
  if (age === null) return "Enter your age.";
  if (age < LIMITS.age.min) return "You must be 18 or older to use Swoony.";
  if (age > LIMITS.age.max)
    return `Enter an age from ${String(LIMITS.age.min)} to ${String(LIMITS.age.max)}.`;
  return undefined;
}

function defaultCountry(suggested: string | null): string {
  return suggested && isCountryCode(suggested) ? suggested : "";
}

function sortedCountries(): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function describeFailure(result: Extract<EnterResult, { ok: false }>): {
  fields: FieldErrors;
  form?: string;
} {
  switch (result.error) {
    case "nickname_taken":
      return { fields: { nickname: "That nickname is taken right now. Try another." } };
    case "bad_nickname":
      return { fields: { nickname: DIFFERENT_NICKNAME } };
    case "bad_bio":
      return { fields: { bio: BIO_NOT_ALLOWED } };
    case "banned":
      return {
        fields: {},
        form:
          result.until === undefined
            ? "You're temporarily blocked."
            : `You're temporarily blocked until ${formatLocalDateTime(result.until)}.`,
      };
    case "invalid_profile":
      return isFieldName(result.field)
        ? { fields: { [result.field]: "Please check this field." } }
        : { fields: {}, form: GENERIC_ERROR };
    default:
      return { fields: {}, form: FORM_ERRORS[result.error] ?? GENERIC_ERROR };
  }
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p id={id} aria-live="polite" className="text-sm text-destructive empty:hidden">
      {message}
    </p>
  );
}

interface EntryScreenProps {
  suggestedCountry: string | null;
  onEntered: (me: PublicUser) => void;
}

export function EntryScreen({ suggestedCountry, onEntered }: EntryScreenProps) {
  const id = useId();
  const countries = useMemo(() => sortedCountries(), []);
  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [age, setAge] = useState("");
  const [country, setCountry] = useState(() => defaultCountry(suggestedCountry));
  const [bio, setBio] = useState("");
  const [confirmedAdult, setConfirmedAdult] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [botCheckFailed, setBotCheckFailed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ field: FieldName | "adult" } | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    const target =
      focusTarget.field === "gender" ? `${id}-gender-${GENDERS[0]}` : `${id}-${focusTarget.field}`;
    document.getElementById(target)?.focus();
  }, [focusTarget, id]);

  function clearTurnstileToken() {
    setTurnstileToken(null);
    setBotCheckFailed(false);
  }

  function failTurnstile() {
    setTurnstileToken(null);
    setBotCheckFailed(true);
  }

  const localErrors: FieldErrors = {
    nickname: nicknameError(nickname),
    gender: gender === "" ? "Choose a gender." : undefined,
    age: ageError(age),
    country: country === "" ? "Choose your country." : undefined,
    bio: bioError(bio),
  };
  const formValid = Object.values(localErrors).every((error) => error === undefined);
  const visibleFormError =
    formError ?? (botCheckFailed && turnstileToken === null ? BOT_CHECK_ERROR : null);
  const canSubmit = turnstileToken !== null && !submitting;
  const adultError = attempted && !confirmedAdult ? ADULT_ERROR : undefined;

  function visibleError(field: FieldName): string | undefined {
    if (serverErrors[field]) return serverErrors[field];
    return touched[field] ? localErrors[field] : undefined;
  }

  function touch(field: FieldName) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function edit<T>(field: FieldName, setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setServerErrors(({ [field]: _cleared, ...rest }) => rest);
      setFormError(null);
    };
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid || !confirmedAdult) {
      setAttempted(true);
      setTouched(Object.fromEntries(FIELD_NAMES.map((field) => [field, true])));
      setFocusTarget({ field: FIELD_NAMES.find((field) => localErrors[field]) ?? "adult" });
      return;
    }
    const parsedAge = parseAge(age);
    if (!canSubmit || gender === "" || parsedAge === null) return;
    setSubmitting(true);
    setFormError(null);
    const result = await enter({
      nickname,
      gender,
      age: parsedAge,
      country,
      bio: bio.trim(),
      confirmedAdult: true,
      turnstileToken,
    });
    if (result.ok) {
      onEntered(result.me);
      return;
    }
    if (result.error === "region_unavailable") {
      window.location.replace(UNAVAILABLE_PAGE);
      return;
    }
    if (result.error === "maintenance") {
      useAppStore.getState().maintenance(result.message ?? "");
      return;
    }
    const failure = describeFailure(result);
    setServerErrors(failure.fields);
    const firstField = FIELD_NAMES.find((field) => failure.fields[field]);
    if (firstField) setFocusTarget({ field: firstField });
    setFormError(failure.form ?? null);
    setTurnstileToken(null);
    setTurnstileResetKey((key) => key + 1);
    setSubmitting(false);
  }

  const errorId = (field: FieldName) => `${id}-${field}-error`;
  const describedBy = (field: FieldName, ...extra: string[]) =>
    [visibleError(field) ? errorId(field) : "", ...extra].filter(Boolean).join(" ") || undefined;
  const bioCounterId = `${id}-bio-count`;

  return (
    <main className="h-app overflow-y-auto pb-safe">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-4">
        <a
          href="/"
          className="-ml-2 flex min-h-11 items-center gap-1.5 self-start rounded-full px-2 text-sm font-medium text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Home
        </a>
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-brand text-4xl font-bold tracking-tight">swoony</span>
          <h1 className="text-2xl font-semibold">Meet someone new</h1>
          <p className="text-sm text-muted-foreground">
            Cosy <OneOnOne /> chats with new people. No sign-up.
          </p>
        </div>

        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-5 rounded-[var(--radius)] border bg-card p-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-nickname`}>Nickname</Label>
            <Input
              id={`${id}-nickname`}
              className={inputClass}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={LIMITS.nickname.max}
              value={nickname}
              aria-invalid={visibleError("nickname") ? true : undefined}
              aria-describedby={describedBy("nickname")}
              onChange={(event) => {
                edit("nickname", setNickname)(event.target.value);
              }}
              onBlur={() => {
                touch("nickname");
              }}
            />
            <FieldError id={errorId("nickname")} message={visibleError("nickname")} />
          </div>

          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={describedBy("gender")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) touch("gender");
            }}
          >
            <legend className="mb-2 text-sm font-medium">Gender</legend>
            <RadioGroup
              value={gender}
              onValueChange={(value) => {
                edit("gender", setGender)(value as Gender);
              }}
              className="grid grid-cols-3 gap-2"
            >
              {GENDERS.map((option) => (
                <Label
                  key={option}
                  htmlFor={`${id}-gender-${option}`}
                  className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 has-data-checked:border-primary"
                >
                  <RadioGroupItem id={`${id}-gender-${option}`} value={option} />
                  {GENDER_LABELS[option]}
                </Label>
              ))}
            </RadioGroup>
            <FieldError id={errorId("gender")} message={visibleError("gender")} />
          </fieldset>

          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-age`}>Age</Label>
              <Input
                id={`${id}-age`}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                autoComplete="off"
                className={inputClass}
                value={age}
                aria-invalid={visibleError("age") ? true : undefined}
                aria-describedby={describedBy("age")}
                onChange={(event) => {
                  edit("age", setAge)(event.target.value);
                }}
                onBlur={() => {
                  touch("age");
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${id}-country`}>Country</Label>
              <select
                id={`${id}-country`}
                className={`${inputClass} w-full min-w-0 border border-input bg-transparent outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30`}
                value={country}
                aria-invalid={visibleError("country") ? true : undefined}
                aria-describedby={describedBy("country")}
                onChange={(event) => {
                  edit("country", setCountry)(event.target.value);
                }}
                onBlur={() => {
                  touch("country");
                }}
              >
                <option value="" disabled>
                  Choose your country
                </option>
                {countries.map(({ code, name }) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <FieldError id={errorId("age")} message={visibleError("age")} />
          <FieldError id={errorId("country")} message={visibleError("country")} />

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-bio`}>
              Bio <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={`${id}-bio`}
              rows={2}
              maxLength={LIMITS.bioMax}
              className="rounded-xl px-3 text-base"
              value={bio}
              aria-invalid={visibleError("bio") ? true : undefined}
              aria-describedby={describedBy("bio", bioCounterId)}
              onChange={(event) => {
                edit("bio", setBio)(event.target.value);
              }}
              onBlur={() => {
                touch("bio");
              }}
            />
            <div className="flex justify-between gap-3">
              <FieldError id={errorId("bio")} message={visibleError("bio")} />
              <span id={bioCounterId} className="ml-auto text-xs text-muted-foreground">
                {bio.length}/{LIMITS.bioMax}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id={`${id}-adult`}
              className="mt-0.5 size-5"
              checked={confirmedAdult}
              aria-invalid={adultError ? true : undefined}
              aria-describedby={adultError ? `${id}-adult-error` : undefined}
              onCheckedChange={(checked) => {
                setConfirmedAdult(checked === true);
              }}
            />
            <Label htmlFor={`${id}-adult`} className="block leading-snug font-normal">
              I'm 18 or older and I agree to the{" "}
              <a href="/terms/" target="_blank" rel="noopener" className="underline">
                Terms
              </a>{" "}
              and{" "}
              <a href="/privacy/" target="_blank" rel="noopener" className="underline">
                Privacy Policy
              </a>
            </Label>
          </div>
          {adultError && (
            <p id={`${id}-adult-error`} className="-mt-3 text-sm text-destructive">
              {adultError}
            </p>
          )}

          <TurnstileField
            onToken={setTurnstileToken}
            onExpire={clearTurnstileToken}
            onError={failTurnstile}
            resetKey={turnstileResetKey}
          />

          {visibleFormError && (
            <p role="alert" className="text-sm text-destructive">
              {visibleFormError}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-brand min-h-12 rounded-full px-6 font-semibold text-white transition-opacity disabled:opacity-50"
          >
            Start chatting
          </button>
          {turnstileToken === null && !submitting && !botCheckFailed && (
            <p aria-live="polite" className="-mt-2 text-center text-xs text-muted-foreground">
              Checking your browser…
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
