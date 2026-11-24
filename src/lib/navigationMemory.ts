const TAB_KEY = "swoony-tab";
const OPEN_CHAT_KEY = "swoony-open-chat";

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function readRememberedTab(): string | null {
  return read(TAB_KEY);
}

export function rememberTab(tab: string): void {
  write(TAB_KEY, tab);
}

export function readOpenChat(): string | null {
  return read(OPEN_CHAT_KEY);
}

export function rememberOpenChat(chatId: string | null): void {
  write(OPEN_CHAT_KEY, chatId);
}

export function forgetNavigation(): void {
  write(TAB_KEY, null);
  write(OPEN_CHAT_KEY, null);
}
