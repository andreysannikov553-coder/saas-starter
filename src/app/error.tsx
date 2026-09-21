"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Route-level error boundary.
 *
 * Deliberately shows no `error.message`: this renders whatever was thrown,
 * including Prisma errors naming tables and columns. The digest is enough to
 * find the real error in the logs.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="bg-destructive/10 flex h-12 w-12 items-center justify-center rounded-full">
        <AlertTriangle className="text-destructive h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Мы уже знаем о проблеме. Попробуйте повторить действие — если не поможет, обновите
          страницу чуть позже.
        </p>
      </div>
      <Button onClick={reset}>Попробовать снова</Button>
      {error.digest ? (
        <p className="text-muted-foreground text-xs">Код ошибки: {error.digest}</p>
      ) : null}
    </div>
  );
}
