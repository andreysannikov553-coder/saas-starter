"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/shared/spinner";

export function SubmitButton({
  children,
  pendingLabel,
  className = "w-full",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <Spinner size="sm" className="mr-2" />
          {pendingLabel ?? "Подождите…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
