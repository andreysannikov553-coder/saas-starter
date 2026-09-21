"use client";

import { useActionState, useState } from "react";
import { generateContent } from "@/lib/actions/ai";
import { ALLOWED_MODELS, DEFAULT_MODEL } from "@/lib/ai/models";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";
import { FormMessage } from "@/components/auth/form-message";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GenerateState = {
  error?: string;
  content?: string;
  tokens?: number;
} | null;

async function generateAction(
  _prevState: GenerateState,
  formData: FormData
): Promise<GenerateState> {
  const result = await generateContent(formData);

  if (result.error) {
    return { error: result.error };
  }

  return { content: result.data?.content, tokens: result.data?.tokens };
}

export function GenerateContentForm() {
  const [state, formAction] = useActionState(generateAction, null);
  const [prompt, setPrompt] = useState("");

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="prompt">Запрос</Label>
          <Textarea
            id="prompt"
            name="prompt"
            required
            minLength={1}
            maxLength={5000}
            rows={6}
            placeholder="Опишите, что нужно сгенерировать…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">{prompt.length} / 5000</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="model">Модель</Label>
          <select
            id="model"
            name="model"
            defaultValue={DEFAULT_MODEL}
            className="border-input focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            {ALLOWED_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <FormMessage error={state?.error} />

        <SubmitButton className="w-auto" pendingLabel="Генерация…">
          Сгенерировать
        </SubmitButton>
      </form>

      {state?.content && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Результат</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm whitespace-pre-wrap">{state.content}</p>
            {typeof state.tokens === "number" && (
              <p className="text-muted-foreground text-xs">Использовано токенов: {state.tokens}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
