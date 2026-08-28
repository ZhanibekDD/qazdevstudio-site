FROM rust:1.98-bookworm AS builder
WORKDIR /work

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY templates ./templates
COPY rust-static ./rust-static
COPY data/software.json ./data/software.json

RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime
WORKDIR /app

COPY --from=builder /work/target/release/qazdevstudio /usr/local/bin/qazdevstudio
COPY --chown=65532:65532 . /app/legacy
RUN mkdir -p /app/data && chown 65532:65532 /app/data

ENV PORT=8080
ENV LEGACY_ROOT=/app/legacy
ENV QAZDEV_DB_PATH=/app/data/analytics.sqlite
ENV RUST_LOG=qazdevstudio=info,tower_http=info

VOLUME ["/app/data"]
USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/qazdevstudio"]
