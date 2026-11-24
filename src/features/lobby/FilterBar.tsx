import { ChevronDown } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { LIMITS } from "@shared/config";
import { COUNTRY_CODES, countryName } from "@shared/countries";
import { GENDERS, type Gender, type UserFilter } from "@shared/profile";
import { useAppStore } from "@/app/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { keepKeyboardClosedOnTouch } from "@/lib/viewport";
import { GENDER_LABELS } from "@/lib/userMeta";
import { useLobby } from "./lobbyContext";

const chipClass =
  "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const activeChipClass = "border-primary bg-primary/10 text-foreground";
const idleChipClass = "border-border text-muted-foreground";

function withoutEmpty(filter: UserFilter): UserFilter {
  const clean: UserFilter = {};
  if (filter.genders?.length) clean.genders = filter.genders;
  if (filter.minAge !== undefined && filter.minAge > LIMITS.age.min) clean.minAge = filter.minAge;
  if (filter.maxAge !== undefined && filter.maxAge < LIMITS.age.max) clean.maxAge = filter.maxAge;
  if (filter.countries?.length) clean.countries = filter.countries;
  return clean;
}

function isFiltered(filter: UserFilter): boolean {
  return Object.keys(filter).length > 0;
}

function parseAgeInput(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  const age = Number(value);
  return age >= LIMITS.age.min && age <= LIMITS.age.max ? age : null;
}

function ageLabel(filter: UserFilter): string {
  if (filter.minAge === undefined && filter.maxAge === undefined) return "Age";
  return `Age ${String(filter.minAge ?? LIMITS.age.min)}–${String(filter.maxAge ?? LIMITS.age.max)}`;
}

interface FilterOption {
  value: string;
  label: string;
}

function pickedLabel(
  placeholder: string,
  picked: string[],
  options: FilterOption[],
  plural: string,
) {
  if (picked.length === 0) return placeholder;
  if (picked.length === 1)
    return options.find((option) => option.value === picked[0])?.label ?? placeholder;
  return `${String(picked.length)} ${plural}`;
}

function Chip({
  active,
  children,
  ...props
}: { active: boolean; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(chipClass, active ? activeChipClass : idleChipClass)}
      {...props}
    >
      {children}
    </button>
  );
}

function AgeFilter({
  filter,
  onApply,
}: {
  filter: UserFilter;
  onApply: (minAge: number, maxAge: number) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const min = parseAgeInput(from);
  const max = parseAgeInput(to);
  const valid = min !== null && max !== null && min <= max;
  const active = filter.minAge !== undefined || filter.maxAge !== undefined;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFrom(String(filter.minAge ?? LIMITS.age.min));
          setTo(String(filter.maxAge ?? LIMITS.age.max));
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Chip active={active}>
          {ageLabel(filter)}
          <ChevronDown className="size-4" aria-hidden="true" />
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Age" className="w-64 gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-from`}>From</Label>
            <Input
              id={`${id}-from`}
              inputMode="numeric"
              maxLength={2}
              className="h-11 rounded-xl text-base"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-to`}>To</Label>
            <Input
              id={`${id}-to`}
              inputMode="numeric"
              maxLength={2}
              className="h-11 rounded-xl text-base"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </div>
        </div>
        {!valid && (
          <p className="text-xs text-muted-foreground">
            Ages {String(LIMITS.age.min)}–{String(LIMITS.age.max)}, lowest first.
          </p>
        )}
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (min === null || max === null) return;
            onApply(min, max);
            setOpen(false);
          }}
          className="bg-brand min-h-11 rounded-full font-semibold text-white disabled:opacity-50"
        >
          Apply
        </button>
      </PopoverContent>
    </Popover>
  );
}

interface PinnedOption {
  option: FilterOption;
  heading: string;
}

function MultiSelectFilter({
  placeholder,
  plural,
  options,
  pinned,
  picked,
  searchLabel,
  onChange,
}: {
  placeholder: string;
  plural: string;
  options: FilterOption[];
  pinned?: PinnedOption | undefined;
  picked: string[];
  searchLabel?: string;
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(picked);
  const needle = query.trim().toLowerCase();
  const matches = (option: FilterOption) => option.label.toLowerCase().includes(needle);
  const rest = pinned ? options.filter((option) => option.value !== pinned.option.value) : options;
  const shown = needle ? rest.filter(matches) : rest;
  const shownPinned = pinned && matches(pinned.option) ? pinned : undefined;

  function optionRow({ value, label }: FilterOption) {
    const checked = selected.includes(value);
    return (
      <li key={value}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={checked}
            onChange={() => {
              setSelected(checked ? selected.filter((v) => v !== value) : [...selected, value]);
            }}
          />
          {label}
        </label>
      </li>
    );
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setSelected(picked);
          return;
        }
        setQuery("");
        const changed =
          selected.length !== picked.length || selected.some((value) => !picked.includes(value));
        if (changed) onChange(selected);
      }}
    >
      <PopoverTrigger asChild>
        <Chip active={picked.length > 0}>
          {pickedLabel(placeholder, picked, options, plural)}
          <ChevronDown className="size-4" aria-hidden="true" />
        </Chip>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={placeholder}
        className={cn("gap-2 p-3", searchLabel ? "w-72" : "w-56")}
        onOpenAutoFocus={keepKeyboardClosedOnTouch}
      >
        {searchLabel && (
          <>
            <Label htmlFor={`${id}-search`} className="sr-only">
              {searchLabel}
            </Label>
            <Input
              id={`${id}-search`}
              placeholder={searchLabel}
              className="h-11 rounded-xl text-base"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </>
        )}
        <ul className="max-h-64 overflow-y-auto">
          {shownPinned && (
            <>
              <li
                role="presentation"
                className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground"
              >
                {shownPinned.heading}
              </li>
              {optionRow(shownPinned.option)}
              <li role="separator" className="my-1 border-t border-border" />
            </>
          )}
          {shown.map(optionRow)}
          {shown.length === 0 && !shownPinned && (
            <li className="p-3 text-center text-sm text-muted-foreground">No match found.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const GENDER_OPTIONS: FilterOption[] = GENDERS.map((gender) => ({
  value: gender,
  label: GENDER_LABELS[gender],
}));

const COUNTRY_OPTIONS: FilterOption[] = COUNTRY_CODES.map((code) => ({
  value: code,
  label: countryName(code),
})).sort((a, b) => a.label.localeCompare(b.label));

function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value);
}

export function FilterBar() {
  const filter = useAppStore((state) => state.lobby.filter);
  const myCountry = useAppStore((state) => state.session.me?.country);
  const setFilter = useAppStore((state) => state.setFilter);
  const requestList = useAppStore((state) => state.requestList);
  const { send } = useLobby();

  function apply(next: UserFilter) {
    setFilter(withoutEmpty(next));
    send(requestList(null));
  }

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap gap-2 px-4 pt-1 pb-3">
      <MultiSelectFilter
        placeholder="Gender"
        plural="genders"
        options={GENDER_OPTIONS}
        picked={filter.genders ?? []}
        onChange={(values) => {
          apply({ ...filter, genders: values.filter(isGender) });
        }}
      />
      <AgeFilter
        filter={filter}
        onApply={(minAge, maxAge) => {
          apply({ ...filter, minAge, maxAge });
        }}
      />
      <MultiSelectFilter
        placeholder="Country"
        plural="countries"
        options={COUNTRY_OPTIONS}
        pinned={
          myCountry
            ? {
                option: { value: myCountry, label: countryName(myCountry) },
                heading: "Your country",
              }
            : undefined
        }
        picked={filter.countries ?? []}
        searchLabel="Search countries"
        onChange={(countries) => {
          apply({ ...filter, countries });
        }}
      />
      {isFiltered(filter) && (
        <button
          type="button"
          onClick={() => {
            apply({});
          }}
          className="min-h-11 shrink-0 px-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
