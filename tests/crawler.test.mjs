import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCandidate, detectArchitecture, detectPlatform, selectDownloadableAssets} from '../scripts/lib/catalog-crawler.mjs';

test('detects operating systems and architectures', () => {
  assert.equal(detectPlatform('Tool-4.2-Windows-x64-Installer.exe'), 'windows');
  assert.equal(detectPlatform('Tool-4.2-macOS-Apple.dmg'), 'macos');
  assert.equal(detectPlatform('tool_4.2_amd64.deb'), 'linux');
  assert.equal(detectPlatform('tool-source.zip'), null);
  assert.equal(detectArchitecture('tool-aarch64.AppImage'), 'arm64');
  assert.equal(detectArchitecture('tool-win64.exe'), 'x64');
});

test('rejects signatures, checksums, symbols and source archives', () => {
  const assets = selectDownloadableAssets([
    {name: 'Tool-x64.exe', browser_download_url: 'https://example.test/tool.exe', size: 10},
    {name: 'Tool-x64.exe.sha256', browser_download_url: 'https://example.test/hash', size: 1},
    {name: 'Tool-debug-symbols.zip', browser_download_url: 'https://example.test/debug', size: 1},
    {name: 'Source-code.zip', browser_download_url: 'https://example.test/source', size: 1}
  ]);
  assert.deepEqual(assets.map(asset => asset.name), ['Tool-x64.exe']);
});

test('creates an unpublished review candidate', () => {
  const repo = {
    name: 'GreatTool', full_name: 'example/GreatTool', html_url: 'https://github.com/example/GreatTool',
    description: 'Useful desktop tool', homepage: 'https://example.test', archived: false, fork: false,
    disabled: false, stargazers_count: 12000, license: {spdx_id: 'MIT'}, topics: ['desktop']
  };
  const release = {
    tag_name: 'v2.0.0', html_url: 'https://github.com/example/GreatTool/releases/tag/v2.0.0',
    published_at: '2026-07-01T00:00:00Z', draft: false, prerelease: false,
    assets: [{name: 'GreatTool-x64.exe', browser_download_url: 'https://github.com/example/GreatTool/releases/download/v2/GreatTool-x64.exe', size: 500, download_count: 2000}]
  };
  const candidate = buildCandidate(repo, release, {id: 'system', label: 'Система'}, new Date('2026-07-20T00:00:00Z'));
  assert.equal(candidate.github, 'example/GreatTool');
  assert.equal(candidate.reviewStatus, 'ready-for-review');
  assert.equal(candidate.publishable, false);
  assert.equal(candidate.indexable, false);
  assert.ok(candidate.score >= 65);
});
