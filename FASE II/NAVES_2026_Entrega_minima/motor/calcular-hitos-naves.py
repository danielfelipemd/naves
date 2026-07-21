"""
calcular-hitos-naves.py
=======================
Calcula automáticamente los 13 hitos del programa NAVES
Executive MBA — INALDE Business School

INSTRUCCIONES DE USO:
  1. Editar la sección "CONFIGURACIÓN DE LA COHORTE" (primeras ~55 líneas)
  2. Ejecutar:  python3 calcular-hitos-naves.py

  Los festivos de Colombia se cargan automáticamente desde la librería
  'holidays'. No es necesario copiarlos del calendario.

OUTPUT: tabla de hitos con fechas, días y ajustes aplicados.
"""

from datetime import date, timedelta
try:
    import holidays as holidays_lib
    _HOLIDAYS_OK = True
except ImportError:
    _HOLIDAYS_OK = False

# ================================================================
# CONFIGURACIÓN DE LA COHORTE  ← Editar aquí para cada cohorte
# ================================================================

PROGRAMA = "Fin de Semana"   # "Intensivo"  o  "Fin de Semana"

# Fechas ancla
KICK_OFF = date(2026, 1, 26)   # Hito 1: fecha del Kick Off
ANCLA    = date(2026, 6, 12)   # Hito 12: primera jornada de presentaciones

# Jornadas de clase del período (tomadas de la plantilla que entrega el MBA)
# Fin de Semana → Viernes y Sábados
# Intensivo     → Lunes, Martes y Miércoles
JORNADAS_CLASE = [
    # ── ENERO ──────────────────────────────────────────────────
    date(2026,  1,  9), date(2026,  1, 10),
    date(2026,  1, 16), date(2026,  1, 17),
    date(2026,  1, 23), date(2026,  1, 24),
    date(2026,  1, 30), date(2026,  1, 31),
    # ── FEBRERO ────────────────────────────────────────────────
    date(2026,  2,  6), date(2026,  2,  7),
    date(2026,  2, 13), date(2026,  2, 14),
    date(2026,  2, 20), date(2026,  2, 21),
    date(2026,  2, 27), date(2026,  2, 28),
    # ── MARZO ──────────────────────────────────────────────────
    date(2026,  3,  6), date(2026,  3,  7),
    date(2026,  3, 13), date(2026,  3, 14),
    date(2026,  3, 20), date(2026,  3, 21),
    date(2026,  3, 27), date(2026,  3, 28),
    # ── ABRIL (Semana Santa: 30 mar – 5 abr, sin clase) ───────
    date(2026,  4, 10), date(2026,  4, 11),
    date(2026,  4, 17), date(2026,  4, 18),
    date(2026,  4, 24), date(2026,  4, 25),
    # ── MAYO ───────────────────────────────────────────────────
    date(2026,  5,  8),                      # Semana Internacional (viernes)
    date(2026,  5, 15), date(2026,  5, 16),
    date(2026,  5, 22), date(2026,  5, 23),
    date(2026,  5, 29), date(2026,  5, 30),
    # ── JUNIO ──────────────────────────────────────────────────
    date(2026,  6,  5), date(2026,  6,  6),
    date(2026,  6, 12), date(2026,  6, 13),  # Presentaciones NAVES
    date(2026,  6, 19), date(2026,  6, 20),  # Presentaciones NAVES
]

# Semana Santa (solo para "Fin de Semana" — toda la semana cuenta como NO hábil)
# Indicar el lunes de esa semana; el script genera los 7 días.
# Para Intensivo este parámetro no afecta el cálculo.
LUNES_SEMANA_SANTA = date(2026, 3, 30)

# ================================================================
# MOTOR DE CÁLCULO  ← No modificar
# ================================================================

# ── Festivos de Colombia (automático) ───────────────────────────
_anios = set()
for d in [KICK_OFF, ANCLA]:
    _anios.add(d.year)
_anios.add(KICK_OFF.year + 1)   # por si el período cruza año

if _HOLIDAYS_OK:
    FESTIVOS_CO = holidays_lib.Colombia(years=sorted(_anios))
else:
    FESTIVOS_CO = {}
    print("⚠️  Librería 'holidays' no instalada. Ejecute: pip install holidays")

FESTIVOS_SET = set(FESTIVOS_CO.keys())

# ── Semana Santa ─────────────────────────────────────────────────
SEMANA_SANTA = [LUNES_SEMANA_SANTA + timedelta(days=i) for i in range(7)]
SEMANA_SANTA_SET = set(SEMANA_SANTA)

DIAS_ES = {0: "Lunes", 1: "Martes", 2: "Miércoles",
           3: "Jueves", 4: "Viernes", 5: "Sábado", 6: "Domingo"}

MESES_ES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
            "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

JORNADAS_SET = set(JORNADAS_CLASE)


def es_habil(d: date) -> bool:
    """Lunes–Viernes. Para Fin de Semana, excluye Semana Santa.
    Nota: los festivos SÍ cuentan como hábiles (regla NAVES)."""
    if d.weekday() >= 5:
        return False
    if PROGRAMA == "Fin de Semana" and d in SEMANA_SANTA_SET:
        return False
    return True


def es_jornada(d: date) -> bool:
    return d in JORNADAS_SET


def es_festivo(d: date) -> bool:
    return d in FESTIVOS_SET


def sig_habil(d: date) -> date:
    """Primer día hábil a partir de d (inclusive)."""
    while not es_habil(d):
        d += timedelta(days=1)
    return d


def sig_habil_libre(d: date) -> date:
    """Primer día hábil sin jornada de clase a partir de d (inclusive).
    Aplica a reuniones grupales (6:30 PM)."""
    while not es_habil(d) or es_jornada(d):
        d += timedelta(days=1)
    return d


def prev_habil(d: date) -> date:
    """Último día hábil estrictamente anterior a d (para Hitos 0a/0b)."""
    d = d - timedelta(days=1)
    while not es_habil(d):
        d -= timedelta(days=1)
    return d


def mas_habiles(ref: date, n: int) -> date:
    """Devuelve el día que resulta de contar n días hábiles a partir
    del día SIGUIENTE a ref."""
    d = ref + timedelta(days=1)
    cuenta = 0
    while True:
        if es_habil(d):
            cuenta += 1
            if cuenta == n:
                return d
        d += timedelta(days=1)


def menos_habil(ref: date) -> date:
    """Último día hábil antes de ref (para Intensivo, Hito 10)."""
    d = ref - timedelta(days=1)
    while not es_habil(d):
        d -= timedelta(days=1)
    return d


def ajuste_str(raw: date, final: date) -> str:
    return f"{raw} ({DIAS_ES[raw.weekday()]}) → {final} ({DIAS_ES[final.weekday()]})"


# ── Cálculo de hitos ────────────────────────────────────────────

notas = {}   # {num_hito: texto de ajuste}

# Hitos 0a / 0b: último día hábil ANTES del Kick Off
h0 = prev_habil(KICK_OFF)
_h0_raw = KICK_OFF - timedelta(days=1)
if h0 != _h0_raw:
    notas["0a/0b"] = ajuste_str(_h0_raw, h0)

# Hito 1: Kick Off (fecha fija)
h1 = KICK_OFF

# Hito 2: 13 días calendario después del Kick Off → ajustar a hábil
_h2_raw = h1 + timedelta(days=13)
h2 = sig_habil(_h2_raw)
if h2 != _h2_raw:
    notas[2] = ajuste_str(_h2_raw, h2)

# Hito 3: 2 días hábiles después del Hito 2
h3 = mas_habiles(h2, 2)

# Hito 4: día calendario siguiente al Hito 3 → ajustar a hábil
_h4_raw = h3 + timedelta(days=1)
h4 = sig_habil(_h4_raw)
if h4 != _h4_raw:
    notas[4] = ajuste_str(_h4_raw, h4)

# Hito 5: 18 días hábiles después del Hito 3
h5 = mas_habiles(h3, 18)

# Hito 6: 1 día hábil después del Hito 5
h6 = mas_habiles(h5, 1)

# Hito 7: 25 días hábiles después del Hito 5
h7 = mas_habiles(h5, 25)

# Hito 8: 9 días hábiles después del Hito 7
h8 = mas_habiles(h7, 9)

# Hito 10 y 11 (difieren por programa)
if PROGRAMA == "Fin de Semana":
    # Hito 10: 10 días calendario antes del Ancla → ajustar a hábil
    _h10_raw = ANCLA - timedelta(days=10)
    h10 = sig_habil(_h10_raw)
    if h10 != _h10_raw:
        notas[10] = ajuste_str(_h10_raw, h10)
else:
    # Intensivo: Hito 10 = último día hábil antes del Ancla
    h10 = menos_habil(ANCLA)
    notas[10] = f"1 día hábil antes del ancla ({ANCLA})"

# Hito 11: siguiente día hábil SIN jornada de clase después del Hito 10
_h11_raw = h10 + timedelta(days=1)
h11 = sig_habil_libre(_h11_raw)
if h11 != _h11_raw:
    notas[11] = ajuste_str(_h11_raw, h11)

# Hito 9: 60 días calendario antes del Hito 10 → ajustar a hábil sin jornada
_h9_raw = h10 - timedelta(days=60)
h9 = sig_habil_libre(_h9_raw)
if h9 != _h9_raw:
    notas[9] = ajuste_str(_h9_raw, h9)

# Hito 12: Ancla (fecha fija)
h12 = ANCLA

# Hito 13: día siguiente al Ancla
h13 = ANCLA + timedelta(days=1)

# ── Tabla de hitos ──────────────────────────────────────────────

HITOS = [
    ("0a",  "Conformación grupo WhatsApp oficial",        h0,  "—      "),
    ("0b",  "Entrega de notas técnicas e instrucciones",  h0,  "—      "),
    ("1",   "Kick Off / Lanzamiento",                     h1,  "6:30 PM"),
    ("2",   "Entrega anteproyecto",                       h2,  "7:59 AM"),
    ("3",   "Publicación profesores y agendas",           h3,  "6:00 PM"),
    ("4",   "Ventana R1 — INICIO",                        h4,  "8:00 AM"),
    ("5",   "Ventana R1 — CIERRE",                        h5,  "7:30 PM"),
    ("6",   "Fecha límite cambios",                       h6,  "6:00 PM"),
    ("7",   "Ventana R2 — INICIO",                        h7,  "8:00 AM"),
    ("8",   "Ventana R2 — CIERRE",                        h8,  "7:30 PM"),
    ("9",   "Reunión grupal '60 días antes'",             h9,  "6:30 PM"),
    ("10",  "Entrega final documentos",                   h10, "7:59 AM"),
    ("11",  "Reunión preparación presentación",           h11, "6:30 PM"),
    ("12",  "Primera jornada presentaciones (ANCLA)",     h12, "—      "),
    ("13",  "Segunda jornada presentaciones",             h13, "—      "),
]

# ── Salida ──────────────────────────────────────────────────────

anio = KICK_OFF.year
print()
print("=" * 80)
print(f"  NAVES {anio}  |  MBA {PROGRAMA.upper()}  |  Kick Off: {KICK_OFF}  |  Ancla: {ANCLA}")
print("=" * 80)
print(f"  {'#':<5} {'HITO':<44} {'FECHA':<13} {'DÍA':<11} {'HORA':<9} {'FESTIVO'}")
print(f"  {'-'*80}")

for num, nombre, fecha, hora in HITOS:
    dia = DIAS_ES[fecha.weekday()]
    festivo_nota = f"⚠ {FESTIVOS_CO[fecha]}" if fecha in FESTIVOS_CO else ""
    print(f"  {num:<5} {nombre:<44} {str(fecha):<13} {dia:<11} {hora:<9} {festivo_nota}")

if notas:
    print()
    print("  AJUSTES APLICADOS:")
    for num, desc in notas.items():
        print(f"    • Hito #{num}: {desc}")

print("=" * 80)

# ── Festivos del período (referencia) ───────────────────────────

if FESTIVOS_CO:
    inicio = min(KICK_OFF, ANCLA) - timedelta(days=30)
    fin    = max(KICK_OFF, ANCLA) + timedelta(days=30)
    festivos_periodo = sorted(
        [(d, n) for d, n in FESTIVOS_CO.items() if inicio <= d <= fin]
    )
    if festivos_periodo:
        print()
        print("  FESTIVOS COLOMBIA EN EL PERÍODO (cargados automáticamente):")
        for d, nombre in festivos_periodo:
            print(f"    • {d} ({DIAS_ES[d.weekday()]}) — {nombre}")

print()

# ── Verificaciones de coherencia ────────────────────────────────

errores = []

if h2 <= h1:
    errores.append("Hito 2 no es posterior al Hito 1")
if h5 <= h4:
    errores.append("Cierre R1 no es posterior al inicio R1")
if h7 <= h6:
    errores.append("Inicio R2 no es posterior a fecha límite cambios")
if h8 <= h7:
    errores.append("Cierre R2 no es posterior al inicio R2")
if h10 >= h12:
    errores.append("Entrega final no es anterior al Ancla")
if h11 >= h12:
    errores.append("Reunión preparación no es anterior al Ancla")
if h9 >= h10:
    errores.append("Reunión 60 días no es anterior a la entrega final")

if errores:
    print("⚠️  ADVERTENCIAS DE COHERENCIA:")
    for e in errores:
        print(f"    • {e}")
    print()
else:
    print("  ✅ Todas las fechas son coherentes entre sí.")
    print()
