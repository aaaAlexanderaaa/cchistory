interface SourceBadgeProps {
  source: string;
}

const SOURCE_COLORS: Record<string, string> = {
  "Claude Code": "bg-violet-600/20 text-violet-300 border-violet-500/30",
  Brave: "bg-orange-600/20 text-orange-300 border-orange-500/30",
  Chrome: "bg-blue-600/20 text-blue-300 border-blue-500/30",
  LobeChat: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
  Codex: "bg-cyan-600/20 text-cyan-300 border-cyan-500/30",
};

export default function SourceBadge({ source }: SourceBadgeProps) {
  const colors =
    SOURCE_COLORS[source] || "bg-gray-600/20 text-gray-300 border-gray-500/30";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors}`}
    >
      {source}
    </span>
  );
}
