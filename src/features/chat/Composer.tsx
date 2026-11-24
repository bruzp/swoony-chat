import { SendHorizontal, Smile } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { LIMITS } from "@shared/config";
import { moderateText } from "@shared/text/moderateText";
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from "@/components/ui/emoji-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { keepKeyboardClosedOnTouch, TOUCH_QUERY, useMediaQuery } from "@/lib/viewport";
import { failureCopy } from "./failureCopy";

const EMOJI_DATA_URL = "/emojibase";

interface ComposerProps {
  onSend: (text: string) => void;
  onTyping?: () => void;
  disabled: boolean;
}

const TOUCH_EMOJI_COLUMNS = 8;
const DEFAULT_EMOJI_COLUMNS = 9;

export function Composer({ onSend, onTyping, disabled }: ComposerProps) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const touchScreen = useMediaQuery(TOUCH_QUERY);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const errorId = `${id}-error`;

  function submit() {
    if (disabled) return;
    const result = moderateText(text, LIMITS.messageMax);
    if (!result.ok) {
      if (result.reason !== "empty") setError(failureCopy(result.reason));
      return;
    }
    onSend(result.text);
    setText("");
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (touchScreen) return;
    event.preventDefault();
    submit();
  }

  function insertEmoji(emoji: string) {
    const element = box.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setError(null);
    setEmojiOpen(false);
    onTyping?.();
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  return (
    <div className="border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {error && (
        <p id={errorId} role="alert" className="px-1 pb-1.5 text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add emoji"
              disabled={disabled}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Smile className="size-5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Emoji"
            side="top"
            align="start"
            className="w-fit p-0"
            onOpenAutoFocus={keepKeyboardClosedOnTouch}
          >
            <EmojiPicker
              className="h-80"
              columns={touchScreen ? TOUCH_EMOJI_COLUMNS : DEFAULT_EMOJI_COLUMNS}
              emojibaseUrl={EMOJI_DATA_URL}
              onEmojiSelect={({ emoji }) => {
                insertEmoji(emoji);
              }}
            >
              <EmojiPickerSearch />
              <EmojiPickerContent />
            </EmojiPicker>
          </PopoverContent>
        </Popover>
        <textarea
          ref={box}
          aria-label="Message"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          rows={1}
          enterKeyHint={touchScreen ? "enter" : "send"}
          placeholder={disabled ? "" : "Write a message…"}
          disabled={disabled}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
            if (event.target.value.trim() !== "") onTyping?.();
          }}
          onKeyDown={onKeyDown}
          className="field-sizing-content max-h-[calc(5lh+1.25rem)] min-h-11 flex-1 resize-none rounded-[1.375rem] border border-input bg-background px-4 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={disabled}
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          className="bg-brand flex size-11 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
        >
          <SendHorizontal className="size-5" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
