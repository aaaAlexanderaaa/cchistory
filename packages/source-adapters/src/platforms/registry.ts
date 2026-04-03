import type { SourcePlatform } from "@cchistory/domain";
import { ampAdapter } from "./amp.js";
import { antigravityAdapter } from "./antigravity.js";
import { codebuddyAdapter } from "./codebuddy.js";
import { geminiAdapter } from "./gemini.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import { factoryDroidAdapter } from "./factory-droid.js";
import { lobechatAdapter } from "./lobechat.js";
import { openclawAdapter } from "./openclaw.js";
import { opencodeAdapter } from "./opencode.js";
import type { AdapterSupportTier, PlatformAdapter, SupportedSourcePlatform } from "./types.js";
import { isSupportedSourcePlatform } from "./types.js";

const adapters = [
  codexAdapter,
  claudeCodeAdapter,
  factoryDroidAdapter,
  ampAdapter,
  cursorAdapter,
  antigravityAdapter,
  geminiAdapter,
  openclawAdapter,
  opencodeAdapter,
  lobechatAdapter,
  codebuddyAdapter,
] as const satisfies readonly PlatformAdapter[];

const adapterRegistry = Object.fromEntries(
  adapters.map((adapter) => [adapter.platform, adapter]),
) as Record<SupportedSourcePlatform, PlatformAdapter>;

export function getPlatformAdapter(platform: SourcePlatform): PlatformAdapter | undefined {
  if (!isSupportedSourcePlatform(platform)) {
    return undefined;
  }
  return adapterRegistry[platform];
}

export function listPlatformAdapters(): readonly PlatformAdapter[] {
  return adapters;
}

export function listPlatformAdaptersBySupportTier(tier: AdapterSupportTier): readonly PlatformAdapter[] {
  return adapters.filter((adapter) => adapter.supportTier === tier);
}

export function listStablePlatformAdapters(): readonly PlatformAdapter[] {
  return listPlatformAdaptersBySupportTier("stable");
}
