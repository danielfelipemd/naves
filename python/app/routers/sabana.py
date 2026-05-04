"""Generación de la sábana consolidada de proyectos por cohorte + sugerencia de asignación."""
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import require_internal_token
from ..db import get_supabase_admin

router = APIRouter(prefix="/sabana", tags=["sabana"], dependencies=[Depends(require_internal_token)])


@router.post("/{cohorte_id}/generar")
def generar_sabana(cohorte_id: str) -> dict[str, Any]:
    """Construye la sábana — vista consolidada de todos los proyectos definitivos de la cohorte."""
    sb = get_supabase_admin()

    # Verify cohorte
    coh = sb.table("cohortes").select("id, etiqueta").eq("id", cohorte_id).maybeSingle().execute()
    if not coh.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cohorte no existe")

    # Pull all anteproyectos of this cohorte with their projects + members
    equipos = sb.table("equipos").select(
        "id, nombre_equipo, miembros_equipo(participante_id, posicion, "
        "participantes_lista(nombre_completo)), "
        "anteproyectos(id, estado, proyectos(id, nombre, sector, ciiu, tipo, estado_seleccion, "
        "canvas_cliente_problema))"
    ).eq("cohorte_id", cohorte_id).execute()

    snapshot = []
    for eq in equipos.data or []:
        antes = (eq.get("anteproyectos") or [])
        ant = antes[0] if antes else None
        if not ant or ant.get("estado") != "enviado":
            continue
        for p in ant.get("proyectos") or []:
            snapshot.append({
                "equipo_id": eq["id"],
                "equipo_nombre": eq.get("nombre_equipo"),
                "proyecto_id": p["id"],
                "proyecto_nombre": p["nombre"],
                "sector": p.get("sector"),
                "ciiu": p.get("ciiu"),
                "tipo": p.get("tipo"),
                "estado_seleccion": p.get("estado_seleccion"),
                "resumen": (p.get("canvas_cliente_problema") or "")[:300],
                "miembros": [
                    {
                        "nombre": (m.get("participantes_lista") or {}).get("nombre_completo"),
                        "posicion": m.get("posicion"),
                    }
                    for m in (eq.get("miembros_equipo") or [])
                ],
            })

    # Upsert sabana record
    sb.table("sabanas_proyectos").upsert(
        {"cohorte_id": cohorte_id, "estado": "generada", "snapshot": snapshot},
        on_conflict="cohorte_id",
    ).execute()

    return {"cohorte_id": cohorte_id, "proyectos": len(snapshot), "snapshot": snapshot}


@router.post("/{cohorte_id}/sugerir-asignacion")
def sugerir_asignacion(cohorte_id: str) -> dict[str, Any]:
    """Empareja proyectos definitivos con profesores según sector/CIIU/areas_afinidad."""
    sb = get_supabase_admin()

    profesores = sb.table("profesores").select(
        "id, nombre_completo, areas_afinidad"
    ).eq("activo", True).execute()

    sabana = sb.table("sabanas_proyectos").select("snapshot").eq(
        "cohorte_id", cohorte_id
    ).maybeSingle().execute()
    if not sabana.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sábana no generada todavía")

    sugerencias = []
    for p in sabana.data.get("snapshot") or []:
        if p.get("estado_seleccion") != "definitivo":
            continue
        scores = []
        for prof in profesores.data or []:
            afinidad = prof.get("areas_afinidad") or []
            score = sum(
                1 for a in afinidad
                if (p.get("sector") and a.lower() in p["sector"].lower())
                or (p.get("ciiu") and a == p["ciiu"])
            )
            scores.append({"profesor_id": prof["id"], "profesor": prof["nombre_completo"], "score": score})
        scores.sort(key=lambda x: -x["score"])
        sugerencias.append({"equipo_id": p["equipo_id"], "top": scores[:3]})

    sb.table("sabanas_proyectos").update({"sugerencias": sugerencias}).eq(
        "cohorte_id", cohorte_id
    ).execute()

    return {"sugerencias": sugerencias}
