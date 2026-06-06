import json
import os
import uuid
from typing import Any

from app.config import settings
from app.services.hashing import sha256_hex
from app.services.canonical_json import canonical_json


class VaultRef:
    def __init__(self, uri: str, commitment: str):
        self.uri = uri
        self.commitment = commitment


def _ensure_vault_dir():
    os.makedirs(settings.vault_path, exist_ok=True)


def put_private_json(obj: dict, object_type: str) -> VaultRef:
    _ensure_vault_dir()
    obj_id = str(uuid.uuid4())
    filename = f"{object_type}_{obj_id}.json"
    filepath = os.path.join(settings.vault_path, filename)

    data_bytes = canonical_json(obj)
    commitment = sha256_hex(data_bytes)

    with open(filepath, "w") as f:
        json.dump(obj, f, indent=2)

    uri = f"vault://{filename}"
    return VaultRef(uri=uri, commitment=commitment)


def get_private_json(vault_uri: str, scope: str = "internal") -> dict | None:
    if not vault_uri.startswith("vault://"):
        return None
    filename = vault_uri.replace("vault://", "")
    filepath = os.path.join(settings.vault_path, filename)
    if not os.path.exists(filepath):
        return None
    with open(filepath) as f:
        return json.load(f)


def redact_for_evaluator(obj: dict, evaluator_scope: str) -> dict:
    redacted = {}
    for k, v in obj.items():
        if k in ("raw_prompts", "raw_tool_inputs", "raw_tool_outputs", "secrets", "private_memory"):
            redacted[k] = "[REDACTED]"
        else:
            redacted[k] = v
    return redacted
