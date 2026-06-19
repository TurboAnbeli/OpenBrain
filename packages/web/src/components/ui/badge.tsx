import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300", className)} {...props} />;
}
