"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { LayoutDashboard, Settings, CreditCard, Sparkles, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const routes = [
  {
    label: "Дашборд",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    label: "AI-функции",
    icon: Sparkles,
    href: "/dashboard/ai",
  },
  {
    label: "Оплата",
    icon: CreditCard,
    href: "/dashboard/billing",
  },
  {
    label: "Настройки",
    icon: Settings,
    href: "/dashboard/settings",
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="bg-background flex h-full w-64 flex-col border-r">
      <div className="p-6">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <span className="text-lg font-bold">SaaS</span>
        </Link>
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 p-4">
        {routes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className={cn(
              "hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname === route.href ? "bg-accent text-accent-foreground" : "text-muted-foreground"
            )}
          >
            <route.icon className="h-4 w-4" />
            {route.label}
          </Link>
        ))}
      </nav>
      <div className="p-4">
        <Separator className="mb-4" />
        <form action={signOut}>
          <Button type="submit" variant="ghost" className="w-full justify-start" size="sm">
            <LogOut className="mr-2 h-4 w-4" />
            Выйти
          </Button>
        </form>
      </div>
    </div>
  );
}
