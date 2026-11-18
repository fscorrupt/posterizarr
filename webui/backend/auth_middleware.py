"""
Basic Authentication Middleware for Posterizarr Web UI
"""

from fastapi import Request, HTTPException, status
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
import base64
import secrets
import logging
import bcrypt
from pathlib import Path
import json

# Use the root logger so output appears in console/BackendServer.log
logger = logging.getLogger(__name__)

class BasicAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, config_path: Path, db_path: Path):
        super().__init__(app)
        self.config_path = config_path
        self.db_path = db_path
        self.auth_db = None

        # Try to load ConfigDB
        try:
            from config_database import ConfigDB
            self.auth_db = ConfigDB(db_path, config_path)
            logger.info("AUTH: Database connection established")
        except Exception as e:
            logger.error(f"AUTH: Database error: {e}")

        # Initial config load
        self._load_config()
        logger.info(f"AUTH: Middleware Initialized (Enabled: {self.enabled}, User: {self.username})")

    def _verify_password(self, plain_password: str, hashed_password: str) -> bool:
        if not hashed_password:
            return False
        # Direct check for plain text password (in case config holds plain text)
        if secrets.compare_digest(plain_password, hashed_password):
            return True
        try:
            return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
        except (ValueError, Exception):
            return False

    def _is_browser_origin(self, request: Request) -> bool:
        referer = request.headers.get("referer", "")
        origin = request.headers.get("origin", "")
        host = request.headers.get("host", "")
        fwd_host = request.headers.get("x-forwarded-host", "")

        sec_fetch_site = request.headers.get("sec-fetch-site", "").lower()
        if sec_fetch_site in ("same-origin", "same-site"):
            return True

        hosts = [h.strip() for h in (host, fwd_host) if h and h.strip()]
        for h in hosts:
            h_clean = h.split(":")[0].lower()
            if referer and (h.lower() in referer.lower() or h_clean in referer.lower()):
                return True
            if origin and (h.lower() in origin.lower() or h_clean in origin.lower()):
                return True

        return False

    def _load_config(self) -> dict:
        default_config = {"enabled": False, "username": "admin", "password": ""}
        try:
            if not self.config_path.exists():
                self.enabled = False
                return default_config

            with open(self.config_path, "r", encoding="utf-8") as f:
                config = json.load(f)

            # --- ROBUST CONFIG LOADING ---
            # 1. Look for settings in the "WebUI" group (Nested)
            webui = config.get("WebUI", {}) if isinstance(config.get("WebUI"), dict) else {}
            enabled_nested = webui.get("basicAuthEnabled")
            user_nested = webui.get("basicAuthUsername")
            pass_nested = webui.get("basicAuthPassword")

            # 2. Look for settings at the Root (Flat)
            enabled_root = config.get("basicAuthEnabled")
            user_root = config.get("basicAuthUsername")
            pass_root = config.get("basicAuthPassword")

            # 3. Prioritize: Use Root if present, otherwise Nested
            enabled_val = enabled_root if enabled_root is not None else enabled_nested
            user_val = user_root if user_root is not None else (user_nested or "admin")
            pass_val = pass_root if pass_root is not None else (pass_nested or "posterizarr")

            # Convert to boolean safely
            self.enabled = str(enabled_val).lower() in ["true", "1", "yes"]
            self.username = str(user_val).strip()
            self.password_hash = str(pass_val).strip()

        except Exception as e:
            logger.error(f"AUTH: Error loading config: {e}")
            self.enabled = False

    async def dispatch(self, request: Request, call_next):
        # Reload config on every request to support dynamic changes
        self._load_config()
        
        path = request.url.path
        
        # 1. API Key Check (Always check this first)
        auth_header = request.headers.get("Authorization") or request.headers.get("authorization") or ""
        api_key_candidate = (
            request.query_params.get("api_key") 
            or request.query_params.get("secret") 
            or request.headers.get("X-API-Key")
            or request.headers.get("x-api-key")
        )
        if not api_key_candidate and auth_header.lower().startswith("bearer "):
            api_key_candidate = auth_header[7:].strip()

        is_api_key_valid = False
        if api_key_candidate and self.auth_db:
            if self.auth_db.validate_api_key(api_key_candidate):
                is_api_key_valid = True

        # 2. Webhook Hard Block (ALWAYS requires API Key, regardless of Basic Auth status)
        if path.startswith("/api/webhook/"):
            if is_api_key_valid:
                return await call_next(request)
            else:
                logger.info(f"Blocked unauthenticated webhook request to {path}. Please ensure your webhook URL includes the ?api_key= parameter.")
                return self._unauthorized_response()

        # 2b. Internal Endpoints (Allowed from local loopback or with valid API key)
        if path.startswith("/api/internal/"):
            client_host = request.client.host if request.client else ""
            if client_host in ("127.0.0.1", "::1", "localhost") or is_api_key_valid:
                return await call_next(request)
            else:
                logger.info(f"Blocked unauthorized request to internal endpoint {path} from {client_host}")
                return self._unauthorized_response()

        # If API key is valid for other endpoints, bypass Basic Auth
        if is_api_key_valid:
            return await call_next(request)
        
        # 3. Identify "Browser-Based" assets that need to bypass strict Basic Auth
        browser_assets = (
            "/api/fonts/preview/", 
            "/api/fonts/download/",
            "/api/overlayfiles/preview/", 
            "/api/thumbnail",
            "/api/proxy/poster",
            "/api/media-server/image",
            "/api/dynamic-overlays/preview",
            "/api/dynamic-overlays/sample-image",
            "/api/dynamic-overlays/custom-preview-image",
            "/poster_assets/",
            "/manual_poster_assets/",
            "/backup_assets/",
            "/test/",
            "/images/",
            "/blueprint-previews/"
        )
        if path.startswith(browser_assets):
            if self._is_browser_origin(request):
                return await call_next(request)

        # 4. Whitelist Static Files & Frontend (CRITICAL FIX)
        # Let frontend files pass, but EXPLICITLY do not whitelist protected static assets or API endpoints
        protected_static = ("/poster_assets/", "/manual_poster_assets/", "/backup_assets/", "/test/", "/images/")
        if not path.startswith("/api/") and not path.startswith(protected_static):
             return await call_next(request)

        # 5. Public Access Logic (When Basic Auth is DISABLED)
        if not self.enabled:
            # Prevent direct API access to sensitive endpoints without browser headers
            if path.startswith("/api/config") or path.startswith("/api/auth/keys"):
                if not self._is_browser_origin(request):
                    return self._unauthorized_response()

            return await call_next(request)

        # 6. Basic Auth Logic (When Basic Auth is ENABLED)
        # Allow pre-flight OPTIONS requests for CORS and auth check
        if request.method == "OPTIONS" or path == "/api/auth/check":
            return await call_next(request)

        if not auth_header or not auth_header.lower().startswith("basic "):
            return self._unauthorized_response()

        try:
            b64_part = auth_header.split(" ", 1)[1].strip()
            creds = base64.b64decode(b64_part).decode("utf-8")
            u, p = creds.split(":", 1)
            # Verify username and password
            if secrets.compare_digest(u.strip(), self.username) and self._verify_password(p, self.password_hash):
                return await call_next(request)
        except Exception as auth_ex:
            logger.debug(f"AUTH: Verification exception: {auth_ex}")

        return self._unauthorized_response()

    def _unauthorized_response(self):
        """
        Returns 401 Unauthorized Response WITHOUT triggering browser popup.
        Crucial for custom frontend login screens.
        """
        return Response(
            content="Unauthorized",
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={
                # DO NOT ADD "WWW-Authenticate" here! It causes the double prompt.
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
        )

# Helper function for main.py (Standalone)
def load_auth_config(config_path: Path) -> dict:
    """Helper for main.py to check auth status without instantiating middleware"""
    default_config = {"enabled": False}
    try:
        if not config_path.exists():
            return default_config

        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)

        # Check both locations
        val_root = config.get("basicAuthEnabled")
        val_nested = config.get("WebUI", {}).get("basicAuthEnabled")

        enabled = val_root if val_root is not None else val_nested
        return {"enabled": str(enabled).lower() in ["true", "1", "yes"]}
    except Exception:
        return default_config