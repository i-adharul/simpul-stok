import type { ReactNode } from "react";
import { errorPageCopy, type ErrorStatus } from "./error-page-copy";

type ErrorPageProps = {
  status: ErrorStatus;
  /** Buttons or links; the caller decides because the target depends on login state. */
  actions: ReactNode;
};

/** S23: one centered card per error status. Presentational only, safe in client components. */
export function ErrorPage({ status, actions }: ErrorPageProps) {
  const { title, description } = errorPageCopy[status];
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Status {status}
      </span>
      <h1 className="font-heading text-2xl font-bold">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div>
    </section>
  );
}
