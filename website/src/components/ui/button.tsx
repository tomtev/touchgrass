import type { Child } from "hono/jsx";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

interface ButtonProps extends ButtonVariants {
  class?: string;
  href?: string;
  target?: string;
  rel?: string;
  children?: Child;
}

export function Button({
  class: className,
  variant,
  size,
  href,
  target,
  rel,
  children,
}: ButtonProps) {
  if (href) {
    return (
      <a href={href} target={target} rel={rel} class={cn(buttonVariants({ variant, size }), className)}>
        {children}
      </a>
    );
  }

  return <button class={cn(buttonVariants({ variant, size }), className)}>{children}</button>;
}
