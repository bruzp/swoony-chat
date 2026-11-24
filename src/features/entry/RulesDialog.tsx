import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const RULES = [
  "Be kind and respectful. No harassment, threats or hate.",
  "Adults only. If someone seems under 18, report them.",
  "Keep chats on Swoony: no links, phone numbers, emails or social handles.",
  "No spam, scams, or asking for money or gifts.",
  "Block or report anyone who makes you uncomfortable.",
];

export function RulesDialog({ open, onAgree }: { open: boolean; onAgree: () => void }) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onAgree();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Before you start</AlertDialogTitle>
          <AlertDialogDescription>
            Swoony stays fun when everyone plays fair.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Breaking these rules gets you removed or banned. Full rules are in the{" "}
          <a href="/terms/" target="_blank" rel="noopener" className="underline">
            Terms
          </a>
          .
        </p>
        <AlertDialogFooter>
          <AlertDialogAction className="min-h-11" onClick={onAgree}>
            I agree
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
