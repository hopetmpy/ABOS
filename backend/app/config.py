from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./data/conway.db"
    receipt_vault_key: str = "dev-only-key"
    encrypt_receipts: bool = True
    sanctuary_mode: str = "mock"
    mpp_mode: str = "mock"
    deploy_mode: str = "mock"
    llm_provider: str = "none"
    vault_path: str = "./data/vault"

    class Config:
        env_file = ".env"


settings = Settings()
