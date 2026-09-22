import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Новый пароль",
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Новый пароль</CardTitle>
          <CardDescription>Придумайте пароль, которым будете входить</CardDescription>
        </CardHeader>
        <ResetPasswordForm />
      </Card>
    </div>
  );
}
