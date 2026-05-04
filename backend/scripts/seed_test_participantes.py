#!/usr/bin/env python3
"""
Seed de participantes de PRUEBA para una cohorte.
Crea usuarios en Supabase Auth con email sintético + entrada en participantes_lista.

Uso:
  python3 backend/scripts/seed_test_participantes.py [cohorte_id]
  default cohorte = int-26-28
"""
import os, sys, json, ssl, urllib.request, hashlib, subprocess

# Datos demo (cédula, nombre completo, email institucional, password)
PARTICIPANTES = [
    ("1010101010", "Juan Pérez Mendoza",     "juan.perez@inalde.edu.co",     "Naves2026!"),
    ("1010101011", "María González Ruiz",    "maria.gonzalez@inalde.edu.co", "Naves2026!"),
    ("1010101012", "Carlos Rodríguez Soto",  "carlos.rodriguez@inalde.edu.co","Naves2026!"),
    ("1010101013", "Ana López Castaño",      "ana.lopez@inalde.edu.co",      "Naves2026!"),
    ("1010101014", "Diego Torres Vargas",    "diego.torres@inalde.edu.co",   "Naves2026!"),
    ("1010101015", "Laura Ramírez Quintero", "laura.ramirez@inalde.edu.co",  "Naves2026!"),
]


def load_secrets():
    s = {}
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for path in [os.path.join(repo_root, ".supabase-secrets.env"),
                 os.path.join(repo_root, ".naves-app-secrets.env")]:
        if os.path.isfile(path):
            for line in open(path):
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("="); s[k.strip()] = v.strip()
    return s


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def synthetic_email(cedula: str) -> str:
    return f"{sha256(cedula.replace('.', '').replace('-', '').replace(' ', ''))}@naves.local"


def encrypt_pii(plaintext: str, key_hex: str) -> str:
    """Encripta con AES-256-GCM usando Node (mismo algoritmo que backend)."""
    js = f"""
const c = require('crypto');
const k = Buffer.from('{key_hex}', 'hex');
const iv = c.randomBytes(12);
const cip = c.createCipheriv('aes-256-gcm', k, iv);
const ct = Buffer.concat([cip.update('{plaintext}', 'utf8'), cip.final()]);
const tag = cip.getAuthTag();
process.stdout.write(Buffer.concat([iv, tag, ct]).toString('base64'));
"""
    return subprocess.check_output(["node", "-e", js]).decode()


def create_auth_user(supabase_url: str, svc_key: str, email: str, password: str, app_metadata: dict) -> str:
    body = json.dumps({"email": email, "password": password, "email_confirm": True, "app_metadata": app_metadata}).encode()
    req = urllib.request.Request(f"{supabase_url}/auth/v1/admin/users", data=body, method="POST",
        headers={"apikey": svc_key, "Authorization": f"Bearer {svc_key}", "Content-Type": "application/json"})
    ctx = ssl._create_unverified_context()
    try:
        return json.loads(urllib.request.urlopen(req, context=ctx).read())["id"]
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if "already" in body.lower() or "registered" in body.lower():
            # Buscar el ya existente
            req = urllib.request.Request(f"{supabase_url}/auth/v1/admin/users",
                headers={"apikey": svc_key, "Authorization": f"Bearer {svc_key}"})
            users = json.loads(urllib.request.urlopen(req, context=ctx).read())["users"]
            return next(u["id"] for u in users if u["email"] == email)
        raise


def update_user_metadata(supabase_url: str, svc_key: str, user_id: str, app_metadata: dict):
    body = json.dumps({"app_metadata": app_metadata}).encode()
    req = urllib.request.Request(f"{supabase_url}/auth/v1/admin/users/{user_id}", data=body, method="PUT",
        headers={"apikey": svc_key, "Authorization": f"Bearer {svc_key}", "Content-Type": "application/json"})
    ctx = ssl._create_unverified_context()
    urllib.request.urlopen(req, context=ctx).read()


def upsert_participante(supabase_url: str, svc_key: str, row: dict) -> str:
    body = json.dumps(row).encode()
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/participantes_lista?on_conflict=cohorte_id,cedula_hash",
        data=body, method="POST",
        headers={"apikey": svc_key, "Authorization": f"Bearer {svc_key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=representation"},
    )
    ctx = ssl._create_unverified_context()
    return json.loads(urllib.request.urlopen(req, context=ctx).read())[0]["id"]


def main():
    cohorte = sys.argv[1] if len(sys.argv) > 1 else "int-26-28"
    s = load_secrets()
    SUPABASE_URL = s["SUPABASE_URL"]
    SVC = s["SUPABASE_SERVICE_ROLE_KEY"]
    PII = s["PII_ENCRYPTION_KEY"]

    print(f"→ Sembrando {len(PARTICIPANTES)} participantes en cohorte '{cohorte}'\n")
    for cedula, nombre, email, password in PARTICIPANTES:
        synth = synthetic_email(cedula)
        cedula_hash = sha256(cedula)
        email_hash = sha256(email)

        # 1. Auth user
        user_id = create_auth_user(SUPABASE_URL, SVC, synth, password, {"app_role": "participante", "cohorte_id": cohorte})

        # 2. participantes_lista
        row = {
            "auth_user_id": user_id,
            "cohorte_id": cohorte,
            "nombre_completo": nombre,
            "cedula_encriptada": encrypt_pii(cedula, PII),
            "cedula_hash": cedula_hash,
            "email_encriptado": encrypt_pii(email, PII),
            "email_hash": email_hash,
            "estado": "activo",
        }
        pid = upsert_participante(SUPABASE_URL, SVC, row)

        # 3. update auth metadata to include participante_id
        update_user_metadata(SUPABASE_URL, SVC, user_id, {
            "app_role": "participante",
            "cohorte_id": cohorte,
            "participante_id": pid,
        })

        print(f"  ✓ {nombre:35s} cédula={cedula} pid={pid}")

    print(f"\n=== Credenciales para login (frontend tab 'Participante') ===")
    for cedula, nombre, _, password in PARTICIPANTES:
        print(f"  cédula: {cedula} · clave: {password} · {nombre}")


if __name__ == "__main__":
    main()
