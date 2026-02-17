import type { Child } from "hono/jsx";
import { cn } from "@/lib/utils";

interface BadgeProps {
  class?: string;
  children?: Child;
}

export function Badge({ class: className, children }: BadgeProps) {
  return (
    <span
      class={cn(
        "inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
