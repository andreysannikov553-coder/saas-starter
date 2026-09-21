"use client";

import { useActionState } from "react";
import { updateUserProfile } from "@/lib/actions/user";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef } from "react";

type FormState = { data?: unknown; error?: string; fieldErrors?: Record<string, string> } | null;

async function action(_prev: FormState, formData: FormData): Promise<FormState> {
  return updateUserProfile(formData);
}

export function ProfileForm({ defaultName, email }: { defaultName: string; email: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const { toast } = useToast();
  const lastHandled = useRef<FormState>(null);

  useEffect(() => {
    if (state === lastHandled.current) return;
    lastHandled.current = state;

    if (state?.error) {
      toast({ title: "Не удалось сохранить", description: state.error, variant: "destructive" });
    } else if (state?.data) {
      toast({ title: "Профиль обновлён" });
    }
  }, [state, toast]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Имя</Label>
        <Input id="name" name="name" placeholder="Ваше имя" defaultValue={defaultName} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" defaultValue={email} disabled />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить изменения"}
      </Button>
    </form>
  );
}
