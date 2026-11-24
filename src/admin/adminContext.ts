import { createContext, useCallback, useContext } from "react";
import { AdminApiError, SessionEndedError, type AdminApi } from "./adminApi";

export interface AdminContextValue {
  api: AdminApi;
  endSession: () => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin needs an AdminContext provider");
  return value;
}

const ERROR_COPY: Record<string, string> = {
  invalid_case_ref: "Enter a case reference: 3 to 40 letters, digits, - or /.",
  invalid_request:
    "Check the search. Without a nickname or user ID, the dates can cover at most 1 day.",
  no_record: "There are no records for that user.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  export_too_large:
    "Too many records for one file. Narrow the dates, or download a single chat from Saved messages (long chats come in parts).",
  network: "Can't reach Swoony. Check your connection and try again.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    return ERROR_COPY[error.code] ?? "Something went wrong. Try again.";
  }
  return "Something went wrong. Try again.";
}

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function useAdminCall(): <T>(call: () => Promise<T>) => Promise<CallResult<T>> {
  const { endSession } = useAdmin();
  return useCallback(
    async <T>(call: () => Promise<T>): Promise<CallResult<T>> => {
      try {
        return { ok: true, value: await call() };
      } catch (error) {
        if (error instanceof SessionEndedError) endSession();
        return { ok: false, error: errorMessage(error) };
      }
    },
    [endSession],
  );
}
