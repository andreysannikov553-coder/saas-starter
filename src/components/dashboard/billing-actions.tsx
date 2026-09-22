"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/shared/spinner";
import { FormMessage } from "@/components/auth/form-message";
import {
  createPortalSession,
  cancelUserSubscription,
  resumeUserSubscription,
  createSubscriptionCheckout,
} from "@/lib/actions/subscription";

export function ManageBillingButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await createPortalSession();
            if (result.error) {
              setError(result.error);
              return;
            }
            if (result.data?.url) {
              window.location.href = result.data.url;
            }
          })
        }
      >
        {pending ? <Spinner size="sm" className="mr-2" /> : null}
        Управление платежами
      </Button>
      <FormMessage error={error} />
    </div>
  );
}

export function CancelSubscriptionButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await cancelUserSubscription();
            if (result.error) {
              setError(result.error);
            }
          })
        }
      >
        {pending ? <Spinner size="sm" className="mr-2" /> : null}
        Отменить подписку
      </Button>
      <FormMessage error={error} />
    </div>
  );
}

export function ResumeSubscriptionButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await resumeUserSubscription();
            if (result.error) {
              setError(result.error);
            }
          })
        }
      >
        {pending ? <Spinner size="sm" className="mr-2" /> : null}
        Возобновить подписку
      </Button>
      <FormMessage error={error} />
    </div>
  );
}

export function SubscribeButton({
  priceId,
  label,
  variant = "default",
}: {
  priceId: string;
  label: string;
  variant?: "default" | "outline";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        variant={variant}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await createSubscriptionCheckout(priceId);
            if (result.error) {
              setError(result.error);
              return;
            }
            if (result.data?.url) {
              window.location.href = result.data.url;
            }
          })
        }
      >
        {pending ? <Spinner size="sm" className="mr-2" /> : null}
        {label}
      </Button>
      <FormMessage error={error} />
    </div>
  );
}
