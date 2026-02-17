import type { Child } from "hono/jsx";
import { cn } from "@/lib/utils";

interface CardProps {
  class?: string;
  children?: Child;
}

export function Card({ class: className, children }: CardProps) {
  return <div class={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)}>{children}</div>;
}

export function CardHeader({ class: className, children }: CardProps) {
  return <div class={cn("space-y-1.5 p-6", className)}>{children}</div>;
}

export function CardTitle({ class: className, children }: CardProps) {
  return <h3 class={cn("text-xl font-semibold leading-none tracking-tight", className)}>{children}</h3>;
}

export function CardDescription({ class: className, children }: CardProps) {
  return <p class={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}

export function CardContent({ class: className, children }: CardProps) {
  return <div class={cn("p-6 pt-0", className)}>{children}</div>;
}
