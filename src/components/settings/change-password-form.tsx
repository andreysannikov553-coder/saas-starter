"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type AuthFormState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";
import { useToast } from "@/hooks/use-toast";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(changePassword, null);
  const { toast } = useToast();
  const lastHandled = useRef<AuthFormState>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === lastHandled.current) return;
    lastHandled.current = state;

    if (state?.error) {
      toast({
        title: "Не удалось изменить пароль",
        description: state.error,
        variant: "destructive",
      });
    } else if (state?.message) {
      toast({ title: state.message });
      formRef.current?.reset();
    }
  }, [state, toast]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Текущий пароль</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(state?.fieldErrors?.currentPassword)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">Новый пароль</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Повторите пароль</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
        />
      </div>
      <SubmitButton className="w-fit" pendingLabel="Сохраняем…">
        Обновить пароль
      </SubmitButton>
    </form>
  );
}
