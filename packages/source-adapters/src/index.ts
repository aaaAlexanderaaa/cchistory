export {
  discoverDefaultSourcesForHost,
  discoverHostToolsForHost,
  getDefaultSources,
  getDefaultSourcesForHost,
  getSourceFormatProfiles,
  runSourceProbe,
  getBuiltinMaskTemplates,
} from "./core/legacy.js";
export { listPlatformAdapters, listPlatformAdaptersBySupportTier, listStablePlatformAdapters } from "./platforms/registry.js";
export type { HostDiscoveryCandidate, HostDiscoveryEntry } from "./core/legacy.js";
export type { AdapterSupportTier, PlatformAdapter, SupportedSourcePlatform } from "./platforms/types.js";
