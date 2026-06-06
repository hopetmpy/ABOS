import hashlib
from typing import Any

from app.services.canonical_json import canonical_json


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def commitment_for_json(data: Any, domain: str) -> str:
    payload = canonical_json({"domain": domain, "data": data})
    return sha256_hex(payload)
