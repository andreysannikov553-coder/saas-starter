"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { LayoutDashboard, Settings, CreditCard, Sparkles, LogOut, Menu, X } from "lucide-react";
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

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="p-6">
        <Link href="/dashboard" className="flex items-center space-x-2" onClick={onNavigate}>
          <span className="text-lg font-bold">SaaS</span>
        </Link>
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 p-4">
        {routes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            onClick={onNavigate}
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
    </>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="bg-background flex items-center justify-between border-b p-4 md:hidden">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <span className="text-lg font-bold">SaaS</span>
        </Link>
        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Открыть меню">
              <Menu className="h-5 w-5" />
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80" />
            <DialogPrimitive.Content
              className={cn(
                "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r shadow-lg duration-200"
              )}
            >
              <DialogPrimitive.Title className="sr-only">Меню навигации</DialogPrimitive.Title>
              <DialogPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none">
                <X className="h-4 w-4" />
                <span className="sr-only">Закрыть</span>
              </DialogPrimitive.Close>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>

      {/* Desktop fixed sidebar */}
      <div className="bg-background hidden h-full w-64 flex-col border-r md:flex">
        <SidebarNav />
      </div>
    </>
  );
}
