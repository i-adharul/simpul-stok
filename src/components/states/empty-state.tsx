import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  /** One sentence that says what is missing. */
  message: string;
  /** The relevant next step, usually a <Button>. */
  action?: ReactNode;
};

/** Functional spec: "Empty: one sentence and a relevant action button". */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
