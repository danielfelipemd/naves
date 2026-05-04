from datetime import datetime, timezone
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "service": "naves-python", "ts": datetime.now(timezone.utc).isoformat()}


@router.get("/health/deep")
def health_deep():
    from ..db import get_supabase_admin
    checks = {"service": "ok"}
    try:
        sb = get_supabase_admin()
        res = sb.table("cohortes").select("id").limit(1).execute()
        checks["supabase"] = {"ok": True, "rows_seen": len(res.data or [])}
    except Exception as e:
        checks["supabase"] = {"ok": False, "error": str(e)}
    return {"status": "ok", "checks": checks}
