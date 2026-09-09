# Native host-architecture tooling only; guest packages come from the frozen VM.
FROM alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
RUN apk add --no-cache python3 e2fsprogs e2fsprogs-extra util-linux tar attr libarchive-tools zstd
WORKDIR /work
