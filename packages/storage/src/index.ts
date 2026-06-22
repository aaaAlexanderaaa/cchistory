export { CCHistoryStorage } from "./internal/storage.js";
export type {
  StorageBoundaryContextRef,
  StorageBoundaryDerivedCacheRef,
  StorageBoundaryLedgerRef,
  StorageBoundaryRebuildPlan,
  StorageBoundaryRebuildScopeSelector,
  StorageBoundaryRecordSpanRef,
  StorageBoundaryTurnRef,
} from "./internal/rebuild-scope.js";
export { pruneOrphanRawSnapshots, type RawSnapshotGcResult } from "./raw-gc.js";
export { STORAGE_SCHEMA_VERSION, isFutureStorageSchemaVersion, type StorageSchemaInfo, type StorageSchemaMigration } from "./db/schema.js";
export { buildLocalReadOverview, type LocalReadOverview, type LocalReadOverviewCounts, type LocalReadProjectPreview } from "./read-overview.js";
export {
  buildLocalTuiBrowser,
  type LocalTuiBrowser,
  type LocalTuiBrowserProject,
  type LocalTuiBrowserTurn,
  type LocalTuiSearchGroup,
  type LocalTuiSearchPage,
  type LocalTuiSearchResult,
  type LocalTuiSourceHealth,
} from "./tui-browser.js";
export { readStorageFootprintInventory, type EvidenceStoreInventory, type SearchIndexInventory, type SourceRootInventory, type StorageFileInventory, type StorageFootprintInventory, type StoragePayloadRowInventory, type StorageTableInventory } from "./inventory.js";
export {
  readStorageBoundaryMigrationPreview,
  type AffectedCounts,
  type BackfillGap,
  type RemovableBytes,
  type RowMapping,
  type StorageBoundaryMigrationPreview,
  type V1ToV2Mapping,
  type VacuumDiskRequirement,
} from "./migration-preview.js";
export {
  clearMigrationState,
  clearMigrationStatesByPhase,
  isMigrationScopeCompleted,
  listMigrationStates,
  readMigrationState,
  recordMigrationAbort,
  recordMigrationComplete,
  recordMigrationProgress,
  recordMigrationStart,
  type MigrationPhase,
  type MigrationScope,
  type MigrationScopeKind,
  type MigrationStateRow,
  type MigrationStatus,
} from "./migration-state.js";
export {
  backfillStorageBoundaryV2ForStore,
  type BackfillProgressEvent,
  type BackfillSourceResult,
  type BackfillStoreResult,
} from "./migration-write.js";
export {
  runMigrationValidate,
  type BundleByteDiffResult,
  type BundleChecksumCompare,
  type InventoryDiffResult,
  type MigrationValidateInput,
  type MigrationValidateProgressEvent,
  type MigrationValidateResult,
  type MigrationValidatorKind,
  type MigrationValidatorOutcome,
  type ReadPathParityResult,
} from "./migration-validate.js";
export { matchesSearchCandidateQuery, type SearchCandidateFields } from "./queries/search.js";
export { installRuntimeWarningFilter } from "./runtime-warning-filter.js";
