import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { PRICING_PLANS } from "@/lib/stripe/pricing";
import { getCurrentUser } from "@/lib/auth";
import { SubscribeButton } from "@/components/dashboard/billing-actions";

export default async function PricingPage() {
  const user = await getCurrentUser();

  return (
    <div className="container flex flex-col gap-8 py-8 md:py-12 lg:py-24">
      <div className="mx-auto flex max-w-232 flex-col items-center space-y-4 text-center">
        <h1 className="text-4xl leading-tight font-bold tracking-tighter md:text-6xl">
          Simple, transparent pricing
        </h1>
        <p className="text-muted-foreground max-w-[750px] text-lg sm:text-xl">
          Choose the plan that&apos;s right for you. All plans include our core features.
        </p>
      </div>

      <div className="mx-auto grid gap-6 md:max-w-5xl md:grid-cols-3">
        {PRICING_PLANS.map((plan) => (
          <Card key={plan.id} className={plan.highlighted ? "border-primary shadow-lg" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{plan.name}</CardTitle>
                {plan.highlighted && <Badge>Popular</Badge>}
              </div>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline">
                <span className="text-4xl font-bold">${plan.price}</span>
                <span className="text-muted-foreground ml-2">/{plan.interval}</span>
              </div>
              <ul className="space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="text-primary h-5 w-5 shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              {plan.price === 0 ? (
                <Button className="w-full" variant="outline" asChild>
                  <Link href={user ? "/dashboard" : "/signup"}>Get Started</Link>
                </Button>
              ) : user ? (
                <SubscribeButton
                  priceId={plan.stripePriceId}
                  label="Subscribe"
                  variant={plan.highlighted ? "default" : "outline"}
                />
              ) : (
                <Button
                  className="w-full"
                  variant={plan.highlighted ? "default" : "outline"}
                  asChild
                >
                  <Link href="/signup">Subscribe</Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
