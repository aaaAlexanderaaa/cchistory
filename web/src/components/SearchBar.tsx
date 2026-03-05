import { useState, useCallback } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
}

export default function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (value.trim()) onSearch(value.trim());
    },
    [value, onSearch]
  );

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search across all history sources..."
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm
                   text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2
                   focus:ring-violet-500/50 focus:border-violet-500 transition-colors"
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700
                   disabled:text-gray-500 text-white rounded-lg text-sm font-medium
                   transition-colors"
      >
        {loading ? "..." : "Search"}
      </button>
    </form>
  );
}
