from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    port: int = 8000
    supabase_url: str = "http://naves_supabase-kong:8000"
    supabase_service_role_key: str = ""
    internal_api_token: str = ""
    cors_origins: str = "http://naves_backend:3000"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
