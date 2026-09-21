"use server";

import { prisma } from "@/lib/db";
import { getCurrentUser, requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  handleServerAction,
  AppError,
  AuthenticationError,
  NotFoundError,
} from "@/lib/utils/error";
import { updateUserSchema } from "@/lib/validation/user";
import { getMonthlyUsage } from "@/lib/ai/utils";
import { logger } from "@/lib/utils/logger";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Get current user profile
 */
export async function getUserProfile() {
  return handleServerAction(async () => {
    const authUser = await getCurrentUser();
    if (!authUser) {
      throw new AuthenticationError();
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        subscription: {
          select: {
            status: true,
            plan: true,
            currentPeriodEnd: true,
            stripePriceId: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError("Профиль не найден");
    }

    return user;
  });
}

/**
 * Update user profile
 */
export async function updateUserProfile(formData: FormData) {
  return handleServerAction(async () => {
    const userId = await requireUserId();

    const rawData = {
      name: (formData.get("name") as string) || undefined,
      avatarUrl: (formData.get("avatarUrl") as string) || undefined,
    };

    const validatedData = updateUserSchema.parse(rawData);

    const user = await prisma.user.update({
      where: { id: userId },
      data: validatedData,
    });

    revalidatePath("/dashboard/settings");
    return user;
  });
}

/**
 * Get user usage statistics for the current billing period.
 *
 * `getMonthlyUsage` is the one place "current period" is computed — this
 * used to have its own local-timezone reimplementation.
 */
export async function getUserUsage() {
  return handleServerAction(async () => {
    const userId = await requireUserId();
    const totalUsage = await getMonthlyUsage(userId);
    return { totalUsage, period: "month" };
  });
}

/**
 * Delete the current user's account, everywhere it exists.
 *
 * Three systems know about this user — Supabase Auth, our database, and (if
 * they ever subscribed) Stripe — and this used to touch only the second one.
 * The result was an account that could still sign in with no profile, and a
 * subscription that kept billing a deleted user. Order matters: cancel
 * billing and delete the Auth identity first, since both can still fail and
 * be retried; only drop the local row once nothing else needs it to exist.
 */
export async function deleteUserAccount() {
  return handleServerAction(async () => {
    const authUser = await getCurrentUser();
    if (!authUser) {
      throw new AuthenticationError();
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: authUser.id },
      select: { stripeSubscriptionId: true },
    });

    if (subscription?.stripeSubscriptionId) {
      const { stripe } = await import("@/lib/stripe/client");
      try {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      } catch (error) {
        logger.error("Failed to cancel Stripe subscription on account deletion", error);
        throw new AppError(
          "Не удалось отменить подписку. Попробуйте ещё раз или напишите в поддержку.",
          502
        );
      }
    }

    const admin = createAdminClient();
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(authUser.id);
    if (authDeleteError) {
      logger.error("Failed to delete Supabase Auth user", authDeleteError.message);
      throw new AppError(
        "Не удалось удалить аккаунт. Попробуйте ещё раз или напишите в поддержку.",
        502
      );
    }

    // Cascades to Subscription, Usage, ApiKey, GeneratedContent.
    await prisma.user.delete({ where: { id: authUser.id } }).catch((error) => {
      // The Auth identity is already gone at this point, which is the part
      // that matters for "can this person still log in" and for billing. A
      // leftover local row is a cleanup job, not a reason to tell the user
      // deletion failed.
      logger.error("Auth user deleted but local row cleanup failed", error);
    });

    const supabase = await createClient();
    await supabase.auth.signOut();

    revalidatePath("/", "layout");
    redirect("/");
  });
}
