#!/usr/bin/env python3
"""
Seed del catálogo CIIU Rev. 4 A.C. 2020 desde el Excel oficial del DANE.

Estructura del .xls:
  - Una sola hoja
  - Filas tipo "SECCIÓN A" en col 0 marcan inicio de sección
  - 4 columnas: División | Grupo | Clase | Descripción
  - Las clases (4 dígitos) están en col 2; section/division/grupo se infieren

Uso:
  python3 backend/scripts/seed_ciiu.py
  (requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno o en
   ../.supabase-secrets.env del root del repo)
"""
import os, sys, json, ssl, urllib.request, re, hashlib
from io import BytesIO

try:
    import xlrd  # legacy .xls
except ImportError:
    sys.exit("Instala xlrd 1.2.0:  pip3 install 'xlrd==1.2.0'")

DANE_URL = "https://www.dane.gov.co/files/sen/nomenclatura/ciiu/Estructura-detallada-CIIU-4AC-2020-.xls"


def load_secrets():
    secrets = {}
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_path = os.path.join(repo_root, ".supabase-secrets.env")
    if os.path.isfile(env_path):
        for line in open(env_path):
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                secrets[k.strip()] = v.strip()
    secrets["SUPABASE_URL"] = os.environ.get("SUPABASE_URL", secrets.get("SUPABASE_URL", ""))
    secrets["SUPABASE_SERVICE_ROLE_KEY"] = os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY", secrets.get("SUPABASE_SERVICE_ROLE_KEY", "")
    )
    if not (secrets["SUPABASE_URL"] and secrets["SUPABASE_SERVICE_ROLE_KEY"]):
        sys.exit("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
    return secrets


def download_xls() -> bytes:
    print(f"→ Descargando {DANE_URL}")
    try:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(DANE_URL, timeout=30, context=ctx) as r:
            data = r.read()
        print(f"  {len(data):,} bytes")
        return data
    except Exception as e:
        sys.exit(f"Falló descarga: {e}")


SECTION_RE = re.compile(r"^SECCI[OÓ]N\s+([A-U])\b", re.IGNORECASE)


def parse_xls(data: bytes) -> list[dict]:
    book = xlrd.open_workbook(file_contents=data)
    sheet = book.sheet_by_index(0)
    out: list[dict] = []
    section: str | None = None

    for r in range(sheet.nrows):
        row = [str(c.value).strip() for c in sheet.row(r)]
        joined = " ".join(row)
        m = SECTION_RE.search(joined)
        if m:
            section = m.group(1).upper()
            continue

        # Find a 4-digit code in any of the first columns
        codigo = None
        for cell in row[:3]:
            cell_clean = cell.replace(".0", "") if cell.endswith(".0") else cell
            if re.fullmatch(r"\d{4}", cell_clean):
                codigo = cell_clean
                break

        if not codigo or not section:
            continue

        # Description is the longest text cell in the row (last typically)
        desc = max((c for c in row if not re.fullmatch(r"\d+(\.0)?", c)), key=len, default="")
        if not desc or len(desc) < 5:
            continue

        out.append({
            "codigo": codigo,
            "descripcion": desc[:500],
            "seccion": section,
            "division": codigo[:2],
            "grupo": codigo[:3],
            "activo": True,
        })
    return out


def upsert_batch(supabase_url: str, key: str, rows: list[dict]):
    url = f"{supabase_url}/rest/v1/codigos_ciiu?on_conflict=codigo"
    body = json.dumps(rows).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    ctx = ssl._create_unverified_context()
    try:
        urllib.request.urlopen(req, context=ctx, timeout=60).read()
    except urllib.error.HTTPError as e:
        sys.exit(f"Upsert falló HTTP {e.code}: {e.read().decode()[:300]}")


def main():
    s = load_secrets()
    data = download_xls()
    rows = parse_xls(data)
    print(f"→ Parseadas {len(rows)} clases CIIU")
    if not rows:
        sys.exit("Cero filas, revisa el parser")

    # Upsert en lotes de 100 para evitar payloads gigantes
    BATCH = 100
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        upsert_batch(s["SUPABASE_URL"], s["SUPABASE_SERVICE_ROLE_KEY"], chunk)
        print(f"  upsert {i + len(chunk)}/{len(rows)}")

    print(f"\n✓ Catálogo CIIU sembrado: {len(rows)} clases")


if __name__ == "__main__":
    main()
