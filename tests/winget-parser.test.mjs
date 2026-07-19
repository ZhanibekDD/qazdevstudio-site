import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWingetCandidate, parseMergedManifest, selectInstallers, sha256} from '../scripts/lib/winget-parser.mjs';

const manifest = `InstallerType: inno
Installers:
- Architecture: x64
  InstallerSha256: AF12577D0FDFF74243A5988197AA49B957D5044EDC17004F6DDF0768996F1DCA
  InstallerUrl: https://github.com/example/tool/releases/download/v2.0/Tool-x64.exe
  Scope: user
- Architecture: x64
  InstallerSha256: AF12577D0FDFF74243A5988197AA49B957D5044EDC17004F6DDF0768996F1DCA
  InstallerUrl: https://github.com/example/tool/releases/download/v2.0/Tool-x64.exe
  Scope: machine
- Architecture: arm64
  InstallerSha256: E3D7F5A2214F214F0A93CF0D8915DAB236A0E91C7DE6DE70A7DBDE9A61C794DB
  InstallerUrl: https://github.com/example/tool/releases/download/v2.0/Tool-arm64.exe
License: MIT
ManifestType: merged
ManifestVersion: 1.12.0
PackageIdentifier: Example.Tool
PackageLocale: en-US
PackageName: Example Tool
PackageUrl: https://example.test/
PackageVersion: 2.0.0
Publisher: Example
ReleaseDate: 2026-07-01
ShortDescription: A useful open source desktop utility
Tags:
- utility
- productivity
UpgradeBehavior: install
`;

test('parses a merged WinGet manifest and deduplicates installers', () => {
  const parsed = parseMergedManifest(manifest);
  assert.equal(parsed.packageIdentifier, 'Example.Tool');
  assert.equal(parsed.packageVersion, '2.0.0');
  assert.equal(parsed.installers.length, 3);
  const installers = selectInstallers(parsed.installers);
  assert.equal(installers.length, 1);
  assert.equal(installers[0].architecture, 'x64');
  assert.deepEqual(parsed.tags, ['utility', 'productivity']);
});

test('creates an unpublished candidate with installer SHA-256', () => {
  const candidate = buildWingetCandidate(parseMergedManifest(manifest), {path: 'manifests/e/Example/Tool/2.0/abcd', sha256: sha256(Buffer.from(manifest))});
  assert.equal(candidate.reviewStatus, 'ready-for-review');
  assert.equal(candidate.publishable, false);
  assert.equal(candidate.indexable, false);
  assert.equal(candidate.installers[0].sha256.length, 64);
});

test('rejects unsafe or unsupported installer links', () => {
  const parsed = parseMergedManifest(manifest);
  parsed.installers.forEach(installer => { installer.url = 'http://softonic.example/tool.exe'; });
  assert.equal(selectInstallers(parsed.installers).length, 0);
});
