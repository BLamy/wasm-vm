FROM rust:1.96-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --locked --release -p wasm-vm-cli --bin wvrelay

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home relay
COPY --from=build /src/target/release/wvrelay /usr/local/bin/wvrelay
COPY deploy/e3-t19/relay-entrypoint.sh /usr/local/bin/relay-entrypoint
USER relay
ENTRYPOINT ["/usr/local/bin/relay-entrypoint"]
