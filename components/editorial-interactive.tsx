"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type IconButtonProps = {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  "aria-label": string;
  disabled?: boolean;
  active?: boolean;
  tone?: "default" | "red";
  type?: "button" | "submit";
  title?: string;
  className?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      children,
      onClick,
      disabled,
      active,
      tone = "default",
      type = "button",
      title,
      className,
      "aria-label": ariaLabel,
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        className={cn(
          "w-8 h-8 flex items-center justify-center border transition shrink-0",
          active
            ? "bg-ink text-paper border-ink"
            : "border-rule text-ink-soft hover:border-ink hover:text-ink",
          tone === "red" &&
            !active &&
            "hover:text-red hover:border-red",
          disabled &&
            "opacity-40 cursor-not-allowed hover:border-rule hover:text-ink-soft",
          className
        )}
      >
        {children}
      </button>
    );
  }
);

export function TextPill({
  children,
  href,
  onClick,
  active,
  disabled,
  tone = "default",
  className,
  icon,
  title,
  size = "md",
  type = "button",
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "solid" | "red" | "ghost";
  className?: string;
  icon?: React.ReactNode;
  title?: string;
  size?: "sm" | "md";
  type?: "button" | "submit";
}) {
  const base = cn(
    "inline-flex items-center gap-1.5 border transition whitespace-nowrap",
    "font-mono tracking-[0.18em] uppercase",
    size === "sm"
      ? "px-2 py-1 text-[9px] max-sm:min-h-9 max-sm:px-3"
      : "px-3 py-1.5 text-[10px]",
    active
      ? "bg-ink text-paper border-ink"
      : tone === "solid"
      ? "bg-ink text-paper border-ink hover:bg-paper hover:text-ink"
      : tone === "red"
      ? "border-red text-red hover:bg-red hover:text-paper"
      : tone === "ghost"
      ? "border-transparent text-ink-soft hover:text-ink"
      : "border-rule text-ink-soft hover:border-ink hover:text-ink",
    disabled && "opacity-40 cursor-not-allowed pointer-events-none",
    className
  );
  if (href) {
    return (
      <Link href={href} className={base} title={title}>
        {icon}
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={base}
    >
      {icon}
      {children}
    </button>
  );
}

const TAB_ITEMS: Array<{
  href: string;
  label: string;
  jp: string;
  match: (pathname: string) => boolean;
}> = [
  {
    href: "/",
    label: "Library",
    jp: "歌",
    match: (p) => p === "/" || p.startsWith("/song") || p.startsWith("/new"),
  },
  {
    href: "/vocabulary",
    label: "Vocab",
    jp: "語",
    match: (p) => p.startsWith("/vocabulary"),
  },
  {
    href: "/import",
    label: "Import",
    jp: "録",
    match: (p) => p.startsWith("/import"),
  },
];

export function TabBar() {
  const pathname = usePathname() || "/";
  return (
    <nav
      aria-label="底部导航"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-paper border-t border-ink pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex justify-around pt-2.5 pb-2.5">
        {TAB_ITEMS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center gap-[3px] px-5"
            >
              <span
                className={cn(
                  "font-serif-jp font-medium text-[19px] leading-none jp",
                  active ? "text-red" : "text-ink-mute"
                )}
              >
                {tab.jp}
              </span>
              <span
                className={cn(
                  "font-mono text-[8px] tracking-[0.2em] uppercase",
                  active ? "text-ink" : "text-ink-mute"
                )}
              >
                {tab.label}
              </span>
              {active && <span className="h-[2px] w-[18px] bg-red mt-[1px]" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
