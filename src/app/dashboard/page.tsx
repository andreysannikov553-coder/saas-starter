import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardOverview } from "@/lib/actions/dashboard";
import { formatNumber } from "@/lib/utils/format";
import { Sparkles, CreditCard, Activity, TrendingUp } from "lucide-react";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const { data } = await getDashboardOverview();
  const usage = data?.usage ?? 0;
  const subscription = data?.subscription ?? null;
  const entitlements = data?.entitlements;
  const limit = entitlements?.aiTokenLimit ?? 0;
  const isUnlimited = limit < 0;
  const usagePercent = isUnlimited ? 0 : limit > 0 ? Math.min(100, (usage / limit) * 100) : 0;

  const stats = [
    {
      title: "Расход AI",
      value: `${formatNumber(usage)} токенов`,
      description: "В этом месяце",
      icon: Sparkles,
    },
    {
      title: "Тариф",
      value: entitlements ? (PLAN_LABELS[entitlements.plan] ?? entitlements.plan) : "Free",
      description: subscription?.currentPeriodEnd
        ? `Продление ${new Date(subscription.currentPeriodEnd).toLocaleDateString("ru-RU")}`
        : "Без активной подписки",
      icon: CreditCard,
    },
    {
      title: "Статус аккаунта",
      value: "Активен",
      description: "Всё работает штатно",
      icon: Activity,
    },
    {
      title: "Лимит тарифа",
      value: isUnlimited ? "Без ограничений" : `${formatNumber(limit)} токенов`,
      description: isUnlimited ? "—" : `Использовано ${usagePercent.toFixed(0)}%`,
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Дашборд</h1>
        <p className="text-muted-foreground">С возвращением, {user.email}!</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="text-muted-foreground h-4 w-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-muted-foreground text-xs">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Первые шаги</CardTitle>
          <CardDescription>С чего начать работу с аккаунтом</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link href="/dashboard/settings" className="hover:bg-accent block rounded-lg border p-4">
            <h3 className="font-semibold">Заполните профиль</h3>
            <p className="text-muted-foreground text-sm">Укажите имя и аватар в настройках</p>
          </Link>
          <Link href="/dashboard/ai" className="hover:bg-accent block rounded-lg border p-4">
            <h3 className="font-semibold">Попробуйте AI-функции</h3>
            <p className="text-muted-foreground text-sm">
              Сгенерируйте первый контент с помощью AI
            </p>
          </Link>
          <Link href="/pricing" className="hover:bg-accent block rounded-lg border p-4">
            <h3 className="font-semibold">Выберите тариф</h3>
            <p className="text-muted-foreground text-sm">
              Сравните возможности на странице тарифов
            </p>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
