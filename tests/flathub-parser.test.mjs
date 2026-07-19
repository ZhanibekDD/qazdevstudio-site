import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFlathubCandidate, parseFlathubComponent, splitDesktopComponents} from '../scripts/lib/flathub-parser.mjs';

const xml = `<components><component type="desktop-application">
<id>org.example.Tool</id><name>Example Tool</name><summary>Useful desktop utility</summary>
<project_license>GPL-3.0-or-later</project_license><description><p>A useful tool for files.</p></description>
<developer_name>Example Developers</developer_name><url type="homepage">https://example.org/</url>
<url type="vcs-browser">https://github.com/example/tool</url><categories><category>Utility</category></categories>
<keywords><keyword>files</keyword></keywords><releases><release timestamp="1782000000" version="2.1.0"/></releases>
<icon height="128" type="remote" width="128">https://dl.flathub.org/media/example.png</icon>
<custom><value key="flathub::verification::verified">true</value><value key="flathub::verification::method">website</value></custom>
<bundle type="flatpak">app/org.example.Tool/x86_64/stable</bundle></component></components>`;

test('splits and parses a verified desktop component', () => {
  const components = splitDesktopComponents(xml);
  assert.equal(components.length, 1);
  const parsed = parseFlathubComponent(components[0]);
  assert.equal(parsed.appId, 'org.example.Tool');
  assert.equal(parsed.version, '2.1.0');
  assert.equal(parsed.verified, true);
  assert.deepEqual(parsed.categories, ['Utility']);
});

test('creates an unpublished one-click flatpakref candidate', () => {
  const candidate = buildFlathubCandidate(parseFlathubComponent(splitDesktopComponents(xml)[0]), {sha256: 'a'.repeat(64)});
  assert.equal(candidate.reviewStatus, 'ready-for-review');
  assert.equal(candidate.download.url, 'https://dl.flathub.org/repo/appstream/org.example.Tool.flatpakref');
  assert.equal(candidate.indexable, false);
  assert.equal(candidate.publishable, false);
});

test('keeps unverified apps out of the fast review queue', () => {
  const unverified = xml.replace('<value key="flathub::verification::verified">true</value>', '');
  const candidate = buildFlathubCandidate(parseFlathubComponent(splitDesktopComponents(unverified)[0]), {sha256: 'b'.repeat(64)});
  assert.equal(candidate.reviewStatus, 'needs-review');
});

test('does not import icons outside the official Flathub media host', () => {
  const externalIcon = xml.replace('https://dl.flathub.org/media/example.png', 'https://example.org/icon.png');
  const parsed = parseFlathubComponent(splitDesktopComponents(externalIcon)[0]);
  assert.equal(parsed.icon, '');
});
