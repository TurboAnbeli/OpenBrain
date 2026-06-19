import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-violet-500/40 placeholder:text-zinc-500 focus:border-violet-500 focus:ring-2",
        className
      )}
      {...props}
    />
  );
}
