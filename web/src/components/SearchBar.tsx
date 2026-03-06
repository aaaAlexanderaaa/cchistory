interface SearchBarProps {
  value: string;
  loading?: boolean;
  ariaLabel: string;
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}

export default function SearchBar({
  value,
  loading,
  ariaLabel,
  placeholder,
  submitLabel,
  submittingLabel,
  clearLabel,
  onChange,
  onSubmit,
  onClear,
}: SearchBarProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 xl:flex-row"
    >
      <label className="sr-only" htmlFor="search-input">
        {ariaLabel}
      </label>
      <input
        id="search-input"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-4 py-2.5 text-sm text-slate-200 outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-soft)]"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--bg-deep)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? submittingLabel : submitLabel}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-slate-200"
        >
          {clearLabel}
        </button>
      </div>
    </form>
  );
}
