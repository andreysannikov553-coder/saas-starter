"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ensureUserRecord } from "@/lib/auth";
import { AppError, AuthenticationError, toUserMessage } from "@/lib/utils/error";
import { logger } from "@/lib/utils/logger";
import {
  signInSchema,
  signUpSchema,
  resetPasswordSchema,
  changePasswordSchema,
  newPasswordSchema,
} from "@/lib/validation/auth";
import { AFTER_LOGIN_ROUTE } from "@/lib/routes";
import { checkRateLimit, requestIp } from "@/lib/rate-limit";
import { env } from "@/env.mjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Shape returned to `useActionState` on the client.
 *
 * `null` is the initial state. A successful sign-in never returns — it
 * redirects — so a returned state always means something the user must read.
 */
export type AuthFormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

/**
 * Only follow a redirect target that points back into this app, so a crafted
 * `?next=https://evil.example` cannot turn our login into an open redirect.
 */
function safeRedirectTarget(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) {
    return AFTER_LOGIN_ROUTE;
  }
  return next;
}

/**
 * Sign in with email and password.
 *
 * `redirect()` is deliberately called outside the try/catch: it works by
 * throwing, and catching it would turn a successful sign-in into an error
 * message.
 */
export async function signIn(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  let destination: string;

  try {
    await checkRateLimit("signin", await requestIp(), { limit: 10, windowSeconds: 60 });

    const parsed = signInSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Проверьте введённые данные" };
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);

    if (error) {
      // Supabase does not distinguish "no such user" from "wrong password" and
      // neither should we — that difference is an account-enumeration oracle.
      logger.warn("Failed sign-in attempt", error.message);
      return { error: "Неверный email или пароль" };
    }

    await ensureUserRecord();
    destination = safeRedirectTarget(formData.get("next"));
  } catch (error) {
    logger.error("Sign-in failed", error);
    return { error: toUserMessage(error) };
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

/**
 * Sign up with email and password.
 *
 * The local `users` row is not created here. Supabase Auth is the source of
 * truth for identity, and writing to two systems without a transaction means
 * a failed second write leaves an account that can sign in but has no profile.
 * `ensureUserRecord` reconciles the two on first authenticated request.
 */
export async function signUp(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  let needsEmailConfirmation = false;

  try {
    await checkRateLimit("signup", await requestIp(), { limit: 5, windowSeconds: 60 });

    const parsed = signUpSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      name: formData.get("name"),
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        error: issue?.message ?? "Проверьте введённые данные",
        fieldErrors: issue?.path.length ? { [issue.path.join(".")]: issue.message } : undefined,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { name: parsed.data.name },
        emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });

    if (error) {
      logger.warn("Failed sign-up attempt", error.message);
      return { error: error.message };
    }

    // With email confirmation on (the Supabase default) a user comes back with
    // no session. Sending them to the dashboard would just bounce them to the
    // login page with no explanation.
    needsEmailConfirmation = !data.session;

    if (!needsEmailConfirmation) {
      await ensureUserRecord();
    }
  } catch (error) {
    logger.error("Sign-up failed", error);
    return { error: toUserMessage(error) };
  }

  if (needsEmailConfirmation) {
    return {
      message:
        "Аккаунт создан. Мы отправили письмо со ссылкой для подтверждения — откройте его, чтобы войти.",
    };
  }

  revalidatePath("/", "layout");
  redirect(AFTER_LOGIN_ROUTE);
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    logger.error("Sign-out failed", error);
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Send password reset email.
 *
 * The response is identical whether or not the address exists, so this cannot
 * be used to find out who has an account.
 */
export async function requestPasswordReset(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const confirmation = {
    message: "Если такой аккаунт существует, мы отправили на него письмо со ссылкой.",
  };

  try {
    await checkRateLimit("password-reset", await requestIp(), { limit: 5, windowSeconds: 300 });

    const parsed = resetPasswordSchema.safeParse({ email: formData.get("email") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Укажите корректный email" };
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
    });

    if (error) {
      logger.warn("Password reset request failed", error.message);
    }
  } catch (error) {
    logger.error("Password reset request failed", error);
  }

  return confirmation;
}

/**
 * Change the password of the currently authenticated user.
 *
 * The current password is verified against a throwaway Supabase client with
 * `persistSession: false`. Verifying it on the request-scoped client — as this
 * previously did — signs the user in again as a side effect and rewrites the
 * session cookie in the middle of a settings save.
 */
export async function changePassword(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  try {
    await checkRateLimit("change-password", await requestIp(), { limit: 5, windowSeconds: 300 });

    const parsed = changePasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        error: issue?.message ?? "Проверьте введённые данные",
        fieldErrors: issue?.path.length ? { [issue.path.join(".")]: issue.message } : undefined,
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      throw new AuthenticationError("Сессия истекла. Войдите заново.");
    }

    const verifier = createSupabaseClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.currentPassword,
    });

    if (verifyError) {
      return {
        error: "Текущий пароль указан неверно",
        fieldErrors: { currentPassword: "Текущий пароль указан неверно" },
      };
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.newPassword,
    });

    if (error) {
      throw new AppError(error.message, 400);
    }
  } catch (error) {
    logger.error("Password change failed", error);
    return { error: toUserMessage(error) };
  }

  return { message: "Пароль обновлён." };
}

/**
 * Set a new password using the session created by a reset link.
 *
 * No current password here — the user does not know it. The reset link is the
 * proof, and Supabase will reject this without a valid session from it.
 */
export async function setNewPassword(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  try {
    const parsed = newPasswordSchema.safeParse({
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        error: issue?.message ?? "Проверьте введённые данные",
        fieldErrors: issue?.path.length ? { [issue.path.join(".")]: issue.message } : undefined,
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new AuthenticationError(
        "Ссылка для сброса пароля недействительна или истекла. Запросите новую."
      );
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.newPassword,
    });

    if (error) {
      throw new AppError(error.message, 400);
    }
  } catch (error) {
    logger.error("Password reset failed", error);
    return { error: toUserMessage(error) };
  }

  return { message: "Пароль обновлён. Теперь можно войти с новым паролем." };
}
