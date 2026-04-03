const SQLITE_EXPERIMENTAL_WARNING_TEXT = 'SQLite is an experimental feature and might change at any time';

if (process.env.CCHISTORY_SHOW_RUNTIME_WARNINGS !== '1') {
  const currentEmitWarning = process.emitWarning;
  if (!currentEmitWarning.__cchistoryRuntimeFilterInstalled) {
    const originalEmitWarning = process.emitWarning.bind(process);
    const filteredEmitWarning = Object.assign(
      (warning, ...args) => {
        const message = typeof warning === 'string' ? warning : warning?.message;
        if (String(message).includes(SQLITE_EXPERIMENTAL_WARNING_TEXT)) {
          return;
        }
        return originalEmitWarning(warning, ...args);
      },
      { __cchistoryRuntimeFilterInstalled: true },
    );
    process.emitWarning = filteredEmitWarning;
  }
}
