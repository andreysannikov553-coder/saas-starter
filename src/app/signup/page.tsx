import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignUpForm } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Регистрация",
};

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Создать аккаунт</CardTitle>
          <CardDescription>Начните бесплатно, без карты</CardDescription>
        </CardHeader>
        <SignUpForm />
      </Card>
    </div>
  );
}
