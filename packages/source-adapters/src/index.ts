export {
  discoverDefaultSourcesForHost,
  discoverHostToolsForHost,
  getDefaultSources,
  getDefaultSourcesForHost,
  getSourceFormatProfiles,
  runSourceProbe,
  streamSourceProbe,
  projectFileSessionInputs,
  getBuiltinMaskTemplates,
  listSourceFiles,
} from "./core/legacy.js";
export { buildStageRuns, selectTailBlob } from "./core/projections.js";
export { listPlatformAdapters, listPlatformAdaptersBySupportTier, listStablePlatformAdapters } from "./platforms/registry.js";
export type { HostDiscoveryCandidate, HostDiscoveryEntry } from "./core/legacy.js";
export type { SourceProbeProgressEvent, SourceProbeProgressStage, SourceProbeEvent, SourceProbeFileChunk, SourceProbeFileSkipReason } from "./core/types.js";
export type { AdapterSupportTier, PlatformAdapter, SupportedSourcePlatform } from "./platforms/types.js";
