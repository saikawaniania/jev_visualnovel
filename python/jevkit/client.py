"""Thin wrapper around TypeSafeClient: loads .env once, then hands out a client.

Keep this client (and the TYPESAFE_API_KEY it reads) on the server. Never
import it into code that ships to a browser.
"""

from __future__ import annotations

from dotenv import load_dotenv
from typesafe_sdk import TypeSafeClient

_env_loaded = False


def get_client(**overrides) -> TypeSafeClient:
    """Return a TypeSafeClient, loading .env on first use.

    Extra keyword arguments are forwarded to TypeSafeClient (e.g. model=,
    retry=, timeout=) so callers can override defaults per use case.
    """
    global _env_loaded
    if not _env_loaded:
        load_dotenv()
        _env_loaded = True
    return TypeSafeClient(**overrides)
