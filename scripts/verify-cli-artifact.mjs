#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildCliArtifact } from './build-cli-artifact.mjs';

const execFileAsync = promisify(execFileCallback);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const keepTemp = process.argv.includes('--keep-temp');
const skipBuild = process.argv.includes('--skip-build');

async function main() {
  const cliPackage = JSON.parse(await readFile(path.join(repoRoot, 'apps', 'cli', 'package.json'), 'utf8'));
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'cchistory-cli-artifact-verify-'));
  const outputRoot = path.join(tempRoot, 'artifacts');
  const installRoot = path.join(tempRoot, 'installed');
  const firstVersion = `${cliPackage.version}-verify.1`;
  const secondVersion = `${cliPackage.version}-verify.2`;

  try {
    const firstManifest = await buildCliArtifact({
      repoRoot,
      outputRoot,
      versionOverride: firstVersion,
      createTarball: true,
      skipBuild,
    });
    if (!firstManifest.tarball_path) {
      throw new Error(`First artifact tarball was not created${firstManifest.tarball_warning ? `: ${firstManifest.tarball_warning}` : ''}`);
    }

    const firstInstallDir = path.join(tempRoot, 'release-1');
    await extractTarball(firstManifest.tarball_path, firstInstallDir);
    const firstExtractedDir = path.join(firstInstallDir, path.basename(firstManifest.artifact_dir));
    await replaceInstall(firstExtractedDir, installRoot);
    const firstTemplates = await runInstalledCli(path.join(installRoot, 'bin', 'cchistory'), ['templates']);
    const firstTemplateList = JSON.parse(firstTemplates.stdout);
    if (!Array.isArray(firstTemplateList) || firstTemplateList.length === 0) {
      throw new Error('Installed CLI did not return the expected template list during first-install verification.');
    }

    const secondManifest = await buildCliArtifact({
      repoRoot,
      outputRoot,
      versionOverride: secondVersion,
      skipBuild: true,
      createTarball: true,
    });
    if (!secondManifest.tarball_path) {
      throw new Error(`Second artifact tarball was not created${secondManifest.tarball_warning ? `: ${secondManifest.tarball_warning}` : ''}`);
    }

    const secondInstallDir = path.join(tempRoot, 'release-2');
    await extractTarball(secondManifest.tarball_path, secondInstallDir);
    const secondExtractedDir = path.join(secondInstallDir, path.basename(secondManifest.artifact_dir));
    await replaceInstall(secondExtractedDir, installRoot);

    const secondTemplates = await runInstalledCli(path.join(installRoot, 'bin', 'cchistory'), ['templates']);
    const secondTemplateList = JSON.parse(secondTemplates.stdout);
    if (!Array.isArray(secondTemplateList) || secondTemplateList.length !== firstTemplateList.length) {
      throw new Error('Upgraded CLI did not preserve the expected template surface.');
    }

    const installedManifest = JSON.parse(await readFile(path.join(installRoot, 'artifact-manifest.json'), 'utf8'));
    if (installedManifest.version !== secondVersion) {
      throw new Error(`Expected upgraded artifact version ${secondVersion}, got ${installedManifest.version}`);
    }

    const skepticalHome = path.join(tempRoot, 'skeptical-home');
    await seedArtifactWorkflowHome(skepticalHome);
    const skepticalEnv = { ...process.env, HOME: skepticalHome };
    const installedCli = path.join(installRoot, 'bin', 'cchistory');

    const discoveryHome = path.join(tempRoot, 'discovery-home');
    await seedArtifactDiscoveryHome(discoveryHome);
    const discoveryEnv = { ...process.env, HOME: discoveryHome };

    const discoverResult = await runInstalledCli(installedCli, ['discover'], discoveryEnv);
    assertQuietResult(discoverResult, 'discover');
    if (
      !/Discovered 6 item\(s\) on this host/.test(discoverResult.stdout)
      || !/Claude Code/.test(discoverResult.stdout)
      || !/OpenClaw/.test(discoverResult.stdout)
      || !/supplemental \(supplemental 1\)/.test(discoverResult.stdout)
      || !/OpenCode/.test(discoverResult.stdout)
      || !/Gemini CLI\s+tool\s+discover-only/.test(discoverResult.stdout)
    ) {
      throw new Error(`Installed CLI discover output was unexpected: ${discoverResult.stdout}`);
    }

    const discoverJsonResult = await runInstalledCli(installedCli, ['discover', '--json'], discoveryEnv);
    assertQuietResult(discoverJsonResult, 'discover --json');
    const discoverJson = JSON.parse(discoverJsonResult.stdout);
    const discoverEntries = Array.isArray(discoverJson.entries) ? discoverJson.entries : [];
    const openclawEntry = discoverEntries.find((entry) => entry.platform === 'openclaw' && entry.capability === 'sync');
    const opencodeEntry = discoverEntries.find((entry) => entry.platform === 'opencode' && entry.capability === 'sync');
    const geminiSyncEntry = discoverEntries.find((entry) => entry.platform === 'gemini' && entry.kind === 'source' && entry.capability === 'sync');
    const geminiToolEntry = discoverEntries.find((entry) => entry.platform === 'gemini' && entry.kind === 'tool' && entry.capability === 'discover_only');
    if (
      discoverJson.kind !== 'discover'
      || discoverEntries.length < 6
      || geminiSyncEntry?.display_name !== 'Gemini CLI'
      || !geminiSyncEntry?.selected_exists
      || !openclawEntry?.candidates?.some((candidate) => candidate.exists && /\.openclaw\/cron\/runs$/.test(candidate.path))
      || !opencodeEntry?.candidates?.some((candidate) => candidate.exists && /\.local\/share\/opencode\/storage\/session$/.test(candidate.path))
      || !geminiToolEntry?.candidates?.some((candidate) => candidate.exists && /\.gemini\/tmp$/.test(candidate.path))
      || !geminiToolEntry?.candidates?.some((candidate) => candidate.exists && /\.gemini\/history$/.test(candidate.path))
    ) {
      throw new Error(`Installed CLI discover JSON was unexpected: ${JSON.stringify(discoverJson)}`);
    }

    const sourceStoreDir = path.join(tempRoot, 'skeptical-source-store');
    const restoreStoreDir = path.join(tempRoot, 'skeptical-restore-store');
    const bundleADir = path.join(tempRoot, 'skeptical-bundle-a.cchistory-bundle');
    const bundleBDir = path.join(tempRoot, 'skeptical-bundle-b.cchistory-bundle');
    const initialPromptText = 'Artifact workflow prompt';
    const replacementPromptText = 'Artifact workflow prompt changed for conflict test';

    const syncResult = await runInstalledCli(installedCli, ['sync', '--store', sourceStoreDir, '--source', 'codex'], skepticalEnv);
    assertQuietResult(syncResult, 'skeptical sync');
    if (!/Synced 1 source\(s\)/.test(syncResult.stdout)) {
      throw new Error(`Installed CLI skeptical sync output was unexpected: ${syncResult.stdout}`);
    }

    const indexedSessionsBeforeFull = await runInstalledCliJson(installedCli, ['ls', 'sessions', '--store', sourceStoreDir, '--index'], skepticalEnv);
    if (indexedSessionsBeforeFull.kind !== 'sessions' || indexedSessionsBeforeFull.sessions.length !== 1) {
      throw new Error(`Installed CLI indexed sessions before full scan were unexpected: ${JSON.stringify(indexedSessionsBeforeFull)}`);
    }

    await writeCodexSessionFixture(skepticalHome, 'session-2.jsonl', {
      sessionId: 'codex-artifact-session-2',
      cwd: '/workspace/artifact-review',
      model: 'gpt-5',
      prompt: 'Count the newly scanned session.',
      reply: 'The extra session is present.',
      startAt: '2026-03-09T02:00:00.000Z',
    });

    const indexedSessionsAfterMutation = await runInstalledCliJson(installedCli, ['ls', 'sessions', '--store', sourceStoreDir, '--index'], skepticalEnv);
    if (indexedSessionsAfterMutation.kind !== 'sessions' || indexedSessionsAfterMutation.sessions.length !== 1) {
      throw new Error(`Installed CLI indexed sessions after live mutation were unexpected: ${JSON.stringify(indexedSessionsAfterMutation)}`);
    }

    const fullSessionsAfterMutation = await runInstalledCliJson(installedCli, ['ls', 'sessions', '--store', sourceStoreDir, '--full', '--source', 'codex'], skepticalEnv);
    if (
      fullSessionsAfterMutation.kind !== 'sessions'
      || fullSessionsAfterMutation.sessions.length !== 2
      || !fullSessionsAfterMutation.sessions.some((session) => session.title === 'Count the newly scanned session.')
    ) {
      throw new Error(`Installed CLI full sessions after live mutation were unexpected: ${JSON.stringify(fullSessionsAfterMutation)}`);
    }

    const indexedSessionsAfterFull = await runInstalledCliJson(installedCli, ['ls', 'sessions', '--store', sourceStoreDir, '--index'], skepticalEnv);
    if (indexedSessionsAfterFull.kind !== 'sessions' || indexedSessionsAfterFull.sessions.length !== 1) {
      throw new Error(`Installed CLI indexed sessions after full scan were unexpected: ${JSON.stringify(indexedSessionsAfterFull)}`);
    }

    const indexedSearchBeforeFull = await runInstalledCliJson(installedCli, ['search', 'Count the newly scanned session.', '--store', sourceStoreDir], skepticalEnv);
    if (indexedSearchBeforeFull.kind !== 'search' || indexedSearchBeforeFull.results.length !== 0) {
      throw new Error(`Installed CLI indexed search before full scan was unexpected: ${JSON.stringify(indexedSearchBeforeFull)}`);
    }

    const fullSearchAfterMutation = await runInstalledCliJson(installedCli, ['search', 'Count the newly scanned session.', '--store', sourceStoreDir, '--full', '--source', 'codex'], skepticalEnv);
    if (
      fullSearchAfterMutation.kind !== 'search'
      || fullSearchAfterMutation.results.length !== 1
      || fullSearchAfterMutation.results[0]?.session?.source_platform !== 'codex'
      || !/Count the newly scanned session\./.test(fullSearchAfterMutation.results[0]?.turn?.canonical_text ?? '')
    ) {
      throw new Error(`Installed CLI full search after live mutation was unexpected: ${JSON.stringify(fullSearchAfterMutation)}`);
    }

    const indexedSearchAfterFull = await runInstalledCliJson(installedCli, ['search', 'Count the newly scanned session.', '--store', sourceStoreDir], skepticalEnv);
    if (indexedSearchAfterFull.kind !== 'search' || indexedSearchAfterFull.results.length !== 0) {
      throw new Error(`Installed CLI indexed search after full scan was unexpected: ${JSON.stringify(indexedSearchAfterFull)}`);
    }

    const liveOnlyTurnId = fullSearchAfterMutation.results[0]?.turn?.id;
    if (typeof liveOnlyTurnId !== 'string') {
      throw new Error(`Installed CLI full search did not return a live-only turn id: ${JSON.stringify(fullSearchAfterMutation)}`);
    }

    const indexedShowMissing = await runInstalledCliExpectFailure(installedCli, ['show', 'turn', liveOnlyTurnId, '--store', sourceStoreDir], skepticalEnv);
    if (!/Unknown turn reference/.test(indexedShowMissing.stderr)) {
      throw new Error(`Installed CLI indexed show turn before full drilldown was unexpected: ${indexedShowMissing.stderr}`);
    }
    assertNoRuntimeNoise(indexedShowMissing.stderr, 'indexed show turn before full drilldown');

    const fullShowTurn = await runInstalledCli(installedCli, ['show', 'turn', liveOnlyTurnId, '--store', sourceStoreDir, '--full', '--source', 'codex'], skepticalEnv);
    assertQuietResult(fullShowTurn, 'full show turn');
    if (
      !/Source\s+: Codex \(codex\)/.test(fullShowTurn.stdout)
      || !/Count the newly scanned session\./.test(fullShowTurn.stdout)
      || !/assistant replies: 1/.test(fullShowTurn.stdout)
    ) {
      throw new Error(`Installed CLI full show turn output was unexpected: ${fullShowTurn.stdout}`);
    }

    const indexedShowAfterFull = await runInstalledCliExpectFailure(installedCli, ['show', 'turn', liveOnlyTurnId, '--store', sourceStoreDir], skepticalEnv);
    if (!/Unknown turn reference/.test(indexedShowAfterFull.stderr)) {
      throw new Error(`Installed CLI indexed show turn after full drilldown was unexpected: ${indexedShowAfterFull.stderr}`);
    }
    assertNoRuntimeNoise(indexedShowAfterFull.stderr, 'indexed show turn after full drilldown');

    const liveOnlySessionId = fullSearchAfterMutation.results[0]?.session?.id;
    if (typeof liveOnlySessionId !== 'string') {
      throw new Error(`Installed CLI full search did not return a live-only session id: ${JSON.stringify(fullSearchAfterMutation)}`);
    }

    const indexedShowSessionMissing = await runInstalledCliExpectFailure(installedCli, ['show', 'session', liveOnlySessionId, '--store', sourceStoreDir], skepticalEnv);
    if (!/Unknown session reference/.test(indexedShowSessionMissing.stderr)) {
      throw new Error(`Installed CLI indexed show session before full drilldown was unexpected: ${indexedShowSessionMissing.stderr}`);
    }
    assertNoRuntimeNoise(indexedShowSessionMissing.stderr, 'indexed show session before full drilldown');

    const fullShowSession = await runInstalledCli(installedCli, ['show', 'session', liveOnlySessionId, '--store', sourceStoreDir, '--full', '--source', 'codex'], skepticalEnv);
    assertQuietResult(fullShowSession, 'full show session');
    if (
      !/Title\s+: Count the newly scanned session\./.test(fullShowSession.stdout)
      || !/Project\s+: artifact-review \[ready\]/.test(fullShowSession.stdout)
      || !/Source\s+: Codex \(codex\)/.test(fullShowSession.stdout)
      || !/Turns\s+: 1/.test(fullShowSession.stdout)
      || !/Count the newly scanned session\./.test(fullShowSession.stdout)
    ) {
      throw new Error(`Installed CLI full show session output was unexpected: ${fullShowSession.stdout}`);
    }

    const indexedShowSessionAfterFull = await runInstalledCliExpectFailure(installedCli, ['show', 'session', liveOnlySessionId, '--store', sourceStoreDir], skepticalEnv);
    if (!/Unknown session reference/.test(indexedShowSessionAfterFull.stderr)) {
      throw new Error(`Installed CLI indexed show session after full drilldown was unexpected: ${indexedShowSessionAfterFull.stderr}`);
    }
    assertNoRuntimeNoise(indexedShowSessionAfterFull.stderr, 'indexed show session after full drilldown');

    const indexedTreeSessionMissing = await runInstalledCliExpectFailure(installedCli, ['tree', 'session', liveOnlySessionId, '--store', sourceStoreDir, '--long'], skepticalEnv);
    if (!/Unknown session reference/.test(indexedTreeSessionMissing.stderr)) {
      throw new Error(`Installed CLI indexed tree session before full drilldown was unexpected: ${indexedTreeSessionMissing.stderr}`);
    }
    assertNoRuntimeNoise(indexedTreeSessionMissing.stderr, 'indexed tree session before full drilldown');

    const fullTreeSession = await runInstalledCli(installedCli, ['tree', 'session', liveOnlySessionId, '--store', sourceStoreDir, '--full', '--source', 'codex', '--long'], skepticalEnv);
    assertQuietResult(fullTreeSession, 'full tree session');
    if (
      !/Session sess:codex:codex-artifact-session-2/.test(fullTreeSession.stdout)
      || !/source=Codex \(codex\)/.test(fullTreeSession.stdout)
      || !/Turns/.test(fullTreeSession.stdout)
      || !/Count the newly scanned session\./.test(fullTreeSession.stdout)
      || !/Related Work/.test(fullTreeSession.stdout)
    ) {
      throw new Error(`Installed CLI full tree session output was unexpected: ${fullTreeSession.stdout}`);
    }

    const indexedTreeSessionAfterFull = await runInstalledCliExpectFailure(installedCli, ['tree', 'session', liveOnlySessionId, '--store', sourceStoreDir, '--long'], skepticalEnv);
    if (!/Unknown session reference/.test(indexedTreeSessionAfterFull.stderr)) {
      throw new Error(`Installed CLI indexed tree session after full drilldown was unexpected: ${indexedTreeSessionAfterFull.stderr}`);
    }
    assertNoRuntimeNoise(indexedTreeSessionAfterFull.stderr, 'indexed tree session after full drilldown');

    const liveProjectId = fullSearchAfterMutation.results[0]?.project?.project_id;
    if (typeof liveProjectId !== 'string') {
      throw new Error(`Installed CLI full search did not return a live project id: ${JSON.stringify(fullSearchAfterMutation)}`);
    }

    const indexedShowProject = await runInstalledCli(installedCli, ['show', 'project', liveProjectId, '--store', sourceStoreDir], skepticalEnv);
    assertQuietResult(indexedShowProject, 'indexed show project');
    if (
      !/Status\s+: tentative/.test(indexedShowProject.stdout)
      || !/Sessions\s+: 1/.test(indexedShowProject.stdout)
      || !/Turns\s+: 1/.test(indexedShowProject.stdout)
      || /Count the newly scanned session\./.test(indexedShowProject.stdout)
    ) {
      throw new Error(`Installed CLI indexed show project output was unexpected: ${indexedShowProject.stdout}`);
    }

    const fullShowProject = await runInstalledCli(installedCli, ['show', 'project', liveProjectId, '--store', sourceStoreDir, '--full', '--source', 'codex'], skepticalEnv);
    assertQuietResult(fullShowProject, 'full show project');
    if (
      !/Status\s+: ready/.test(fullShowProject.stdout)
      || !/Sessions\s+: 2/.test(fullShowProject.stdout)
      || !/Turns\s+: 2/.test(fullShowProject.stdout)
      || !/Count the newly scanned session\./.test(fullShowProject.stdout)
    ) {
      throw new Error(`Installed CLI full show project output was unexpected: ${fullShowProject.stdout}`);
    }

    const indexedShowProjectAfterFull = await runInstalledCli(installedCli, ['show', 'project', liveProjectId, '--store', sourceStoreDir], skepticalEnv);
    assertQuietResult(indexedShowProjectAfterFull, 'indexed show project after full');
    if (
      !/Status\s+: tentative/.test(indexedShowProjectAfterFull.stdout)
      || !/Sessions\s+: 1/.test(indexedShowProjectAfterFull.stdout)
      || !/Turns\s+: 1/.test(indexedShowProjectAfterFull.stdout)
      || /Count the newly scanned session\./.test(indexedShowProjectAfterFull.stdout)
    ) {
      throw new Error(`Installed CLI indexed show project after full output was unexpected: ${indexedShowProjectAfterFull.stdout}`);
    }

    const indexedTreeProject = await runInstalledCli(installedCli, ['tree', 'project', liveProjectId, '--store', sourceStoreDir, '--long'], skepticalEnv);
    assertQuietResult(indexedTreeProject, 'indexed tree project');
    if (
      !/artifact-review \[tentative\]/.test(indexedTreeProject.stdout)
      || !/sessions=1 turns=1/.test(indexedTreeProject.stdout)
      || /Count the newly scanned session\./.test(indexedTreeProject.stdout)
    ) {
      throw new Error(`Installed CLI indexed tree project output was unexpected: ${indexedTreeProject.stdout}`);
    }

    const fullTreeProject = await runInstalledCli(installedCli, ['tree', 'project', liveProjectId, '--store', sourceStoreDir, '--full', '--source', 'codex', '--long'], skepticalEnv);
    assertQuietResult(fullTreeProject, 'full tree project');
    if (
      !/artifact-review \[ready\]/.test(fullTreeProject.stdout)
      || !/sessions=2 turns=2/.test(fullTreeProject.stdout)
      || !/sess:codex:codex-artifact-session-2/.test(fullTreeProject.stdout)
      || !/Count the newly scanned session\./.test(fullTreeProject.stdout)
    ) {
      throw new Error(`Installed CLI full tree project output was unexpected: ${fullTreeProject.stdout}`);
    }

    const indexedTreeProjectAfterFull = await runInstalledCli(installedCli, ['tree', 'project', liveProjectId, '--store', sourceStoreDir, '--long'], skepticalEnv);
    assertQuietResult(indexedTreeProjectAfterFull, 'indexed tree project after full');
    if (
      !/artifact-review \[tentative\]/.test(indexedTreeProjectAfterFull.stdout)
      || !/sessions=1 turns=1/.test(indexedTreeProjectAfterFull.stdout)
      || /Count the newly scanned session\./.test(indexedTreeProjectAfterFull.stdout)
    ) {
      throw new Error(`Installed CLI indexed tree project after full output was unexpected: ${indexedTreeProjectAfterFull.stdout}`);
    }

    const indexedStats = await runInstalledCli(installedCli, ['stats', '--store', sourceStoreDir], skepticalEnv);
    assertQuietResult(indexedStats, 'indexed stats');
    if (
      !/Sources\s+: 1/.test(indexedStats.stdout)
      || !/Projects\s+: 1/.test(indexedStats.stdout)
      || !/Sessions\s+: 1/.test(indexedStats.stdout)
      || !/Turns\s+: 1/.test(indexedStats.stdout)
      || /full scan in memory/.test(indexedStats.stdout)
    ) {
      throw new Error(`Installed CLI indexed stats output was unexpected: ${indexedStats.stdout}`);
    }

    const fullStats = await runInstalledCli(installedCli, ['stats', '--store', sourceStoreDir, '--full'], skepticalEnv);
    assertQuietResult(fullStats, 'full stats');
    if (
      !/full scan in memory/.test(fullStats.stdout)
      || !/Projects\s+: 1/.test(fullStats.stdout)
      || !/Sessions\s+: 2/.test(fullStats.stdout)
      || !/Turns\s+: 2/.test(fullStats.stdout)
      || !/Turns With Tokens\s+: 0\/2/.test(fullStats.stdout)
    ) {
      throw new Error(`Installed CLI full stats output was unexpected: ${fullStats.stdout}`);
    }

    const fullStatsJson = await runInstalledCliJson(installedCli, ['stats', '--store', sourceStoreDir, '--full'], skepticalEnv);
    if (
      fullStatsJson.kind !== 'stats-overview'
      || fullStatsJson.counts?.projects !== 1
      || fullStatsJson.counts?.sessions !== 2
      || fullStatsJson.counts?.turns !== 2
      || fullStatsJson.overview?.total_turns !== 2
      || !/full scan in memory/.test(fullStatsJson.db_path ?? '')
    ) {
      throw new Error(`Installed CLI full stats JSON was unexpected: ${JSON.stringify(fullStatsJson)}`);
    }

    const indexedStatsAfterFull = await runInstalledCli(installedCli, ['stats', '--store', sourceStoreDir], skepticalEnv);
    assertQuietResult(indexedStatsAfterFull, 'indexed stats after full');
    if (
      !/Sessions\s+: 1/.test(indexedStatsAfterFull.stdout)
      || !/Turns\s+: 1/.test(indexedStatsAfterFull.stdout)
      || /full scan in memory/.test(indexedStatsAfterFull.stdout)
    ) {
      throw new Error(`Installed CLI indexed stats after full output was unexpected: ${indexedStatsAfterFull.stdout}`);
    }

    const backupPreview = await runInstalledCli(installedCli, ['backup', '--store', sourceStoreDir, '--out', bundleADir], skepticalEnv);
    assertQuietResult(backupPreview, 'backup preview');
    if (!/Workflow\s*:\s*backup/.test(backupPreview.stdout) || !/Mode\s*:\s*preview/.test(backupPreview.stdout)) {
      throw new Error(`Installed CLI backup preview output was unexpected: ${backupPreview.stdout}`);
    }

    const backupWrite = await runInstalledCli(installedCli, ['backup', '--store', sourceStoreDir, '--out', bundleADir, '--write'], skepticalEnv);
    assertQuietResult(backupWrite, 'backup write');
    if (!/Mode\s*:\s*write/.test(backupWrite.stdout)) {
      throw new Error(`Installed CLI backup write output was unexpected: ${backupWrite.stdout}`);
    }

    const importResult = await runInstalledCli(installedCli, ['import', bundleADir, '--store', restoreStoreDir], skepticalEnv);
    assertQuietResult(importResult, 'initial import');
    if (!/Imported Sources\s*:\s*1/.test(importResult.stdout)) {
      throw new Error(`Installed CLI import output was unexpected: ${importResult.stdout}`);
    }

    const restoreCheck = await runInstalledCli(installedCli, ['restore-check', '--store', restoreStoreDir], skepticalEnv);
    assertQuietResult(restoreCheck, 'restore-check');
    if (!/Restore Check/.test(restoreCheck.stdout)) {
      throw new Error(`Installed CLI restore-check output was unexpected: ${restoreCheck.stdout}`);
    }

    const initialSearchResult = await runInstalledCliJson(installedCli, ['search', initialPromptText, '--store', restoreStoreDir], skepticalEnv);
    if (initialSearchResult.kind !== 'search' || initialSearchResult.results.length !== 1) {
      throw new Error(`Installed CLI skeptical search output was unexpected: ${JSON.stringify(initialSearchResult)}`);
    }
    const initialTurnId = initialSearchResult.results[0]?.turn?.id;
    if (typeof initialTurnId !== 'string') {
      throw new Error('Installed CLI skeptical search did not return an initial turn id.');
    }

    const initialShowTurn = await runInstalledCli(installedCli, ['show', 'turn', initialTurnId, '--store', restoreStoreDir], skepticalEnv);
    assertQuietResult(initialShowTurn, 'initial show turn');
    if (!new RegExp(initialPromptText).test(initialShowTurn.stdout)) {
      throw new Error(`Installed CLI initial show turn output was unexpected: ${initialShowTurn.stdout}`);
    }

    await overwriteArtifactWorkflowPrompt(skepticalHome, replacementPromptText);

    const resyncResult = await runInstalledCli(installedCli, ['sync', '--store', sourceStoreDir, '--source', 'codex'], skepticalEnv);
    assertQuietResult(resyncResult, 'resync after prompt mutation');
    if (!/Synced 1 source\(s\)/.test(resyncResult.stdout)) {
      throw new Error(`Installed CLI resync output was unexpected: ${resyncResult.stdout}`);
    }

    const exportConflictBundle = await runInstalledCli(installedCli, ['export', '--store', sourceStoreDir, '--out', bundleBDir], skepticalEnv);
    assertQuietResult(exportConflictBundle, 'conflict bundle export');
    if (!/Sources\s*:\s*1/.test(exportConflictBundle.stdout)) {
      throw new Error(`Installed CLI conflict export output was unexpected: ${exportConflictBundle.stdout}`);
    }

    const conflictImport = await runInstalledCliExpectFailure(installedCli, ['import', bundleBDir, '--store', restoreStoreDir], skepticalEnv);
    if (!/Source conflict detected/.test(conflictImport.stderr) || !/Next steps:/.test(conflictImport.stderr) || !/--dry-run/.test(conflictImport.stderr) || !/--on-conflict skip/.test(conflictImport.stderr) || !/--on-conflict replace/.test(conflictImport.stderr)) {
      throw new Error(`Installed CLI default conflict output was unexpected: ${conflictImport.stderr}`);
    }
    assertNoRuntimeNoise(conflictImport.stderr, 'default conflict import');

    const dryRunConflict = await runInstalledCli(installedCli, ['import', bundleBDir, '--store', restoreStoreDir, '--dry-run'], skepticalEnv);
    assertQuietResult(dryRunConflict, 'conflict dry-run');
    if (!/Would Conflict\s*:\s*1/.test(dryRunConflict.stdout) || !/Would Fail\s*:\s*true/.test(dryRunConflict.stdout)) {
      throw new Error(`Installed CLI conflict dry-run output was unexpected: ${dryRunConflict.stdout}`);
    }

    const replaceImport = await runInstalledCli(installedCli, ['import', bundleBDir, '--store', restoreStoreDir, '--on-conflict', 'replace'], skepticalEnv);
    assertQuietResult(replaceImport, 'replace import');
    if (!/Replaced Sources\s*:\s*1/.test(replaceImport.stdout)) {
      throw new Error(`Installed CLI replace import output was unexpected: ${replaceImport.stdout}`);
    }

    const replacementSearchResult = await runInstalledCliJson(installedCli, ['search', replacementPromptText, '--store', restoreStoreDir], skepticalEnv);
    if (replacementSearchResult.kind !== 'search' || replacementSearchResult.results.length !== 1) {
      throw new Error(`Installed CLI replacement search output was unexpected: ${JSON.stringify(replacementSearchResult)}`);
    }
    const replacementTurnId = replacementSearchResult.results[0]?.turn?.id;
    if (typeof replacementTurnId !== 'string') {
      throw new Error('Installed CLI replacement search did not return a turn id.');
    }

    const replacementShowTurn = await runInstalledCli(installedCli, ['show', 'turn', replacementTurnId, '--store', restoreStoreDir], skepticalEnv);
    assertQuietResult(replacementShowTurn, 'replacement show turn');
    if (!new RegExp(replacementPromptText).test(replacementShowTurn.stdout)) {
      throw new Error(`Installed CLI replacement show turn output was unexpected: ${replacementShowTurn.stdout}`);
    }


    const browseHome = path.join(tempRoot, 'browse-home');
    await seedArtifactBrowseHome(browseHome);
    const browseEnv = { ...process.env, HOME: browseHome };
    const browseStoreDir = path.join(tempRoot, 'browse-store');
    const fullHealthStoreDir = path.join(tempRoot, 'browse-full-health-store');
    const fullHealthDbPath = path.join(fullHealthStoreDir, 'cchistory.sqlite');

    const fullHealth = await runInstalledCli(installedCli, ['health', '--full', '--store', fullHealthStoreDir], browseEnv);
    assertQuietResult(fullHealth, 'full health');
    if (
      !/Read Mode\s+: full/.test(fullHealth.stdout)
      || !/Store Summary\s+: live full scan/.test(fullHealth.stdout)
      || !/Live Sources/.test(fullHealth.stdout)
      || !/Live Store Overview/.test(fullHealth.stdout)
      || /Indexed Sources/.test(fullHealth.stdout)
      || !/Claude Code/.test(fullHealth.stdout)
      || !/OpenClaw/.test(fullHealth.stdout)
      || !/Sources\s+: 2/.test(fullHealth.stdout)
    ) {
      throw new Error(`Installed CLI full health output was unexpected: ${fullHealth.stdout}`);
    }
    if (await pathExists(fullHealthDbPath)) {
      throw new Error(`Installed CLI full health should stay read-only but created ${fullHealthDbPath}`);
    }

    const fullHealthJsonResult = await runInstalledCli(installedCli, ['health', '--full', '--store', fullHealthStoreDir, '--json'], browseEnv);
    assertQuietResult(fullHealthJsonResult, 'full health --json');
    const fullHealthJson = JSON.parse(fullHealthJsonResult.stdout);
    const fullHealthSources = Array.isArray(fullHealthJson.store_summary?.sources?.sources)
      ? fullHealthJson.store_summary.sources.sources
      : [];
    const fullHealthPlatforms = fullHealthSources.map((source) => source.platform).sort().join(',');
    if (
      fullHealthJson.kind !== 'health'
      || fullHealthJson.read_mode !== 'full'
      || fullHealthJson.scope !== 'explicit-store+host'
      || fullHealthJson.store_summary?.read_mode !== 'full'
      || fullHealthJson.store_summary?.sources?.kind !== 'sources'
      || fullHealthJson.store_summary?.stats?.kind !== 'stats-overview'
      || fullHealthJson.store_summary?.stats?.counts?.sources !== 2
      || fullHealthSources.length !== 2
      || fullHealthPlatforms !== 'claude_code,openclaw'
    ) {
      throw new Error(`Installed CLI full health JSON was unexpected: ${JSON.stringify(fullHealthJson)}`);
    }

    const filteredFullHealth = await runInstalledCli(installedCli, ['health', '--full', '--store', fullHealthStoreDir, '--source', 'claude_code'], browseEnv);
    assertQuietResult(filteredFullHealth, 'filtered full health');
    if (
      !/Read Mode\s+: full/.test(filteredFullHealth.stdout)
      || !/Store Summary\s+: live full scan/.test(filteredFullHealth.stdout)
      || !/Selected Sources\s+: claude_code/.test(filteredFullHealth.stdout)
      || !/Live Sources/.test(filteredFullHealth.stdout)
      || !/Live Store Overview/.test(filteredFullHealth.stdout)
      || /Indexed Sources/.test(filteredFullHealth.stdout)
      || !/Claude Code/.test(filteredFullHealth.stdout)
      || /OpenClaw/.test(filteredFullHealth.stdout)
      || !/Sources\s+: 1/.test(filteredFullHealth.stdout)
    ) {
      throw new Error(`Installed CLI filtered full health output was unexpected: ${filteredFullHealth.stdout}`);
    }
    if (await pathExists(fullHealthDbPath)) {
      throw new Error(`Installed CLI filtered full health should stay read-only but created ${fullHealthDbPath}`);
    }

    const filteredFullHealthJsonResult = await runInstalledCli(installedCli, ['health', '--full', '--store', fullHealthStoreDir, '--source', 'claude_code', '--json'], browseEnv);
    assertQuietResult(filteredFullHealthJsonResult, 'filtered full health --json');
    const filteredFullHealthJson = JSON.parse(filteredFullHealthJsonResult.stdout);
    const filteredFullHealthSources = Array.isArray(filteredFullHealthJson.store_summary?.sources?.sources)
      ? filteredFullHealthJson.store_summary.sources.sources
      : [];
    if (
      filteredFullHealthJson.kind !== 'health'
      || filteredFullHealthJson.read_mode !== 'full'
      || filteredFullHealthJson.scope !== 'explicit-store+host'
      || filteredFullHealthJson.selected_sources?.join(',') !== 'claude_code'
      || filteredFullHealthJson.store_summary?.read_mode !== 'full'
      || filteredFullHealthJson.store_summary?.sources?.kind !== 'sources'
      || filteredFullHealthJson.store_summary?.stats?.kind !== 'stats-overview'
      || filteredFullHealthJson.store_summary?.stats?.counts?.sources !== 1
      || filteredFullHealthSources.length !== 1
      || filteredFullHealthSources[0]?.platform !== 'claude_code'
    ) {
      throw new Error(`Installed CLI filtered full health JSON was unexpected: ${JSON.stringify(filteredFullHealthJson)}`);
    }

    for (const source of ['claude_code', 'openclaw']) {
      const browseSync = await runInstalledCli(installedCli, ['sync', '--store', browseStoreDir, '--source', source], browseEnv);
      assertQuietResult(browseSync, `browse sync ${source}`);
      if (!/Synced 1 source\(s\)/.test(browseSync.stdout)) {
        throw new Error(`Installed CLI browse sync output was unexpected: ${browseSync.stdout}`);
      }
    }

    const projectsLong = await runInstalledCli(installedCli, ['ls', 'projects', '--store', browseStoreDir, '--long'], browseEnv);
    assertQuietResult(projectsLong, 'browse projects --long');
    if (!/Source Mix/.test(projectsLong.stdout) || !/Related Work/.test(projectsLong.stdout) || !/chat-ui-kit/.test(projectsLong.stdout)) {
      throw new Error(`Installed CLI browse projects output was unexpected: ${projectsLong.stdout}`);
    }

    const sessionsLong = await runInstalledCli(installedCli, ['ls', 'sessions', '--store', browseStoreDir, '--long'], browseEnv);
    assertQuietResult(sessionsLong, 'browse sessions --long');
    if (!/Source/.test(sessionsLong.stdout) || !/claude_code@host-/.test(sessionsLong.stdout) || !/Related Work/.test(sessionsLong.stdout) || !/\d+ delegated/.test(sessionsLong.stdout) || !/1 automation/.test(sessionsLong.stdout) || /Platform/.test(sessionsLong.stdout)) {
      throw new Error(`Installed CLI browse sessions output was unexpected: ${sessionsLong.stdout}`);
    }

    const searchText = await runInstalledCli(installedCli, ['search', 'expert code reviewer', '--store', browseStoreDir], browseEnv);
    assertQuietResult(searchText, 'browse search text');
    if (!/show turn/.test(searchText.stdout) || !/tree session .* --long/.test(searchText.stdout) || !/related=\d+ delegated/.test(searchText.stdout) || !/source=Claude Code \(claude_code\)/.test(searchText.stdout) || !/\/clear \/review|\/review You are an expert code reviewer/i.test(searchText.stdout) || /<command-name>|<command-message>|<local-command-caveat>/.test(searchText.stdout) || /\/clear clear|review \/review/.test(searchText.stdout)) {
      throw new Error(`Installed CLI browse search text output was unexpected: ${searchText.stdout}`);
    }

    const searchJson = await runInstalledCliJson(installedCli, ['search', 'expert code reviewer', '--store', browseStoreDir], browseEnv);
    const chosenHit = searchJson.results.find(
      (result) => result.session?.source_platform === 'claude_code' && /expert code reviewer/i.test(result.turn?.canonical_text ?? ''),
    );
    if (!chosenHit?.turn?.id || !chosenHit?.session?.id || !chosenHit?.turn?.project_id) {
      throw new Error(`Installed CLI browse search JSON output was unexpected: ${JSON.stringify(searchJson)}`);
    }

    const projectScopedSearch = await runInstalledCliJson(installedCli, ['search', 'expert code reviewer', '--store', browseStoreDir, '--project', chosenHit.turn.project_id], browseEnv);
    if (!Array.isArray(projectScopedSearch.results) || projectScopedSearch.results.length < 1 || projectScopedSearch.results.some((result) => result.turn?.project_id !== chosenHit.turn.project_id)) {
      throw new Error(`Installed CLI project-scoped search output was unexpected: ${JSON.stringify(projectScopedSearch)}`);
    }

    const sourceScopedSearch = await runInstalledCliJson(installedCli, ['search', 'expert code reviewer', '--store', browseStoreDir, '--source', 'claude_code'], browseEnv);
    if (!Array.isArray(sourceScopedSearch.results) || sourceScopedSearch.results.length < 1 || sourceScopedSearch.results.some((result) => result.session?.source_platform !== 'claude_code')) {
      throw new Error(`Installed CLI source-scoped search output was unexpected: ${JSON.stringify(sourceScopedSearch)}`);
    }

    const limitedSearch = await runInstalledCliJson(installedCli, ['search', 'expert code reviewer', '--store', browseStoreDir, '--source', 'claude_code', '--limit', '1'], browseEnv);
    if (!Array.isArray(limitedSearch.results) || limitedSearch.results.length !== 1 || limitedSearch.results[0]?.session?.source_platform !== 'claude_code') {
      throw new Error(`Installed CLI limited search output was unexpected: ${JSON.stringify(limitedSearch)}`);
    }

    const showTurn = await runInstalledCli(installedCli, ['show', 'turn', chosenHit.turn.id, '--store', browseStoreDir], browseEnv);
    assertQuietResult(showTurn, 'browse show turn');
    if (!/Project\s*:\s*chat-ui-kit/.test(showTurn.stdout) || !/Source\s*:\s*Claude Code \(claude_code\)/.test(showTurn.stdout)) {
      throw new Error(`Installed CLI browse show turn output was unexpected: ${showTurn.stdout}`);
    }

    const showSession = await runInstalledCli(installedCli, ['show', 'session', chosenHit.session.id, '--store', browseStoreDir], browseEnv);
    assertQuietResult(showSession, 'browse show session');
    if (!/Project\s*:\s*chat-ui-kit \[ready\]/.test(showSession.stdout) || !/Source\s*:\s*Claude Code \(claude_code\)/.test(showSession.stdout)) {
      throw new Error(`Installed CLI browse show session output was unexpected: ${showSession.stdout}`);
    }

    const treeProject = await runInstalledCli(installedCli, ['tree', 'project', chosenHit.turn.project_id, '--store', browseStoreDir, '--long'], browseEnv);
    assertQuietResult(treeProject, 'browse tree project --long');
    if (!/chat-ui-kit \[ready\]/.test(treeProject.stdout) || !/related=\d+ delegated/.test(treeProject.stdout) || !/Claude Code \(claude_code\)/.test(treeProject.stdout) || !/\/clear \/review|\/review You are an expert code reviewer/i.test(treeProject.stdout) || /<command-name>|<command-message>|<local-command-caveat>/.test(treeProject.stdout)) {
      throw new Error(`Installed CLI browse tree project output was unexpected: ${treeProject.stdout}`);
    }

    const treeSession = await runInstalledCli(installedCli, ['tree', 'session', chosenHit.session.id, '--store', browseStoreDir, '--long'], browseEnv);
    assertQuietResult(treeSession, 'browse tree session --long');
    if (!/Related Work/.test(treeSession.stdout) || !/transcript-primary/.test(treeSession.stdout) || !/Claude Code \(claude_code\)/.test(treeSession.stdout) || !/\/clear \/review|\/review You are an expert code reviewer/i.test(treeSession.stdout) || /<command-name>|<command-message>|<local-command-caveat>/.test(treeSession.stdout)) {
      throw new Error(`Installed CLI browse tree session output was unexpected: ${treeSession.stdout}`);
    }

    const missingSession = await runInstalledCliExpectFailure(installedCli, ['tree', 'session', 'missing-session', '--store', browseStoreDir], browseEnv);
    if (!/Unknown session reference: missing-session/.test(missingSession.stderr)) {
      throw new Error(`Installed CLI missing-session output was unexpected: ${missingSession.stderr}`);
    }
    assertNoRuntimeNoise(missingSession.stderr, 'browse missing-session');

    const missingTurn = await runInstalledCliExpectFailure(installedCli, ['show', 'turn', 'missing-turn', '--store', browseStoreDir], browseEnv);
    if (!/Unknown turn reference: missing-turn/.test(missingTurn.stderr)) {
      throw new Error(`Installed CLI missing-turn output was unexpected: ${missingTurn.stderr}`);
    }
    assertNoRuntimeNoise(missingTurn.stderr, 'browse missing-turn');

    const storeOnlyHealth = await runInstalledCli(installedCli, ['health', '--store', browseStoreDir, '--store-only'], browseEnv);
    assertQuietResult(storeOnlyHealth, 'store-only health');
    if (!/Scope\s+: selected store only/.test(storeOnlyHealth.stdout) || !/Indexed Sources/.test(storeOnlyHealth.stdout) || !/Store Overview/.test(storeOnlyHealth.stdout)) {
      throw new Error(`Installed CLI store-only health output was unexpected: ${storeOnlyHealth.stdout}`);
    }
    if (/Host Discovery/.test(storeOnlyHealth.stdout) || /Sync Preview/.test(storeOnlyHealth.stdout)) {
      throw new Error(`Installed CLI store-only health leaked host discovery output: ${storeOnlyHealth.stdout}`);
    }

    const storeOnlyHealthJsonResult = await runInstalledCli(installedCli, ['health', '--store', browseStoreDir, '--store-only', '--json'], browseEnv);
    assertQuietResult(storeOnlyHealthJsonResult, 'store-only health --json');
    const storeOnlyHealthJson = JSON.parse(storeOnlyHealthJsonResult.stdout);
    if (
      storeOnlyHealthJson.kind !== 'health'
      || storeOnlyHealthJson.scope !== 'store-only'
      || storeOnlyHealthJson.discovery !== null
      || storeOnlyHealthJson.sync_preview !== null
      || storeOnlyHealthJson.store_summary?.store_exists !== true
      || storeOnlyHealthJson.store_summary?.sources?.kind !== 'sources'
      || storeOnlyHealthJson.store_summary?.stats?.kind !== 'stats-overview'
    ) {
      throw new Error(`Installed CLI store-only health JSON was unexpected: ${JSON.stringify(storeOnlyHealthJson)}`);
    }

    const filteredHealth = await runInstalledCli(installedCli, ['health', '--store', browseStoreDir, '--source', 'claude_code'], browseEnv);
    assertQuietResult(filteredHealth, 'filtered health');
    if (
      !/Selected Sources\s+: claude_code/.test(filteredHealth.stdout)
      || !/Indexed Sources/.test(filteredHealth.stdout)
      || !/Store Overview/.test(filteredHealth.stdout)
      || !/Claude Code/.test(filteredHealth.stdout)
      || /OpenClaw/.test(filteredHealth.stdout)
      || !/Sources\s+: 1/.test(filteredHealth.stdout)
    ) {
      throw new Error(`Installed CLI filtered health output was unexpected: ${filteredHealth.stdout}`);
    }

    const filteredHealthJsonResult = await runInstalledCli(installedCli, ['health', '--store', browseStoreDir, '--source', 'claude_code', '--json'], browseEnv);
    assertQuietResult(filteredHealthJsonResult, 'filtered health --json');
    const filteredHealthJson = JSON.parse(filteredHealthJsonResult.stdout);
    const filteredHealthSources = Array.isArray(filteredHealthJson.store_summary?.sources?.sources)
      ? filteredHealthJson.store_summary.sources.sources
      : [];
    if (
      filteredHealthJson.kind !== 'health'
      || filteredHealthJson.read_mode !== 'index'
      || filteredHealthJson.scope !== 'explicit-store+host'
      || filteredHealthJson.selected_sources?.join(',') !== 'claude_code'
      || filteredHealthJson.store_summary?.store_exists !== true
      || filteredHealthJson.store_summary?.sources?.kind !== 'sources'
      || filteredHealthJson.store_summary?.stats?.kind !== 'stats-overview'
      || filteredHealthJson.store_summary?.stats?.counts?.sources !== 1
      || filteredHealthSources.length !== 1
      || filteredHealthSources[0]?.platform !== 'claude_code'
    ) {
      throw new Error(`Installed CLI filtered health JSON was unexpected: ${JSON.stringify(filteredHealthJson)}`);
    }

    const filteredStoreOnlyHealth = await runInstalledCli(installedCli, ['health', '--store', browseStoreDir, '--store-only', '--source', 'claude_code'], browseEnv);
    assertQuietResult(filteredStoreOnlyHealth, 'filtered store-only health');
    if (
      !/Scope\s+: selected store only/.test(filteredStoreOnlyHealth.stdout)
      || !/Selected Sources\s+: claude_code/.test(filteredStoreOnlyHealth.stdout)
      || !/Indexed Sources/.test(filteredStoreOnlyHealth.stdout)
      || !/Store Overview/.test(filteredStoreOnlyHealth.stdout)
      || !/Claude Code/.test(filteredStoreOnlyHealth.stdout)
      || /OpenClaw/.test(filteredStoreOnlyHealth.stdout)
      || !/Sources\s+: 1/.test(filteredStoreOnlyHealth.stdout)
    ) {
      throw new Error(`Installed CLI filtered store-only health output was unexpected: ${filteredStoreOnlyHealth.stdout}`);
    }

    const filteredStoreOnlyHealthJsonResult = await runInstalledCli(installedCli, ['health', '--store', browseStoreDir, '--store-only', '--source', 'claude_code', '--json'], browseEnv);
    assertQuietResult(filteredStoreOnlyHealthJsonResult, 'filtered store-only health --json');
    const filteredStoreOnlyHealthJson = JSON.parse(filteredStoreOnlyHealthJsonResult.stdout);
    const filteredStoreOnlyHealthSources = Array.isArray(filteredStoreOnlyHealthJson.store_summary?.sources?.sources)
      ? filteredStoreOnlyHealthJson.store_summary.sources.sources
      : [];
    if (
      filteredStoreOnlyHealthJson.kind !== 'health'
      || filteredStoreOnlyHealthJson.scope !== 'store-only'
      || filteredStoreOnlyHealthJson.discovery !== null
      || filteredStoreOnlyHealthJson.sync_preview !== null
      || filteredStoreOnlyHealthJson.selected_sources?.join(',') !== 'claude_code'
      || filteredStoreOnlyHealthJson.store_summary?.store_exists !== true
      || filteredStoreOnlyHealthJson.store_summary?.sources?.kind !== 'sources'
      || filteredStoreOnlyHealthJson.store_summary?.stats?.kind !== 'stats-overview'
      || filteredStoreOnlyHealthJson.store_summary?.stats?.counts?.sources !== 1
      || filteredStoreOnlyHealthSources.length !== 1
      || filteredStoreOnlyHealthSources[0]?.platform !== 'claude_code'
    ) {
      throw new Error(`Installed CLI filtered store-only health JSON was unexpected: ${JSON.stringify(filteredStoreOnlyHealthJson)}`);
    }

    const sourcesList = await runInstalledCli(installedCli, ['ls', 'sources', '--store', browseStoreDir], browseEnv);
    assertQuietResult(sourcesList, 'ls sources');
    if (!/Source\s+Handle\s+Platform/.test(sourcesList.stdout) || !/claude_code/.test(sourcesList.stdout) || !/openclaw/.test(sourcesList.stdout)) {
      throw new Error(`Installed CLI ls sources output was unexpected: ${sourcesList.stdout}`);
    }

    const sourcesListJsonResult = await runInstalledCli(installedCli, ['ls', 'sources', '--store', browseStoreDir, '--json'], browseEnv);
    assertQuietResult(sourcesListJsonResult, 'ls sources --json');
    const sourcesListJson = JSON.parse(sourcesListJsonResult.stdout);
    const sourcePlatforms = Array.isArray(sourcesListJson.sources)
      ? sourcesListJson.sources.map((source) => source.platform).sort()
      : [];
    if (
      sourcesListJson.kind !== 'sources'
      || !Array.isArray(sourcesListJson.sources)
      || sourcesListJson.sources.length !== 2
      || sourcePlatforms.join(',') !== 'claude_code,openclaw'
    ) {
      throw new Error(`Installed CLI ls sources JSON was unexpected: ${JSON.stringify(sourcesListJson)}`);
    }

    const missingStoreDir = path.join(tempRoot, 'browse-missing-store');
    const missingStoreHealth = await runInstalledCli(installedCli, ['health', '--store', missingStoreDir, '--store-only'], browseEnv);
    assertQuietResult(missingStoreHealth, 'missing store-only health');
    if (!/Indexed Store/.test(missingStoreHealth.stdout) || !/No indexed store found/.test(missingStoreHealth.stdout)) {
      throw new Error(`Installed CLI missing-store health output was unexpected: ${missingStoreHealth.stdout}`);
    }
    if (/Host Discovery/.test(missingStoreHealth.stdout) || /Sync Preview/.test(missingStoreHealth.stdout)) {
      throw new Error(`Installed CLI missing-store health leaked host discovery output: ${missingStoreHealth.stdout}`);
    }

    const missingStoreHealthJsonResult = await runInstalledCli(installedCli, ['health', '--store', missingStoreDir, '--store-only', '--json'], browseEnv);
    assertQuietResult(missingStoreHealthJsonResult, 'missing store-only health --json');
    const missingStoreHealthJson = JSON.parse(missingStoreHealthJsonResult.stdout);
    if (
      missingStoreHealthJson.kind !== 'health'
      || missingStoreHealthJson.scope !== 'store-only'
      || missingStoreHealthJson.store_summary?.store_exists !== false
      || !/No indexed store found/.test(missingStoreHealthJson.store_summary?.note ?? '')
    ) {
      throw new Error(`Installed CLI missing-store health JSON was unexpected: ${JSON.stringify(missingStoreHealthJson)}`);
    }

    const statsOverview = await runInstalledCli(installedCli, ['stats', '--store', browseStoreDir], browseEnv);
    assertQuietResult(statsOverview, 'stats overview');
    if (!/Schema Version/.test(statsOverview.stdout) || !/Search Mode/.test(statsOverview.stdout) || !/Sources\s*:\s*2/.test(statsOverview.stdout)) {
      throw new Error(`Installed CLI stats output was unexpected: ${statsOverview.stdout}`);
    }

    const querySessionResult = await runInstalledCli(installedCli, ['query', 'session', '--id', chosenHit.session.id, '--store', browseStoreDir, '--json'], browseEnv);
    assertQuietResult(querySessionResult, 'query session --id');
    const querySession = JSON.parse(querySessionResult.stdout);
    if (
      querySession.session?.id !== chosenHit.session.id
      || !Array.isArray(querySession.turns)
      || !querySession.turns.some((turn) => turn.id === chosenHit.turn.id)
    ) {
      throw new Error(`Installed CLI query session output was unexpected: ${JSON.stringify(querySession)}`);
    }

    const queryTurnResult = await runInstalledCli(installedCli, ['query', 'turn', '--id', chosenHit.turn.id, '--store', browseStoreDir, '--json'], browseEnv);
    assertQuietResult(queryTurnResult, 'query turn --id');
    const queryTurn = JSON.parse(queryTurnResult.stdout);
    if (
      queryTurn.turn?.id !== chosenHit.turn.id
      || queryTurn.turn?.session_id !== chosenHit.session.id
      || !/expert code reviewer/i.test(queryTurn.turn?.canonical_text ?? '')
      || (queryTurn.context?.assistant_replies?.length ?? 0) < 1
    ) {
      throw new Error(`Installed CLI query turn output was unexpected: ${JSON.stringify(queryTurn)}`);
    }

    console.log('[cchistory] standalone CLI artifact verification passed');
    console.log(`[cchistory] first install version: ${firstVersion}`);
    console.log(`[cchistory] upgraded version: ${secondVersion}`);
    console.log(`[cchistory] verified command surface: ${secondTemplateList.length} template profile(s)`);
    console.log('[cchistory] skeptical installed workflows: restore/conflict, multi-source browse/search, store-scoped admin, and structured query/session parity');
  } finally {
    if (keepTemp) {
      console.log(`[cchistory] keeping temp verification directory at ${tempRoot}`);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}


async function replaceInstall(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir)) {
    await cp(path.join(sourceDir, entry), path.join(targetDir, entry), { recursive: true });
  }
}

async function extractTarball(tarballPath, destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  await runCommand({
    cwd: path.dirname(tarballPath),
    cmd: 'tar',
    args: ['-xzf', tarballPath, '-C', destinationDir],
  });
}

async function runInstalledCli(commandPath, args, env = process.env) {
  return execFileAsync(commandPath, args, {
    cwd: path.dirname(path.dirname(commandPath)),
    env,
  });
}

async function runInstalledCliJson(commandPath, args, env = process.env) {
  const result = await runInstalledCli(commandPath, [...args, '--json'], env);
  return JSON.parse(result.stdout);
}


async function runInstalledCliExpectFailure(commandPath, args, env = process.env) {
  try {
    await runInstalledCli(commandPath, args, env);
  } catch (error) {
    if (typeof error?.code === 'number') {
      return {
        exitCode: Number(error.code),
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? ''),
      };
    }
    throw error;
  }
  throw new Error(`Expected installed CLI command to fail: ${args.join(' ')}`);
}

function assertNoRuntimeNoise(stderrText, label) {
  if (/ExperimentalWarning/.test(stderrText) || /FTS5 unavailable/.test(stderrText)) {
    throw new Error(`Installed CLI ${label} leaked runtime warning noise: ${stderrText}`);
  }
}

function assertQuietResult(result, label) {
  assertNoRuntimeNoise(result.stderr, label);
  if (result.stderr.trim() !== '') {
    throw new Error(`Installed CLI ${label} emitted stderr: ${result.stderr}`);
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand({ cwd, cmd, args }) {
  await mkdir(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`));
    });
    child.on('error', reject);
  });
}



async function seedArtifactDiscoveryHome(tempRoot) {
  const mockDataRoot = path.resolve(scriptDir, '../mock_data');
  await cp(path.join(mockDataRoot, '.claude'), path.join(tempRoot, '.claude'), { recursive: true });
  await cp(path.join(mockDataRoot, '.openclaw'), path.join(tempRoot, '.openclaw'), { recursive: true });
  await cp(path.join(mockDataRoot, '.gemini'), path.join(tempRoot, '.gemini'), { recursive: true });
  await mkdir(path.join(tempRoot, '.local', 'share'), { recursive: true });
  await cp(path.join(mockDataRoot, '.local', 'share', 'opencode'), path.join(tempRoot, '.local', 'share', 'opencode'), { recursive: true });
}

async function seedArtifactBrowseHome(tempRoot) {
  const mockDataRoot = path.resolve(scriptDir, '../mock_data');
  await cp(path.join(mockDataRoot, '.claude'), path.join(tempRoot, '.claude'), { recursive: true });
  await cp(path.join(mockDataRoot, '.openclaw'), path.join(tempRoot, '.openclaw'), { recursive: true });
}

async function overwriteArtifactWorkflowPrompt(tempRoot, prompt) {
  await writeCodexSessionFixture(tempRoot, 'session.jsonl', {
    sessionId: 'codex-artifact-session-1',
    cwd: '/workspace/artifact-review',
    model: 'gpt-5',
    prompt,
    reply: 'Artifact workflow reply updated.',
    startAt: '2026-03-09T00:00:00.000Z',
  });
}

async function seedArtifactWorkflowHome(tempRoot) {
  await mkdir(path.join(tempRoot, '.codex', 'sessions'), { recursive: true });
  await writeCodexSessionFixture(tempRoot, 'session.jsonl', {
    sessionId: 'codex-artifact-session-1',
    cwd: '/workspace/artifact-review',
    model: 'gpt-5',
    prompt: 'Artifact workflow prompt',
    reply: 'Artifact workflow reply.',
    startAt: '2026-03-09T00:00:00.000Z',
  });
}

async function writeCodexSessionFixture(tempRoot, fileName, input) {
  const startAt = new Date(input.startAt);
  const userAt = new Date(startAt.getTime() + 1000).toISOString();
  const assistantAt = new Date(startAt.getTime() + 2000).toISOString();
  await writeFile(
    path.join(tempRoot, '.codex', 'sessions', fileName),
    [
      {
        timestamp: input.startAt,
        type: 'session_meta',
        payload: { id: input.sessionId, cwd: input.cwd, model: input.model },
      },
      {
        timestamp: userAt,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: input.prompt }],
        },
      },
      {
        timestamp: assistantAt,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: input.reply }],
        },
      },
    ].map((entry) => JSON.stringify(entry)).join('\n'),
    'utf8',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
