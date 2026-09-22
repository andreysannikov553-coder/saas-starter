/**
 * Pricing configuration.
 *
 * This list is the allow-list for checkout: a price id that is not here is
 * never sent to Stripe. Without that check any signed-in user could open a
 * checkout session against any price in the account, including archived or
 * internal ones.
 */

export type PlanId = "free" | "pro" | "business";

export type PricingPlan = {
  id: PlanId;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  /** Empty for plans that are not sold through Stripe. */
  stripePriceId: string;
  features: string[];
  highlighted?: boolean;
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    description: "Чтобы попробовать продукт",
    price: 0,
    currency: "USD",
    interval: "month",
    stripePriceId: "",
    features: ["10 000 токенов в месяц", "Базовые функции", "Поддержка сообщества"],
  },
  {
    id: "pro",
    name: "Pro",
    description: "Для регулярной работы",
    price: 29,
    currency: "USD",
    interval: "month",
    stripePriceId: process.env.STRIPE_PRICE_ID_PRO ?? "",
    features: ["100 000 токенов в месяц", "Все функции", "Приоритетная поддержка", "Доступ к API"],
    highlighted: true,
  },
  {
    id: "business",
    name: "Business",
    description: "Для команд",
    price: 99,
    currency: "USD",
    interval: "month",
    stripePriceId: process.env.STRIPE_PRICE_ID_BUSINESS ?? "",
    features: [
      "Всё из Pro",
      "Без лимита на генерации",
      "Выделенная поддержка",
      "Управление командой",
    ],
  },
];

/**
 * Price ids we are willing to sell. Empty strings are excluded deliberately:
 * an unset `STRIPE_PRICE_ID_*` must not make `""` a purchasable price, and
 * must not let the free plan be matched by a blank lookup.
 */
export function purchasablePriceIds(): string[] {
  return PRICING_PLANS.map((plan) => plan.stripePriceId).filter(
    (id): id is string => id.length > 0
  );
}

export function isPurchasablePriceId(priceId: string): boolean {
  return priceId.length > 0 && purchasablePriceIds().includes(priceId);
}

export function getPlanByPriceId(priceId: string | null | undefined): PricingPlan | undefined {
  if (!priceId) return undefined;
  return PRICING_PLANS.find((plan) => plan.stripePriceId === priceId);
}

export function getPlanById(planId: string): PricingPlan | undefined {
  return PRICING_PLANS.find((plan) => plan.id === planId);
}

/**
 * The plan a subscription grants. An unrecognised price id falls back to free
 * rather than to the highest tier.
 */
export function resolvePlan(priceId: string | null | undefined): PricingPlan {
  return getPlanByPriceId(priceId) ?? PRICING_PLANS[0];
}
