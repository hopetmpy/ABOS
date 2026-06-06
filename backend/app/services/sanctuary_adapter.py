from dataclasses import dataclass


@dataclass
class VerificationResult:
    valid: bool
    status: str  # "verified" | "invalid" | "unknown"
    detail: str = ""


class SanctuaryAdapter:
    def verify_stc(self, stc_id: str) -> VerificationResult:
        return self._verify(stc_id, "mock_stc_")

    def verify_rrc(self, rrc_id: str) -> VerificationResult:
        return self._verify(rrc_id, "mock_rrc_")

    def verify_vap(self, vap_id: str) -> VerificationResult:
        return self._verify(vap_id, "mock_vap_")

    def verify_adsc(self, adsc_id: str) -> VerificationResult:
        return self._verify(adsc_id, "mock_adsc_")

    def verify_action_context(self, context_hash: str) -> VerificationResult:
        if context_hash.startswith("bad_"):
            return VerificationResult(valid=False, status="invalid", detail="Bad context hash")
        return VerificationResult(valid=True, status="verified")

    def _verify(self, artifact_id: str, valid_prefix: str) -> VerificationResult:
        if artifact_id.startswith("bad_"):
            return VerificationResult(valid=False, status="invalid", detail="Failed verification")
        if artifact_id.startswith(valid_prefix):
            return VerificationResult(valid=True, status="verified")
        return VerificationResult(valid=False, status="unknown", detail="Unknown artifact ID")


sanctuary_adapter = SanctuaryAdapter()
