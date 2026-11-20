# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:22-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Apple framework images for kbsync, extracted from a public software
# update package and verified against pinned digests. Layer caching skips the
# ~380 MB range download on rebuilds.
FROM node:22-alpine AS sap-assets
WORKDIR /app/backend
COPY --from=backend-build /app/backend ./
RUN DATA_DIR=/tmp/sap-extract-work node --import tsx scripts/extract-sap-assets.mts /out

# Stage 4: Verified ipatool v2.8.1 native App Store implementation.
# Kept isolated from the browser-side SAP and WebAssembly code.
FROM debian:bookworm-slim AS native-ipatool
ARG IPATOOL_VERSION=2.8.1
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) digest='c5a7d35d98a0ac41fbb9d21c19437c3e6006c6e32556f484d09ed26872f9c283' ;; \
    arm64) digest='64dc6311acbd92f8165fe382ee86852f520b23355dae65933cb0f60177357116' ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  archive="ipatool-${IPATOOL_VERSION}-linux-${TARGETARCH}.tar.gz"; \
  curl --fail --location --retry 3 --output "/tmp/${archive}" \
    "https://github.com/majd/ipatool/releases/download/v${IPATOOL_VERSION}/${archive}"; \
  printf '%s  %s\n' "${digest}" "/tmp/${archive}" | sha256sum --check --status; \
  mkdir -p /tmp/ipatool-extract; \
  tar -xzf "/tmp/${archive}" -C /tmp/ipatool-extract; \
  binary="$(find /tmp/ipatool-extract -type f -name 'ipatool*' -print -quit)"; \
  test -n "${binary}"; \
  install -m 0755 "${binary}" /usr/local/bin/ipatool; \
  /usr/local/bin/ipatool --version

# Stage 5: Runtime (glibc required by Linux ipatool release)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  zip util-linux ca-certificates libsecret-1-0 libstdc++6 libgcc-s1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=native-ipatool /usr/local/bin/ipatool /usr/local/bin/ipatool
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=frontend-build /app/frontend/dist ./public
COPY --from=sap-assets /out /opt/asspp/sap-assets
RUN mkdir -p /data/packages
EXPOSE 8080
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ENV DATA_DIR=/data PORT=8080 BUILD_COMMIT=$BUILD_COMMIT BUILD_DATE=$BUILD_DATE
CMD ["node", "dist/index.js"]
