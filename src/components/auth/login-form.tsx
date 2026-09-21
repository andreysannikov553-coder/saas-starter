"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, type AuthFormState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signIn, null);

  return (
    <form action={formAction}>
      <CardContent className="space-y-4">
        <FormMessage error={state?.error ?? notice} message={state?.message} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Пароль</Label>
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Забыли пароль?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <SubmitButton pendingLabel="Входим…">Войти</SubmitButton>
        <p className="text-muted-foreground text-center text-sm">
          Нет аккаунта?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </CardFooter>
    </form>
  );
}
