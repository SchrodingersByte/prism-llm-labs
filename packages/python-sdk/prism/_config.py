import os
from typing import Optional

_DEFAULT_APP_URL = "https://prism-dip-dey-s-projects.vercel.app"

_ingest_url: Optional[str] = os.environ.get("PRISM_INGEST_URL")


def configure(*, ingest_url: Optional[str] = None) -> None:
    global _ingest_url
    if ingest_url is not None:
        _ingest_url = ingest_url


def get_ingest_url() -> str:
    if _ingest_url:
        return _ingest_url
    base = os.environ.get("PRISM_APP_URL", _DEFAULT_APP_URL).rstrip("/")
    return f"{base}/api/ingest"
