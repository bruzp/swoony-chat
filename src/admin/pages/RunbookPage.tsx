import runbook from "../../../docs/legal/runbook.md?raw";
import { Markdown } from "../markdown";

export function RunbookPage() {
  return (
    <section className="rounded-3xl border bg-card p-5 md:p-8">
      <Markdown source={runbook} />
    </section>
  );
}
