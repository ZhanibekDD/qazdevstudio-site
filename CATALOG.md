# QazTools direct-download catalog

Static catalog for `qazdevstudio.kz/programmy/`. Every download button requests the latest release from the official GitHub repository, selects the reviewed asset pattern, and starts the original file download without opening a third-party landing page.

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

The crawler searches 25 desktop-software queries across eight categories, checks each repository's latest GitHub Release, rejects source archives, signatures, checksums and debug files, then ranks real binary downloads by licence, popularity, release freshness, platforms and release downloads. It writes checkpoints after every search page, so the next run continues instead of starting over.

Generated files:

- `data/github-crawl.drafts.json` — every recognized candidate;
- `data/github-crawl.state.json` — resumable checkpoint;
- `data/crawl-summary.json` — source and category totals;
- `data/review-queue.csv` and `.json` — highest-scoring moderation queue.

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
