import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * The single place an auth form reports back to the user.
 *
 * `role="alert"` so a screen reader announces it: these messages appear after
 * a submit, when focus is nowhere near them.
 */
export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;

  const isError = Boolean(error);

  return (
    <div
      role="alert"
      className={
        isError
          ? "border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          : "flex items-start gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
      }
    >
      {isError ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{error ?? message}</span>
    </div>
  );
}
