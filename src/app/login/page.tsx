import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Вход",
};

const LINK_ERRORS: Record<string, string> = {
  missing_code: "Ссылка недействительна. Запросите новую.",
  invalid_link: "Ссылка устарела или уже использована. Запросите новую.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Вход</CardTitle>
          <CardDescription>Войдите, чтобы продолжить работу</CardDescription>
        </CardHeader>
        <LoginForm next={next} notice={error ? LINK_ERRORS[error] : undefined} />
      </Card>
    </div>
  );
}
