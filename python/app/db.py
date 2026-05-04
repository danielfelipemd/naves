from supabase import Client, create_client
from .config import settings


def get_supabase_admin() -> Client:
    """Service-role client (bypasses RLS). Used for admin reads/writes from Python."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
