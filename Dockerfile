# ---- Frontend builder (temporary) ----
FROM --platform=$BUILDPLATFORM node:current-alpine3.24 AS frontend-builder

WORKDIR /app/frontend

# Copy frontend files and install dependencies
COPY webui/frontend/package.json webui/frontend/package-lock.json ./
RUN npm install --force

COPY webui/frontend/ ./
RUN npm run build

# ---- Final runtime image ----
FROM python:3.13-alpine

ARG TARGETARCH
ARG VENDOR
ARG VERSION

ENV APP_VERSION=$VERSION \
    TZ="Europe/Berlin" \
    POWERSHELL_DISTRIBUTION_CHANNEL="PSDocker" \
    FONTS_GID=5555 \
    POSTERIZARR_NON_ROOT="TRUE" \
    APP_ROOT="/app" \
    APP_DATA="/config" \
    FONTCONFIG_CACHE_DIR="/var/cache/fontconfig" \
    PSMODULE_ANALYSIS_CACHE_ENABLED="false" \
    XDG_DATA_HOME="/usr/local/share/powershell" \
    XDG_CACHE_HOME="/usr/local/share/powershell" \
    UMASK="0002"

# Install runtime dependencies + PowerShell + ImageMagick
RUN echo @edge http://dl-cdn.alpinelinux.org/alpine/edge/community >> /etc/apk/repositories \
    && echo @edge http://dl-cdn.alpinelinux.org/alpine/edge/main >> /etc/apk/repositories \
    && apk upgrade --update-cache --available \
    && apk add --no-cache \
        catatonit \
        curl \
        fontconfig \
        libjpeg-turbo \
        imagemagick@edge \
        imagemagick-libs@edge \
        imagemagick-heic \
        imagemagick-jpeg \
        imagemagick-webp@edge \
        libwebp \
        libwebp-tools \
        librsvg@edge \
        powershell \
        tzdata \
        bash \
        shadow \
        git \
    && pwsh -NoProfile -Command " \
        Register-PSRepository -Default; \
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction Stop; \
        Install-Module -Name Celerium.FanartTV -Scope AllUsers -Force -ErrorAction Stop; \
        if (!(Test-Path (Split-Path \$PROFILE.AllUsersAllHosts))) { New-Item -ItemType Directory -Force (Split-Path \$PROFILE.AllUsersAllHosts) }; \
        'Set-PSReadLineOption -HistorySaveStyle SaveNothing' | Out-File -FilePath \$PROFILE.AllUsersAllHosts -Encoding utf8" \
    && mkdir -p /app /usr/share/fonts/custom /var/cache/fontconfig \
    && chmod -R 755 /app /usr/local/share/powershell \
    && chmod -R 777 /usr/share/fonts/custom /var/cache/fontconfig

# Copy backend requirements file first to leverage Docker cache
COPY webui/backend/requirements.txt /app/requirements.txt

# Set up Python dependencies for FastAPI backend
RUN apk add --no-cache --virtual .build-deps build-base python3-dev linux-headers \
    && pip install --no-cache-dir -r /app/requirements.txt apprise \
    && apk del .build-deps

# Copy Posterizarr main app
COPY . /app

# Copy backend
COPY webui/backend/ /app/backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Create necessary directories
RUN mkdir -p /app/Logs /app/assets /app/temp

# ---- Combined startup script ----
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e
export PYTHONPATH=/app

# Use APP_PORT environment variable, or default to 8000
INTERNAL_PORT=${APP_PORT:-8000}
UI_LOG_LEVEL=${UVICORN_LOG_LEVEL:-critical}

# Check if the UI should be started (case-insensitive check)
case "$DISABLE_UI" in
    [Tt][Rr][Uu][Ee])
        # Matches "true", "TRUE", "True", "TrUe", etc.
        echo "DISABLE_UI=true detected. Skipping Web UI startup."
        ;;
    *)
        # Default case: Runs if DISABLE_UI is "false", empty, or not set
        echo "Starting FastAPI Web UI (API + Frontend) on port ${INTERNAL_PORT}..."
        python -m uvicorn backend.main:app --host 0.0.0.0 --port ${INTERNAL_PORT} --log-level ${UI_LOG_LEVEL} --no-access-log &
        UVICORN_PID=$!

        # Wait a moment to ensure it doesn't crash immediately (e.g., due to port conflict)
        sleep 5
        if ! kill -0 $UVICORN_PID 2>/dev/null; then
            echo "CRITICAL ERROR: FastAPI Web UI failed to start! This is likely due to a port conflict (e.g., Gluetun using port ${INTERNAL_PORT})." >&2
            echo "To see the exact error message, set the environment variable UVICORN_LOG_LEVEL=info and restart the container." >&2
            exit 1
        fi
        ;;
esac

# Start Posterizarr PowerShell automation
echo "Starting Posterizarr PowerShell automation..."
if [ "$#" -gt 0 ]; then
    # Forward startup args (for example: --run) to Start.ps1.
    exec /usr/bin/catatonit -- pwsh -NoProfile /app/Start.ps1 "$@"
fi

exec /usr/bin/catatonit -- pwsh -NoProfile /app/Start.ps1
EOF

RUN chmod +x /app/start.sh

# Set working directory and permissions
WORKDIR /config
# Runtime only: .NET named mutexes need a writable $HOME/.dotnet (set after build steps so root doesn't pre-create it)
ENV HOME="/tmp"
USER nobody:nogroup
VOLUME ["/config"]

ARG VERSION

# Labels
LABEL org.opencontainers.image.source="https://github.com/fscorrupt/posterizarr"
LABEL org.opencontainers.image.description="Posterizarr - Automated poster generation with integrated Web UI"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.version=$VERSION

# Expose backend + frontend ports
EXPOSE 8000

ENTRYPOINT ["/app/start.sh"]