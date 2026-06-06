import uuid
from dataclasses import dataclass
from typing import Protocol

from app.models.deploy import DeploymentCapsule, DeploymentLease


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str]


@dataclass
class CostEstimate:
    preview_cost: float
    canary_cost: float
    production_cost: float
    daily_infra: float


@dataclass
class TestResult:
    name: str
    passed: bool
    detail: str = ""


class DeployAdapter(Protocol):
    provider: str

    def validate(self, capsule: DeploymentCapsule) -> ValidationResult: ...
    def estimate_cost(self, capsule: DeploymentCapsule) -> CostEstimate: ...
    def create_preview(self, capsule: DeploymentCapsule, lease: DeploymentLease) -> dict: ...
    def run_smoke_tests(self, deployment: dict) -> list[TestResult]: ...
    def promote_canary(self, deployment: dict) -> dict: ...
    def promote_production(self, deployment: dict) -> dict: ...
    def rollback(self, deployment: dict) -> dict: ...


class MockDeployAdapter:
    provider = "mock_cloudflare"

    def validate(self, capsule: DeploymentCapsule) -> ValidationResult:
        errors = []
        if capsule.name and "bad-secret" in capsule.name:
            errors.append("Secret scan failed: capsule name contains 'bad-secret'")
        budget = capsule.budget or {}
        if budget.get("max_daily_infra_cost", 0) < 1.00:
            errors.append("Cost check failed: max_daily_infra_cost < 1.00")
        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def estimate_cost(self, capsule: DeploymentCapsule) -> CostEstimate:
        return CostEstimate(
            preview_cost=0.10,
            canary_cost=0.25,
            production_cost=0.50,
            daily_infra=1.00,
        )

    def create_preview(self, capsule: DeploymentCapsule, lease: DeploymentLease) -> dict:
        deploy_id = uuid.uuid4().hex[:8]
        return {
            "build": {"status": "success", "duration_seconds": 12},
            "authorization": {"install_ring": "R3_WRITE", "authority_check": "pass"},
            "deployment": {
                "deployment_id": deploy_id,
                "preview_url": f"https://preview-{deploy_id}.mock.conway.local",
                "status": "preview_deployed",
            },
            "checks": {
                "secret_scan": "pass",
                "cost_cap": "pass",
                "payment_routes": "pass",
                "health_check": "pass",
            },
            "economics": {
                "preview_cost": 0.10,
                "estimated_daily": 1.00,
            },
        }

    def run_smoke_tests(self, deployment: dict) -> list[TestResult]:
        return [
            TestResult(name="health_check", passed=True),
            TestResult(name="route_check", passed=True),
            TestResult(name="payment_check", passed=True),
        ]

    def promote_canary(self, deployment: dict) -> dict:
        deploy_id = deployment.get("deployment", {}).get("deployment_id", "unknown")
        deployment["deployment"]["status"] = "canary"
        deployment["deployment"]["canary_url"] = f"https://canary-{deploy_id}.mock.conway.local"
        return deployment

    def promote_production(self, deployment: dict) -> dict:
        deploy_id = deployment.get("deployment", {}).get("deployment_id", "unknown")
        deployment["deployment"]["status"] = "production"
        deployment["deployment"]["production_url"] = f"https://{deploy_id}.mock.conway.local"
        return deployment

    def rollback(self, deployment: dict) -> dict:
        deployment["deployment"]["status"] = "rolled_back"
        return deployment


mock_deploy_adapter = MockDeployAdapter()
