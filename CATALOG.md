# QazTools direct-download catalog

Static catalog for `qazdevstudio.kz/programmy/`. Every download button starts an original upstream file without opening a third-party landing page. GitHub programs resolve the latest reviewed Release asset; WinGet and Flathub records use exact verified direct URLs.

## Build

```bash
node scripts/build-software-catalog.mjs
```

The build validates repositories and regular expressions in `data/software.json`, removes old generated catalog HTML files, then creates the index, one detail page per program, and `sitemap-programmy.xml`.

## Add a GitHub program draft

```bash
node scripts/import-software.mjs --repo=owner/repository
```

The importer checks the latest public GitHub Release and writes downloadable asset metadata to `data/software.drafts.json`. Drafts are never published automatically.

## Mass collection

```bash
GITHUB_TOKEN=... node scripts/crawl-github-releases.mjs --all --resume --pages=3 --max-repos=3000
node scripts/review-candidates.mjs --threshold=65
```

The crawler searches 25 desktop-software queries across eight categories, checks each repository's latest GitHub Release, rejects source archives, signatures, checksums and debug files, then ranks real binary downloads by licence, popularity, release freshness, platforms and release downloads. It waits through short GitHub API rate windows and writes checkpoints after every search page, so a later run continues instead of starting over.

Generated files:

- `data/github-crawl.drafts.json` — every recognized candidate;
- `data/github-crawl.state.json` — resumable checkpoint;
- `data/crawl-summary.json` — source and category totals;
- `data/review-queue.csv` and `.json` — highest-scoring moderation queue.

## Publish a reviewed batch

Keep the human-reviewed repository list and original Russian copy in `data/publication-selection.json`, then build a deterministic batch from a crawl artifact:

```bash
node scripts/promote-candidates.mjs --input=/path/to/github-crawl.drafts.json
node scripts/promote-candidates.mjs --input=/path/to/github-crawl.drafts.json --apply
node scripts/build-software-catalog.mjs
node scripts/verify-downloads.mjs --input=data/software.batch.json
```

Promotion refuses duplicates, scores below 80, missing machine-readable licences and ambiguous asset patterns. It chooses one reviewed x64 desktop asset per available operating system. `--apply` is intentionally required before the public catalog changes.

## WinGet source

```bash
node scripts/crawl-winget.mjs --resume --max-packages=3000
node scripts/review-winget-candidates.mjs --threshold=80
```

The WinGet crawler downloads Microsoft's signed default source package from `https://cdn.winget.microsoft.com/cache/source.msix`. Its SQLite index currently describes more than 13,000 packages. Each referenced merged manifest is fetched from the same Microsoft CDN and accepted only when its SHA-256 matches the index. Installer URLs also require HTTPS, a supported Windows installer extension and the 64-character `InstallerSha256` included in the manifest.

The resumable workflow processes 3,000 changed package manifests per run. Raw WinGet records remain unpublished and are exported as a separate JSON/CSV moderation artifact. Promotion still requires publisher, licence and installer-domain review; QazDev never mirrors the installer.

Reviewed WinGet packages are promoted through an explicit allowlist with original Russian copy:

```bash
node scripts/promote-winget-candidates.mjs \
  --input=data/winget-crawl.drafts.json \
  --selection=data/winget-publication-selection.json \
  --apply
node scripts/build-software-catalog.mjs
node scripts/verify-downloads.mjs
```

Direct records keep the exact upstream HTTPS installer URL, version and SHA-256 from the verified WinGet manifest. The catalog button starts the original download immediately; QazDev does not host or repackage the file. Re-running promotion updates the existing allowlisted records instead of creating duplicates.

The weekly `refresh-published-winget.yml` workflow repeats that verification for the reviewed allowlist, rebuilds the pages and opens a pull request only when a version, installer URL or checksum changed. It never publishes a newly discovered package by itself.

## Flathub source

```bash
node scripts/crawl-flathub.mjs
node scripts/review-flathub-candidates.mjs --threshold=80
```

The Flathub crawler reads the official compressed x86_64 AppStream index and creates direct `dl.flathub.org` `.flatpakref` links. This gives Linux users a one-click hand-off to their Flatpak installer without visiting an app landing page. Only applications with a recognized open-source licence and Flathub's verified-developer flag enter the fast moderation queue. Official Flathub icon URLs are retained for later catalog cards.

All collected Flathub records remain `indexable: false` and `publishable: false`. The workflow runs weekly and uploads JSON/CSV artifacts for human review; it does not mass-publish the feed.

GitHub Actions runs a 700-repository collection when the crawler branch changes. After the workflow is on the default branch, it can collect up to 10,000 repositories manually and resume every Monday. The result is an artifact; it never changes the public catalog by itself.

Verify all public direct-download patterns before a release:

```bash
GITHUB_TOKEN=... node scripts/verify-downloads.mjs
```

Before moving a draft to `software.json`:

- confirm that the repository belongs to the real project;
- check the open-source licence and the official website;
- select exact release asset patterns for Windows, macOS, or Linux;
- exclude signatures, checksums, source archives, debug symbols, and ARM builds unless clearly labelled;
- test every download button against the latest release;
- write an original Russian description.
- leave `indexable` and `publishable` false until all checks are complete.

## Safety model

- QazDev does not mirror, repackage, or modify binaries.
- Files come from `browser_download_url` in the official GitHub Releases API.
- Only reviewed repositories and asset patterns are published.
- The UI explains the source before download and keeps a link to the source code on detail pages.
- A large candidate count is not a publication target: duplicate, abandoned, server-only, suspicious or weakly licensed projects remain unpublished.
