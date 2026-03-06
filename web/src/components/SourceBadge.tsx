interface SourceBadgeProps {
  source: string;
}

const SOURCE_COLORS: Record<string, string> = {
  "Claude Code": "border-teal-500/30 bg-teal-500/10 text-teal-400",
  Brave: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  Chrome: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  LobeChat: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  Codex: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
};

export default function SourceBadge({ source }: SourceBadgeProps) {
  const colors =
    SOURCE_COLORS[source] || "border-slate-500/30 bg-slate-500/10 text-slate-400";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase ${colors}`}
    >
      {source}
    </span>
  );
}
