import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ParserCapability,
  SourceDefinition,
  SourceFormatProfile,
  SourcePlatform,
} from "@cchistory/domain";
import {
  deriveHostId,
  deriveSourceInstanceId,
  deriveSourceSlotId,
} from "@cchistory/domain";
import { getPlatformAdapter } from "../platforms/registry.js";
import type { DefaultSourceResolutionOptions, SupportedSourcePlatform } from "../platforms/types.js";
import type { HostDiscoveryCandidate, HostDiscoveryEntry } from "./types.js";
import { RULE_VERSION } from "./utils.js";

const DEFAULT_SOURCE_FAMILY = "local_runtime_sessions";
const EXPORT_SOURCE_FAMILY = "manual_export_bundles";

const DISCOVERY_ONLY_TOOL_SPECS = [
  {
    key: "gemini_cli",
    capability: "discover_only" as const,
    kind: "tool" as const,
    platform: "gemini" as const,
    display_name: "Gemini CLI",
    getCandidates: (options: DefaultSourceResolutionOptions): Array<Pick<HostDiscoveryCandidate, "kind" | "label" | "path">> => {
      const homeDir = options.homeDir ?? os.homedir();
      return [
        {
          kind: "artifact",
          label: "user settings",
          path: path.join(homeDir, ".gemini", "settings.json"),
        },
        {
          kind: "artifact",
          label: "tmp root",
          path: path.join(homeDir, ".gemini", "tmp"),
        },
        {
          kind: "artifact",
          label: "history root",
          path: path.join(homeDir, ".gemini", "history"),
        },
      ];
    },
  },
] as const;

const COMMON_PARSER_CAPABILITIES: readonly ParserCapability[] = [
  "token_usage",
  "text_fragments",
  "tool_calls",
  "tool_results",
  "submission_group_candidates",
  "project_observation_candidates",
  "turn_projections",
  "turn_context_projections",
  "loss_audits",
];

const SOURCE_FORMAT_PROFILES: Record<SupportedSourcePlatform, SourceFormatProfile> = {
  codex: {
    id: "codex:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codex",
    parser_version: "codex-parser@2026-03-11.1",
    description: "Codex local JSONL sessions with session_meta, turn_context, response items, tool records, and token_count events.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  claude_code: {
    id: "claude_code:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "claude_code",
    parser_version: "claude-code-parser@2026-03-11.1",
    description: "Claude Code JSONL transcripts with cwd signals, content items, tool use/results, and relation hints.",
    capabilities: ["workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  factory_droid: {
    id: "factory_droid:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "factory_droid",
    parser_version: "factory-droid-parser@2026-03-11.1",
    description: "Factory Droid JSONL sessions plus sidecar settings metadata for model and workspace evidence.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  amp: {
    id: "amp:thread-json:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "amp",
    parser_version: "amp-parser@2026-03-11.1",
    description: "AMP whole-thread JSON exports with root env metadata and message arrays.",
    capabilities: ["workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  cursor: {
    id: "cursor:vscode-state-sqlite:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "cursor",
    parser_version: "cursor-parser@2026-03-11.1",
    description: "Cursor project transcripts plus VS Code state.vscdb fallbacks, with experimental chat-store metadata/readable-fragment recovery from .cursor/chats/**/store.db.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  antigravity: {
    id: "antigravity:vscode-state-sqlite:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "antigravity",
    parser_version: "antigravity-parser@2026-03-18.1",
    description:
      "Antigravity live trajectory steps from the local language server when available, with VS Code state.vscdb and brain artifacts retained as offline evidence rather than a guaranteed raw-conversation fallback.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  gemini: {
    id: "gemini:session-json:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "gemini",
    parser_version: "gemini-parser@2026-03-27.1",
    description: "Gemini CLI local session JSON under .gemini/tmp with project mapping sidecars from .project_root and projects.json.",
    capabilities: ["session_meta", "title_signal", "workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  openclaw: {
    id: "openclaw:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "openclaw",
    parser_version: "openclaw-parser@2026-03-11.1",
    description: "OpenClaw local session JSONL transcripts plus sessions metadata sidecars.",
    capabilities: ["session_meta", "workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  opencode: {
    id: "opencode:json:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "opencode",
    parser_version: "opencode-parser@2026-03-11.1",
    description: "OpenCode exported session JSON or raw storage session/message trees.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  lobechat: {
    id: "lobechat:export-json:v1",
    family: EXPORT_SOURCE_FAMILY,
    platform: "lobechat",
    parser_version: "lobechat-parser@2026-03-11.1",
    description: "LobeChat exported JSON bundles with one or more conversations.",
    capabilities: ["session_meta", "title_signal", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  codebuddy: {
    id: "codebuddy:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codebuddy",
    parser_version: "codebuddy-parser@2026-04-01.1",
    description: "CodeBuddy project JSONL transcripts with providerData metadata and companion settings/local_storage evidence.",
    capabilities: ["session_meta", ...COMMON_PARSER_CAPABILITIES],
  },
};

const DEFAULT_SOURCE_SPECS: ReadonlyArray<
  Omit<SourceDefinition, "id" | "base_dir" | "platform"> & { platform: SupportedSourcePlatform }
> = [
  {
    slot_id: "codex",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codex",
    display_name: "Codex",
  },
  {
    slot_id: "claude_code",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "claude_code",
    display_name: "Claude Code",
  },
  {
    slot_id: "factory_droid",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "factory_droid",
    display_name: "Factory Droid",
  },
  {
    slot_id: "amp",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "amp",
    display_name: "AMP",
  },
  {
    slot_id: "cursor",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "cursor",
    display_name: "Cursor",
  },
  {
    slot_id: "antigravity",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "antigravity",
    display_name: "Antigravity",
  },
  {
    slot_id: "gemini",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "gemini",
    display_name: "Gemini CLI",
  },
  {
    slot_id: "openclaw",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "openclaw",
    display_name: "OpenClaw",
  },
  {
    slot_id: "opencode",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "opencode",
    display_name: "OpenCode",
  },
  {
    slot_id: "lobechat",
    family: EXPORT_SOURCE_FAMILY,
    platform: "lobechat",
    display_name: "LobeChat",
  },
  {
    slot_id: "codebuddy",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codebuddy",
    display_name: "CodeBuddy",
  },
];

export function getDefaultSources(): SourceDefinition[] {
  return getDefaultSourcesForHost();
}

export function discoverDefaultSourcesForHost(
  options: DefaultSourceResolutionOptions = {},
): HostDiscoveryEntry[] {
  const pathExistsFn = options.pathExists ?? existsSync;

  return DEFAULT_SOURCE_SPECS.map((source) => {
    const slotId = source.slot_id || deriveSourceSlotId(source.platform);
    const adapter = getPlatformAdapter(source.platform);
    const defaultCandidates = (adapter?.getDefaultBaseDirCandidates(buildDefaultResolutionContext(options)) ?? []).map(
      (candidate, index) => ({
        kind: "default" as const,
        label: `default ${index + 1}`,
        path: candidate,
        exists: pathExistsFn(candidate),
        selected: false,
      }),
    );
    const selectedPath =
      defaultCandidates.find((candidate) => candidate.exists)?.path ??
      defaultCandidates[0]?.path ??
      os.homedir();
    const selectedExists = defaultCandidates.some((candidate) => candidate.path === selectedPath && candidate.exists);
    const candidates: HostDiscoveryCandidate[] = defaultCandidates.map((candidate) => ({
      ...candidate,
      selected: candidate.path === selectedPath,
    }));

    for (const [index, supplementalPath] of (adapter?.getSupplementalSourceRoots?.(selectedPath) ?? []).entries()) {
      candidates.push({
        kind: "supplemental",
        label: `supplemental ${index + 1}`,
        path: supplementalPath,
        exists: pathExistsFn(supplementalPath),
        selected: false,
      });
    }

    return {
      key: slotId,
      kind: "source",
      capability: "sync",
      platform: source.platform,
      family: source.family,
      slot_id: slotId,
      display_name: source.display_name,
      selected_path: selectedPath,
      selected_exists: selectedExists,
      discovered_paths: candidates.filter((candidate) => candidate.exists).map((candidate) => candidate.path),
      candidates,
    };
  });
}

export function discoverHostToolsForHost(
  options: DefaultSourceResolutionOptions = {},
): HostDiscoveryEntry[] {
  const pathExistsFn = options.pathExists ?? existsSync;
  const sourceEntries = discoverDefaultSourcesForHost(options);
  const toolEntries = DISCOVERY_ONLY_TOOL_SPECS.map((spec) => {
    const candidates = spec.getCandidates(options).map((candidate) => ({
      ...candidate,
      exists: pathExistsFn(candidate.path),
      selected: false,
    }));
    const selectedPath = candidates.find((candidate) => candidate.exists)?.path ?? candidates[0]?.path;
    return {
      key: spec.key,
      kind: spec.kind,
      capability: spec.capability,
      platform: spec.platform,
      display_name: spec.display_name,
      selected_path: selectedPath,
      selected_exists: candidates.some((candidate) => candidate.exists),
      discovered_paths: candidates.filter((candidate) => candidate.exists).map((candidate) => candidate.path),
      candidates,
    } satisfies HostDiscoveryEntry;
  });

  return [...sourceEntries, ...toolEntries];
}

export function getDefaultSourcesForHost(
  options: DefaultSourceResolutionOptions = {},
): SourceDefinition[] {
  const hostId = deriveHostId(options.hostname ?? os.hostname());
  const discoveries = discoverDefaultSourcesForHost(options);

  return DEFAULT_SOURCE_SPECS.flatMap((source) => {
    const slotId = source.slot_id || deriveSourceSlotId(source.platform);
    const discovery = discoveries.find((entry) => entry.slot_id === slotId);
    const baseDir = discovery?.selected_path ?? resolveDefaultSourceBaseDir(source.platform, options);
    if (!options.includeMissing && !discovery?.selected_exists) {
      return [];
    }
    return [
      {
        ...source,
        id: deriveSourceInstanceId({
          host_id: hostId,
          slot_id: slotId,
          base_dir: baseDir,
        }),
        base_dir: baseDir,
      },
    ];
  });
}

export function getSourceFormatProfiles(): SourceFormatProfile[] {
  return Object.values(SOURCE_FORMAT_PROFILES).map(cloneSourceFormatProfile);
}

export function resolveSourceFormatProfile(source: SourceDefinition): SourceFormatProfile {
  const localProfile = SOURCE_FORMAT_PROFILES[source.platform as SupportedSourcePlatform];
  if (localProfile) {
    return cloneSourceFormatProfile(localProfile);
  }

  return {
    id: `${source.platform}:fallback:v1`,
    family: source.family,
    platform: source.platform,
    parser_version: `${source.platform}-parser@${RULE_VERSION}`,
    description: `Fallback parser profile for ${source.display_name}.`,
    capabilities: ["loss_audits"],
  };
}

export function cloneSourceFormatProfile(profile: SourceFormatProfile): SourceFormatProfile {
  return { ...profile, capabilities: [...profile.capabilities] };
}

function resolveDefaultSourceBaseDir(
  platform: SupportedSourcePlatform,
  options: DefaultSourceResolutionOptions,
): string {
  const adapter = getPlatformAdapter(platform);
  const candidates = adapter?.getDefaultBaseDirCandidates(buildDefaultResolutionContext(options)) ?? [];
  const pathExistsFn = options.pathExists ?? existsSync;
  return candidates.find((candidate) => pathExistsFn(candidate)) ?? candidates[0] ?? os.homedir();
}

function buildDefaultResolutionContext(options: DefaultSourceResolutionOptions): Required<Pick<
  DefaultSourceResolutionOptions,
  "homeDir" | "platform" | "appDataDir"
>> &
  DefaultSourceResolutionOptions {
  return {
    ...options,
    homeDir: options.homeDir ?? os.homedir(),
    platform: options.platform ?? os.platform(),
    appDataDir:
      options.appDataDir ??
      process.env.APPDATA ??
      path.join(options.homeDir ?? os.homedir(), "AppData", "Roaming"),
  };
}
