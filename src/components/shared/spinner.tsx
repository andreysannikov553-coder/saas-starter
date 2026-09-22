import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
} as const;

export function Spinner({
  size = "md",
  className,
  label = "Загрузка",
}: {
  size?: keyof typeof sizes;
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-live="polite">
      <Loader2 className={cn("animate-spin", sizes[size], className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
