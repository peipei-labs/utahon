import Link from "next/link";
import { cn } from "@/lib/utils";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function issueLabel(date: Date = new Date()): string {
  const volume = Math.max(1, date.getFullYear() - 2022);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `Vol. ${volume.toString().padStart(2, "0")}  ·  ${date.getFullYear()}.${month}`;
}

export function issueShort(date: Date = new Date()): string {
  const volume = Math.max(1, date.getFullYear() - 2022);
  return `VOL. ${volume.toString().padStart(2, "0")} · ${MONTH_SHORT[date.getMonth()].toUpperCase()} ${date.getFullYear()}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function relativeAdded(createdAt: number, now: number = Date.now()): string {
  const days = Math.max(0, Math.floor((now - createdAt) / 86400000));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return `${Math.floor(days / 30)} 月前`;
}

export function stalenessLevel(createdAt: number, now: number = Date.now()): number {
  return Math.max(
    1,
    Math.min(5, 1 + Math.floor((now - createdAt) / 86400000 / 3))
  );
}

export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Smallcaps({
  children,
  as: Tag = "span",
  className,
  tone = "mute",
}: {
  children: React.ReactNode;
  as?: "span" | "div" | "h3";
  className?: string;
  tone?: "mute" | "ink" | "soft" | "red";
}) {
  const toneClass =
    tone === "ink"
      ? "text-ink"
      : tone === "soft"
      ? "text-ink-soft"
      : tone === "red"
      ? "text-red"
      : "text-ink-mute";
  return (
    <Tag
      className={cn(
        "font-mono text-[10px] tracking-[0.22em] uppercase",
        toneClass,
        className
      )}
    >
      {children}
    </Tag>
  );
}

export function Rule({
  bold = false,
  className,
}: {
  bold?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-px w-full",
        bold ? "bg-ink" : "bg-rule",
        className
      )}
    />
  );
}

type DesktopNavItem = {
  href: string;
  label: string;
  active?: boolean;
};

export function DesktopNav({
  items,
  trailing,
}: {
  items: DesktopNavItem[];
  trailing?: React.ReactNode;
}) {
  return (
    <nav className="hidden md:flex items-center gap-5 font-mono text-[11px] tracking-[0.18em] uppercase">
      {items.map((item, i) => (
        <span key={item.href} className="flex items-center gap-5">
          {i > 0 && <span className="text-rule">·</span>}
          <Link
            href={item.href}
            className={cn(
              "transition",
              item.active
                ? "text-ink border-b-2 border-red pb-0.5"
                : "text-ink-soft hover:text-ink"
            )}
          >
            {item.label}
          </Link>
        </span>
      ))}
      {trailing}
    </nav>
  );
}

export function Masthead({
  kicker = "UTAHON",
  title,
  sub,
  right,
  className,
}: {
  kicker?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-8 border-b border-ink pb-3 md:pb-4",
        className
      )}
    >
      <div className="min-w-0">
        <Smallcaps tone="soft" className="block">
          {kicker} · {issueLabel()}
        </Smallcaps>
        <div className="font-serif italic font-medium text-[40px] md:text-[56px] leading-[0.95] tracking-[-0.01em] text-ink mt-2">
          {title}
        </div>
        {sub && (
          <div className="font-serif italic text-ink-soft mt-1.5 text-sm md:text-base">
            {sub}
          </div>
        )}
      </div>
      {right && (
        <div className="shrink-0 flex items-end gap-3 flex-wrap">{right}</div>
      )}
    </header>
  );
}

export function MobileTopBar({
  title,
  right,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="md:hidden flex items-end justify-between border-b border-ink pb-3 pt-1 gap-3">
      <div className="min-w-0">
        <Smallcaps tone="soft">UTAHON · {issueShort()}</Smallcaps>
        <div className="font-serif italic font-medium text-[30px] leading-none text-ink mt-1 truncate">
          {title}
        </div>
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

export function PageFrame({
  children,
  withTabBar = true,
  className,
}: {
  children: React.ReactNode;
  withTabBar?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-screen bg-paper text-ink",
        withTabBar && "pb-24 md:pb-16",
        className
      )}
    >
      <div className="max-w-[1400px] mx-auto px-5 md:px-12 lg:px-16 pt-6 md:pt-11">
        {children}
      </div>
    </div>
  );
}

export function Colophon({ children }: { children: React.ReactNode }) {
  return (
    <footer className="mt-16 md:mt-20 border-t border-ink pt-3.5 flex flex-col sm:flex-row justify-between gap-2 font-mono text-[10px] tracking-[0.22em] uppercase text-ink-soft">
      {children}
    </footer>
  );
}

export function LevelPips({
  level,
  className,
}: {
  level: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, Math.round(level)));
  return (
    <span
      aria-label={`熟练度 ${clamped}/5`}
      className={cn(
        "font-mono text-[9px] tracking-[0.18em] text-ink-mute tabular",
        className
      )}
    >
      {"●".repeat(clamped)}
      {"○".repeat(5 - clamped)}
    </span>
  );
}
