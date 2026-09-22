"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp, type AuthFormState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export function SignUpForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signUp, null);

  // On success the action returns only a message (confirm your email) or
  // redirects. Either way the form is done, so stop offering it.
  if (state?.message) {
    return (
      <CardContent>
        <FormMessage message={state.message} />
        <p className="text-muted-foreground mt-4 text-center text-sm">
          <Link href="/login" className="text-primary font-medium hover:underline">
            Вернуться ко входу
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
          <Label htmlFor="name">Имя</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Как к вам обращаться"
            required
            aria-invalid={Boolean(state?.fieldErrors?.name)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="your.email@example.com"
            required
            aria-invalid={Boolean(state?.fieldErrors?.email)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="password-hint"
            aria-invalid={Boolean(state?.fieldErrors?.password)}
          />
          <p id="password-hint" className="text-muted-foreground text-xs">
            Минимум 8 символов, заглавная и строчная буквы, цифра
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <SubmitButton pendingLabel="Создаём аккаунт…">Создать аккаунт</SubmitButton>
        <p className="text-muted-foreground text-center text-sm">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Войти
          </Link>
        </p>
      </CardFooter>
    </form>
  );
}
