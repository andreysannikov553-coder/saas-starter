import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEntitlements } from "@/lib/billing/entitlements";
import { PRICING_PLANS } from "@/lib/stripe/pricing";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ManageBillingButton,
  CancelSubscriptionButton,
  ResumeSubscriptionButton,
  SubscribeButton,
} from "@/components/dashboard/billing-actions";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Активна",
  TRIALING: "Пробный период",
  PAST_DUE: "Просрочен платёж",
  CANCELED: "Отменена",
  INCOMPLETE: "Не завершена",
  INCOMPLETE_EXPIRED: "Истекла",
  UNPAID: "Не оплачена",
};

export default async function DashboardBillingPage() {
  const userId = await requireUserId();

  const [subscription, entitlements] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    getEntitlements(userId),
  ]);

  const hasStripeCustomer = Boolean(subscription?.stripeCustomerId);
  const hasActiveStripeSubscription = Boolean(subscription?.stripeSubscriptionId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Оплата</h1>
        <p className="text-muted-foreground">Управляйте тарифом и способом оплаты</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Текущий тариф</CardTitle>
            <Badge variant={entitlements.plan === "free" ? "secondary" : "default"}>
              {PLAN_LABELS[entitlements.plan] ?? entitlements.plan}
            </Badge>
          </div>
          <CardDescription>
            {subscription?.status
              ? (STATUS_LABELS[subscription.status] ?? subscription.status)
              : "Без активной подписки"}
            {subscription?.currentPeriodEnd &&
              ` · продление ${new Date(subscription.currentPeriodEnd).toLocaleDateString("ru-RU")}`}
            {subscription?.cancelAtPeriodEnd && " · подписка будет отменена в конце периода"}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-3">
          {hasStripeCustomer && <ManageBillingButton />}
          {hasActiveStripeSubscription &&
            (subscription?.cancelAtPeriodEnd ? (
              <ResumeSubscriptionButton />
            ) : (
              <CancelSubscriptionButton />
            ))}
        </CardFooter>
      </Card>

      {entitlements.plan === "free" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Доступные тарифы</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {PRICING_PLANS.filter((plan) => plan.stripePriceId).map((plan) => (
              <Card key={plan.id} className={plan.highlighted ? "border-primary" : ""}>
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline">
                    <span className="text-3xl font-bold">${plan.price}</span>
                    <span className="text-muted-foreground ml-2">/{plan.interval}</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <SubscribeButton
                    priceId={plan.stripePriceId}
                    label={`Перейти на ${plan.name}`}
                    variant={plan.highlighted ? "default" : "outline"}
                  />
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
