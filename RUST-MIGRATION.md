# QazDev Studio — Rust migration

The new application is a single Rust binary. It renders the high-value pages on
the server, exposes the software search API, keeps all indexed URLs, generates
sitemaps at runtime, and serves the existing utilities during migration.

## Architecture

- Axum HTTP server
- Askama compile-time templates
- Embedded catalog data (`data/software.json`)
- Server-rendered home, service, blog, catalog and software pages
- Compatibility redirects for three broken historical service URLs
- Existing static tools are served from an allowlisted legacy directory
- Docker image for Plesk or any Linux host

The browser still receives HTML, CSS and a small JavaScript file. That is normal:
browsers do not render Rust source directly. The server, routing, SEO generation,
catalog rendering and search API are Rust.

## Local run

```bash
cargo run
```

Open `http://127.0.0.1:8080/`. Health check:

```bash
curl http://127.0.0.1:8080/health
```

## Checks

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --all-targets --all-features --locked
cargo build --release --locked
```

## Production

On every push to `main`, GitHub Actions verifies the project and publishes:

```text
ghcr.io/zhanibekdd/qazdevstudio-site:rust
```

Recommended Plesk deployment:

1. Install/open the Docker extension.
2. Run the image with container port `8080` mapped to host `127.0.0.1:18080`.
3. Set `LEGACY_ROOT=/app/legacy` and `RUST_LOG=qazdevstudio=info,tower_http=info`.
4. Add the reverse-proxy rule from `deploy/nginx-qazdevstudio.conf`.
5. Check `/health`, `/robots.txt`, `/sitemap-index.xml`, `/ads.txt`, the homepage,
   the Astana page, the blog and several software pages.
6. Only then switch live traffic from the old document root to the Rust process.

Do not delete the existing static deployment until the Rust container has been
healthy for at least 24 hours. Rollback is simply removing the proxy rule.

