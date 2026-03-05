import type { HistoryEntry, Message } from "../types";
import SourceBadge from "./SourceBadge";

interface ConversationViewProps {
  entry: HistoryEntry;
  onClose: () => void;
}

function RoleIcon({ role }: { role: string }) {
  switch (role) {
    case "user":
      return <span className="text-blue-400 font-bold text-xs">YOU</span>;
    case "assistant":
      return <span className="text-violet-400 font-bold text-xs">AI</span>;
    case "tool":
      return <span className="text-amber-400 font-bold text-xs">TOOL</span>;
    default:
      return <span className="text-gray-500 font-bold text-xs">SYS</span>;
  }
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "" : ""}`}>
      <div className="w-10 flex-shrink-0 pt-1 text-center">
        <RoleIcon role={msg.role} />
      </div>
      <div
        className={`flex-1 rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? "bg-gray-800 text-gray-200"
            : "bg-gray-850 text-gray-300 border border-gray-800"
        }`}
      >
        {msg.tool_name && (
          <div className="text-xs text-amber-400/70 mb-1">
            [{msg.tool_name}]
          </div>
        )}
        {msg.content || "(empty)"}
      </div>
    </div>
  );
}

export default function ConversationView({
  entry,
  onClose,
}: ConversationViewProps) {
  const isConversation = entry.type === "conversation" && entry.messages;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/50">
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-sm"
        >
          &larr; Back
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <SourceBadge source={entry.source} />
            <span className="text-sm font-medium text-gray-200 truncate">
              {entry.title}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {new Date(entry.timestamp).toLocaleString()}
            {entry.project && ` | ${entry.project}`}
            {entry.duration_seconds != null &&
              entry.duration_seconds > 0 &&
              ` | ${Math.floor(entry.duration_seconds / 60)}m`}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isConversation ? (
          entry.messages!.map((msg, i) => <MessageBubble key={i} msg={msg} />)
        ) : (
          <div className="space-y-3">
            {entry.url && (
              <div>
                <span className="text-xs text-gray-500">URL: </span>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-violet-400 hover:underline break-all"
                >
                  {entry.url}
                </a>
              </div>
            )}
            {entry.content && (
              <div className="text-sm text-gray-300 whitespace-pre-wrap">
                {entry.content}
              </div>
            )}
            {entry.metadata && Object.keys(entry.metadata).length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-1">Metadata</div>
                <pre className="text-xs text-gray-400 bg-gray-900 rounded p-3 overflow-x-auto">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
