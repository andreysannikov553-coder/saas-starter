import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Восстановление пароля",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Забыли пароль?</CardTitle>
          <CardDescription>
            Укажите email — пришлём ссылку для установки нового пароля
          </CardDescription>
        </CardHeader>
        <ForgotPasswordForm />
      </Card>
    </div>
  );
}
