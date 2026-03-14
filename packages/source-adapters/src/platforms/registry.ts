import type { SourcePlatform } from "@cchistory/domain";
import { ampAdapter } from "./amp.js";
import { antigravityAdapter } from "./antigravity.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import { factoryDroidAdapter } from "./factory-droid.js";
import { lobechatAdapter } from "./lobechat.js";
import { openclawAdapter } from "./openclaw.js";
import { opencodeAdapter } from "./opencode.js";
import type { PlatformAdapter, SupportedSourcePlatform } from "./types.js";
import { isSupportedSourcePlatform } from "./types.js";

const adapters = [
  codexAdapter,
  claudeCodeAdapter,
  factoryDroidAdapter,
  ampAdapter,
  cursorAdapter,
  antigravityAdapter,
  openclawAdapter,
  opencodeAdapter,
  lobechatAdapter,
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
