# QazTools software catalog

Static, SEO-first catalog for `qazdevstudio.kz/programmy/`.

## Build

```bash
node scripts/build-software-catalog.mjs
```

The build validates `data/software.json`, generates the catalog index, one HTML page per product, and `sitemap-programmy.xml`.

## Import drafts

Apple App Store Kazakhstan:

```bash
node scripts/import-software.mjs --source=apple --query=crm --limit=20
```

Product Hunt:

```bash
PRODUCT_HUNT_TOKEN=... node scripts/import-software.mjs --source=producthunt --limit=20
```

Imports are written to `data/software.drafts.json`. They never enter the public catalog automatically. Review the official website, description, category, Kazakhstan relevance, and pricing before moving a record to `software.json`.

## Publishing checklist

- Run the build and verify that every card has a detail page.
- Check external URLs and factual claims against official sources.
- Add `Sitemap: https://qazdevstudio.kz/sitemap-programmy.xml` to `robots.txt`.
- Link `/programmy/` from the home page and footer.
- Submit the new sitemap in Google Search Console and Yandex Webmaster.
