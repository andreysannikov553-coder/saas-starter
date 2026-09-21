"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type AuthFormState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(requestPasswordReset, null);

  return (
    <form action={formAction}>
      <CardContent className="space-y-4">
        <FormMessage error={state?.error} message={state?.message} />
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="your.email@example.com"
            required
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <SubmitButton pendingLabel="Отправляем…">Отправить ссылку</SubmitButton>
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/login" className="text-primary font-medium hover:underline">
            Вернуться ко входу
          </Link>
        </p>
      </CardFooter>
    </form>
  );
}
