const LOCAL_ADMIN_EMAIL = "dev@localhost";

const LOCAL_DEV_VARS: Readonly<Record<string, string>> = {
  DEV_INSECURE_COOKIES: "1",
  TURNSTILE_HOSTNAMES: "",
};

function isOpenToNetwork(cliArgs: readonly string[]): boolean {
  return cliArgs.some((arg) => arg === "--host" || arg.startsWith("--host="));
}

export function workerVarsFor(
  command: "serve" | "build",
  cliArgs: readonly string[],
): Record<string, string> {
  if (command !== "serve") return {};
  if (isOpenToNetwork(cliArgs)) return { ...LOCAL_DEV_VARS };
  return { ...LOCAL_DEV_VARS, ADMIN_DEV_EMAIL: LOCAL_ADMIN_EMAIL };
}
