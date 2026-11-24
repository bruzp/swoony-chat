import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";

interface TurnstileFieldProps {
  onToken: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
  resetKey: number;
}

export function TurnstileField({ onToken, onExpire, onError, resetKey }: TurnstileFieldProps) {
  const widget = useRef<TurnstileInstance | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (resetKey > 0) widget.current?.reset();
  }, [resetKey]);

  return (
    <Turnstile
      ref={widget}
      siteKey={TURNSTILE_SITE_KEY}
      options={{ appearance: "interaction-only", action: "enter", size: "flexible", theme }}
      onSuccess={onToken}
      onExpire={onExpire}
      onError={onError}
      onUnsupported={onError}
    />
  );
}
