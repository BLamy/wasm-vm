FROM rust:1.96-bookworm AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/rustup \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --locked --release -p wasm-vm-cli --bin wvrelay && \
    cp /src/target/release/wvrelay /tmp/wvrelay

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home relay
COPY --from=build /tmp/wvrelay /usr/local/bin/wvrelay
COPY deploy/e3-t19/relay-entrypoint.sh /usr/local/bin/relay-entrypoint
USER relay
ENTRYPOINT ["/usr/local/bin/relay-entrypoint"]
