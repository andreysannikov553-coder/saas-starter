"use client";

import { useActionState } from "react";
import Link from "next/link";
import { setNewPassword, type AuthFormState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(setNewPassword, null);

  if (state?.message) {
    return (
      <CardContent>
        <FormMessage message={state.message} />
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-primary font-medium hover:underline">
            Войти с новым паролем
          </Link>
        </p>
      </CardContent>
    );
  }

  return (
    <form action={formAction}>
      <CardContent className="space-y-4">
        <FormMessage error={state?.error} />
        <div className="space-y-2">
          <Label htmlFor="newPassword">Новый пароль</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="new-password-hint"
          />
          <p id="new-password-hint" className="text-muted-foreground text-xs">
            Минимум 8 символов, заглавная и строчная буквы, цифра
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Повторите пароль</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(state?.fieldErrors?.confirmPassword)}
          />
        </div>
      </CardContent>
      <CardFooter>
        <SubmitButton pendingLabel="Сохраняем…">Сохранить пароль</SubmitButton>
      </CardFooter>
    </form>
  );
}
