#!/usr/bin/env python3
"""
NAVES 2026 — Generador de base de datos HTML
Lee los 35 proyectos MBA FS 24-26, extrae texto de PDFs,
llama a Claude API y genera sitio web con look INALDE/NAVES.
"""

import os, re, json, shutil, base64, unicodedata
from pathlib import Path
import pdfplumber

# ═══════════════════════════════════════════════════════════════
# CONFIGURACIÓN
# ═══════════════════════════════════════════════════════════════
ONEDRIVE = Path("/Users/juanmanuel/Library/CloudStorage/OneDrive-INALDEBusinessSchool-UniversidaddeLaSabana")
LOGO_DIR   = ONEDRIVE / "Logotipo MBA FS 24-26"
BP_DIR     = ONEDRIVE / "Business Plan MBA FS 24-26"
RESUMEN_DIR= ONEDRIVE / "Resumen MBA FS 24-26"
OUTPUT_DIR = Path("/Users/juanmanuel/Desktop/NAVES_2026_Web")

# Proyectos confidenciales (sin descargas)
CONFIDENCIALES = {"CDO Alianza"}

# Sectores consolidados (8 grupos)
SECTORES = {
    "AKOS":              "FinTech / Financiero",
    "AMIGO":             "IA / Tecnología",
    "ARCO":              "IA / Tecnología",
    "Avia Style":        "Otros",
    "Bevo":              "RRHH / Bienestar",
    "Bio Value":         "AgriTech / Sostenibilidad",
    "Broker LLM":        "IA / Tecnología",
    "CDO Alianza":       "IA / Tecnología",
    "Chargehub":         "Movilidad / Energía",
    "CLIC":              "IA / Tecnología",
    "FioYa":             "FinTech / Financiero",
    "Grey2Blue":         "AgriTech / Sostenibilidad",
    "HERITAGEBOX":       "Otros",
    "Jornalia":          "AgriTech / Sostenibilidad",
    "KLAR":              "IA / Tecnología",
    "La Etapa Café":     "Alimentos / F&B",
    "Moovday":           "Salud / Deporte",
    "Mony":              "FinTech / Financiero",
    "New Car Now":       "Movilidad / Energía",
    "OVILAND":           "Alimentos / F&B",
    "PLICS":             "IA / Tecnología",
    "Plug&GoEV":         "Movilidad / Energía",
    "Ready2":            "Alimentos / F&B",
    "SABE":              "Alimentos / F&B",
    "SATORI":            "RRHH / Bienestar",
    "Segunda Mesa":      "Alimentos / F&B",
    "T-HEALTH":          "HealthTech / Salud",
    "TRADECOM ECUADOR":  "Otros",
    "VecinoPro":         "IA / Tecnología",
    "Verifika":          "FinTech / Financiero",
    "Viora":             "HealthTech / Salud",
    "Zafiro":            "IA / Tecnología",
    "güdplant":          "AgriTech / Sostenibilidad",
    "sabIO":             "FinTech / Financiero",
    "VERIMED":           "HealthTech / Salud",
}

# Correcciones de nombres (del logo al nombre canónico del proyecto)
NAME_CORRECTIONS = {
    "clic07":   "CLIC",
    "clic-07":  "CLIC",
    "fioya":    "FioYa",
    "oviland":  "OVILAND",
}

SECTOR_COLORS = {
    "FinTech / Financiero":      "#1a6b3c",
    "IA / Tecnología":           "#4a1a8e",
    "HealthTech / Salud":        "#8a0a1a",
    "Movilidad / Energía":       "#0a5b8a",
    "Alimentos / F&B":           "#8a3d0a",
    "AgriTech / Sostenibilidad": "#3d6b0a",
    "RRHH / Bienestar":          "#1a4a6b",
    "Salud / Deporte":           "#0a6b5b",
    "Otros":                     "#4a4a4a",
}

# ═══════════════════════════════════════════════════════════════
# PASO 1: NORMALIZAR NOMBRE PARA MATCHING
# ═══════════════════════════════════════════════════════════════
def normalize(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]', '', s.lower())

# ═══════════════════════════════════════════════════════════════
# PASO 2: EXTRAER NOMBRE DE PROYECTO Y AUTORES DEL NOMBRE DE ARCHIVO
# ═══════════════════════════════════════════════════════════════
def extract_project(fname):
    m = re.search(r'MBA_F[SD]S?_(.+?)(?:\.\w+)+$', fname, re.IGNORECASE)
    if m:
        raw = m.group(1).strip()
        # Aplicar correcciones de nombre
        corrected = NAME_CORRECTIONS.get(normalize(raw))
        return corrected if corrected else raw
    return None

def extract_authors(fname):
    m = re.match(r'^(.+?)(?:_RESUMEN|_ONE PAGER|_BUSINESS|_logo|_Logo)', fname, re.IGNORECASE)
    if not m:
        return []
    raw = m.group(1)
    parts = raw.split('-')
    authors = []
    seen_norm = set()
    for part in parts:
        a = part.strip().replace('_', ' ')
        a = re.sub(r'\s+', ' ', a).strip()
        n = normalize(a)
        if n and n not in seen_norm:
            seen_norm.add(n)
            authors.append(a)
    return authors

# ═══════════════════════════════════════════════════════════════
# PASO 3: ESCANEAR CARPETAS Y CONSTRUIR MAPA DE PROYECTOS
# ═══════════════════════════════════════════════════════════════
def scan_projects():
    projects = {}
    norm_to_key = {}

    def add(proj_name, key_type, fname, authors=None):
        nonlocal projects, norm_to_key
        n = normalize(proj_name)
        if n not in norm_to_key:
            norm_to_key[n] = proj_name
            projects[proj_name] = {'logo': None, 'bp': None, 'resumen': None,
                                   'authors': [], 'name': proj_name}
        key = norm_to_key[n]
        projects[key][key_type] = fname
        if authors and not projects[key]['authors']:
            projects[key]['authors'] = authors

    # Logos
    for f in sorted(os.listdir(LOGO_DIR)):
        if f.startswith('.'): continue
        proj = extract_project(f)
        if proj:
            add(proj, 'logo', f, extract_authors(f))

    # Business Plans
    for f in sorted(os.listdir(BP_DIR)):
        if f.startswith('.') or not f.lower().endswith('.pdf'): continue
        proj = extract_project(f)
        if proj:
            add(proj, 'bp', f, extract_authors(f))

    # Resúmenes
    for f in sorted(os.listdir(RESUMEN_DIR)):
        if f.startswith('.'): continue
        proj = extract_project(f)
        if proj:
            add(proj, 'resumen', f, extract_authors(f))

    return projects

# ═══════════════════════════════════════════════════════════════
# PASO 4: LEER TEXTO DE PDFs
# ═══════════════════════════════════════════════════════════════
def read_pdf_text(folder, fname, max_chars=800):
    if not fname: return ""
    fpath = folder / fname
    if not fpath.exists(): return ""
    if not fname.lower().endswith('.pdf'): return ""
    try:
        with pdfplumber.open(str(fpath)) as pdf:
            text = ""
            for page in pdf.pages[:4]:
                t = page.extract_text()
                if t: text += t + " "
            return text[:max_chars].replace('\n', ' ').strip()
    except:
        return ""

# ═══════════════════════════════════════════════════════════════
# PASO 5: RESÚMENES Y POSTS LINKEDIN (generados desde PDFs)
# ═══════════════════════════════════════════════════════════════
HT = "#SoyINALDE #NavesINALDE #ExecutiveMBA #Líder #INALDE #Liderazgo #MBA #EMBA #NAVES"

SUMMARIES_DATA = [
  {"proyecto":"AKOS","resumen":"FinTech colombiana que financia medicamentos y procedimientos urgentes no cubiertos por salud. Aprobación en menos de 5 minutos, desembolso directo al proveedor médico.","linkedin":f"Héctor Rodrigo Arias Cueca y Cesar Julián Pérez Garavito presentaron AKOS, solución de financiamiento para servicios médicos urgentes con aprobación en menos de 5 minutos. La financiación de la salud nunca había sido tan accesible ni tan humana. {HT}"},
  {"proyecto":"AMIGO","resumen":"Plataforma de agentes con IA que ejecuta gestiones reales por WhatsApp en Colombia y México. Automatiza lo rutinario para que las personas dediquen su tiempo a lo que importa.","linkedin":f"Andres Camilo Martinez Socota presentó AMIGO, plataforma de agentes con IA que ejecuta tareas reales vía WhatsApp en Colombia y México. El asistente inteligente que Colombia estaba esperando para hacer más con menos. {HT}"},
  {"proyecto":"ARCO","resumen":"Ecosistema comercial con IA para pymes B2B colombianas. Agente de voz que cubre el ciclo completo de ventas: prospección, seguimiento y recaudo, sin digitar.","linkedin":f"Laura Mariño Arévalo, Julián Camilo Jiménez Moreno y Jhon Alexander Alarcón Hernández presentaron ARCO, ecosistema con IA que cubre el ciclo completo de ventas B2B para pymes colombianas. Así se construye el nuevo estándar comercial en LATAM. {HT}"},
  {"proyecto":"Avia Style","resumen":"Dota viviendas turísticas listas para rentar en Colombia: amobladas, equipadas y preparadas para el huésped sin gran inversión inicial del propietario.","linkedin":f"Elkin Ricardo Ostos Salcedo presentó Avia Style, empresa que entrega viviendas turísticas listas para rentar en Colombia sin gran inversión inicial. El turismo residencial colombiano tiene un nuevo referente. {HT}"},
  {"proyecto":"Bevo","resumen":"Plataforma de bienestar corporativo donde la empresa asigna saldo, el colaborador elige experiencias y la plataforma mide uso, adopción y ROI.","linkedin":f"Silvio Andrés Terán Calvache, Angela María Serna Castrillón y Camila Andrea Tarazona Moreno presentaron Bevo, ecosistema que convierte la inversión en bienestar en una herramienta medible de retención y productividad. Bienestar corporativo que se elige, se mide y se siente. {HT}"},
  {"proyecto":"Bio Value","resumen":"Empresa de ingredientes funcionales de alto valor nutricional para la industria alimentaria colombiana, desarrollados desde biodiversidad local.","linkedin":f"Maria Wills Salas, Luis Alberto Gonzalez Miguel y Juan Sebastian Uribe Barcha presentaron Bio Value, empresa de ingredientes funcionales desarrollados desde la biodiversidad colombiana para la industria alimentaria. Colombia tiene la selva; ellos tienen la fórmula para convertirla en valor. {HT}"},
  {"proyecto":"Broker LLM","resumen":"HyperGenIA orquesta automáticamente el modelo LLM óptimo entre más de 20 opciones por proceso empresarial. Reduce costos un 30% y garantiza logs auditables para sectores regulados.","linkedin":f"Edwin Muñoz Aristizabal presentó Broker LLM — HyperGenIA, plataforma que selecciona el mejor modelo de IA para cada proceso empresarial, reduciendo costos un 30%. La IA deja de ser una caja negra y se convierte en un activo gestionable. {HT}"},
  {"proyecto":"CDO Alianza","resumen":"Oficina corporativa de datos, analítica e IA para el Grupo Alianza. Modelo de intraemprendimiento que centraliza la inteligencia de negocio del conglomerado.","linkedin":f"Juan Francisco Almanza Cantor presentó CDO Alianza, modelo de intraemprendimiento que centraliza datos, analítica e inteligencia artificial en el Grupo Alianza. Cuando la estrategia y los datos hablan el mismo idioma, los resultados se transforman. {HT}"},
  {"proyecto":"Chargehub","resumen":"Hub de carga rápida DC para vehículos eléctricos en Bogotá integrado con cafetería de especialidad. Carga en 45 minutos con experiencia premium.","linkedin":f"Diana Marcela Bruges Prada y Andrés Felipe Solano Hernández presentaron Chargehub, el primer hub de carga rápida para vehículos eléctricos integrado con cafetería premium en Bogotá. Cargar tu vehículo eléctrico nunca había sido tan placentero. {HT}"},
  {"proyecto":"CLIC","resumen":"Centro Latinoamericano de Innovación Cuántica. Servicios de computación cuántica para empresas en América Latina que aceleran su capacidad de procesamiento.","linkedin":f"Germán Acosta presentó CLIC, Centro Latinoamericano de Innovación Cuántica que democratiza el acceso a computación cuántica para empresas en LATAM. Colombia da su primer gran paso hacia la era cuántica. {HT}"},
  {"proyecto":"FioYa","resumen":"Digitaliza el sistema de fiado en tiendas de barrio colombianas, conectando tenderos y clientes con fuentes de fondeo formal. Validado con 90% de intención de uso.","linkedin":f"Pablo Molina presentó FioYa, plataforma que digitaliza el fiado en tiendas de barrio colombianas con un 90% de validación positiva. El crédito informal de siempre, con la tecnología y la seguridad del futuro. {HT}"},
  {"proyecto":"Grey2Blue","resumen":"Sistema de reúso de aguas grises domiciliarias para hogares colombianos. Reduce el consumo de agua potable con tecnología accesible y sostenible.","linkedin":f"Andrea Lora y Juliana Munar presentaron Grey2Blue, solución de reúso de aguas grises para hogares colombianos. Cada gota de agua gris es una oportunidad de sostenibilidad que no podemos desperdiciar. {HT}"},
  {"proyecto":"HERITAGEBOX","resumen":"Plataforma editorial de colecciones premium de cultura y patrimonio. Convierte visitas culturales en objetos coleccionables museum-grade con relato curatorial.","linkedin":f"Patricio Javier Alvarado Strange presentó HERITAGEBOX, plataforma que transforma destinos patrimoniales en colecciones premium museum-grade para turistas culturales. El patrimonio latinoamericano finalmente tiene el envoltorio que merece. {HT}"},
  {"proyecto":"Jornalia","resumen":"Plataforma que resuelve la escasez de mano de obra agrícola en Colombia. Modelo B2B y B2C asset-light que dignifica al jornalero y elimina intermediarios.","linkedin":f"Jenny Forero y Silvana Morales presentaron Jornalia, plataforma que conecta jornaleros con productores agrícolas eliminando intermediarios en Colombia. El campo colombiano tiene solución, y nació en un aula del Executive MBA. {HT}"},
  {"proyecto":"KLAR","resumen":"WMS conversacional con IA para empresas medianas con alta rotación de personal. Reduce errores de picking y mermas sin necesitar capacitación extensa.","linkedin":f"Carlos Alberto Rodriguez Hernandez presentó KLAR, sistema de gestión de almacenes con IA conversacional para empresas con alta rotación de personal. Logística inteligente que habla el mismo idioma de quien la opera. {HT}"},
  {"proyecto":"La Etapa Café","resumen":"Cafetería de especialidad que fusiona cultura ciclista y café premium colombiano. Modelo experiencial para comunidades apasionadas por el deporte.","linkedin":f"Juan Sebastián López, John Segura Monroy y Claudia Estévez Prada presentaron La Etapa Café, cafetería de especialidad que fusiona cultura ciclista y café colombiano premium. Donde la pasión por el ciclismo y el mejor café del mundo se encuentran en una taza. {HT}"},
  {"proyecto":"Moovday","resumen":"Red de clubes wellness que ayuda a personas sedentarias a convertir la intención en hábito sostenible. Conecta cuerpo, mente y emociones con su metodología Emotional Energy Training™ y acompañamiento profesional integral.","linkedin":f"Julio César Riaño Rico y Germán Buitrago Gónzalez presentaron Moovday, red de clubes wellness que ayuda a personas sedentarias a transformar su estilo de vida conectando cuerpo, mente y emociones con su metodología Emotional Energy Training™. La emoción es el combustible; el movimiento, el vehículo del cambio. {HT}"},
  {"proyecto":"Mony","resumen":"Plataforma FinTech de servicios financieros digitales que simplifica el acceso al crédito y los pagos para el mercado colombiano.","linkedin":f"Sergio Andres Espinosa Silva y Javier Garcia Gutierrez presentaron Mony, plataforma de servicios financieros digitales para el mercado colombiano. Servicios financieros sin letra pequeña, al alcance de todos. {HT}"},
  {"proyecto":"New Car Now","resumen":"Plataforma digital que simplifica la compra y financiamiento de vehículos nuevos en Colombia, conectando compradores con concesionarios y entidades financieras.","linkedin":f"Santiago Romero Herrera presentó New Car Now, plataforma digital que simplifica la compra y financiamiento de vehículos nuevos conectando compradores, concesionarios y entidades financieras. Comprar vehículo nuevo nunca había sido tan sencillo y transparente. {HT}"},
  {"proyecto":"OVILAND","resumen":"Convierte el huevo no conforme en ovoproductos industriales B2B y snacks proteicos B2C. Captura un mercado colombiano sub-penetrado al 6,8% con crecimiento del 12% anual.","linkedin":f"Ginna Fernanda Romero Rincón presentó OVILAND, empresa que transforma el huevo no conforme en ovoproductos industriales y snacks proteicos de alto valor. Desperdicio cero, valor máximo: así se hace agroindustria responsable en Colombia. {HT}"},
  {"proyecto":"PLICS","resumen":"Plataforma de apoyo a la toma de decisiones complejas para empresas colombianas. De la necesidad a la mejor decisión con metodología estructurada.","linkedin":f"Laura Lerma, Andres Vasquez y Cristian Hernandez presentaron PLICS, plataforma que estructura y acompaña la toma de decisiones complejas en empresas colombianas. Porque las mejores decisiones no se improvisan: se construyen con método. {HT}"},
  {"proyecto":"Plug&GoEV","resumen":"Soluciones integrales de carga para vehículos eléctricos en Colombia. Infraestructura accesible, confiable y de fácil instalación para acelerar la electromovilidad.","linkedin":f"Ginna Lizeth Moncada Moreno, Ronald Jaimes Prada y Bibiana Carolina Baez Castro presentaron Plug&GoEV, empresa de soluciones integrales de carga para vehículos eléctricos en Colombia. Colombia se conecta a la electromovilidad, un punto de carga a la vez. {HT}"},
  {"proyecto":"Ready2","resumen":"Cócteles RTD premium listos para consumir, producidos en Colombia con ingredientes naturales. Captura el segmento de bebidas premium de conveniencia en LATAM.","linkedin":f"Mabel Adriana Herrera Bermúdez presentó Ready2, marca colombiana de cócteles premium listos para consumir con ingredientes naturales. El placer del cóctel premium, listo en el momento exacto que lo necesitas. {HT}"},
  {"proyecto":"SABE","resumen":"Emprendimiento gastronómico con identidad colombiana auténtica e impacto social. Combina sabor, propósito y conexión con comunidades productoras locales.","linkedin":f"Diana Mireya Martinez Gomez, Mayra Alexandra Puello Villarruel y Eliana Lozano Romero presentaron SABE, marca gastronómica con identidad colombiana auténtica e impacto social medible. La cocina colombiana con propósito social encuentra su plataforma. {HT}"},
  {"proyecto":"SATORI","resumen":"Plataforma de empleabilidad para talento senior 50+. Conecta experiencia con empresas mediante matching, validación y formación para proyectos y mentorías flexibles.","linkedin":f"Rina Miroshlawa Molina Vargas presentó SATORI, plataforma de empleabilidad que conecta talento senior 50+ con empresas que necesitan experiencia aplicada en proyectos y mentorías flexibles. La experiencia de los 50+ no caduca: SATORI la pone a trabajar. {HT}"},
  {"proyecto":"Segunda Mesa","resumen":"Plataforma que ayuda a fabricantes de alimentos a monetizar inventario próximo a vencerse, reduciendo la merma y conectando productos a precio justo con consumidores.","linkedin":f"Katia Ogaza y Camila Alvarez presentaron Segunda Mesa, plataforma que conecta fabricantes de alimentos con consumidores para monetizar inventario próximo a vencerse. Menos merma, más valor: la economía circular llega a la cadena alimentaria. {HT}"},
  {"proyecto":"T-HEALTH","resumen":"Solución de salud digital corporativa para empresas en Colombia. Monitoreo preventivo y gestión integral de la salud de los colaboradores.","linkedin":f"Carlos Enrique Manquillo y Luis Geovanni Florez Diaz presentaron T-HEALTH, solución de salud digital corporativa para empresas colombianas. Cuando la salud de los colaboradores se gestiona con datos, todos en la organización ganan. {HT}"},
  {"proyecto":"TRADECOM ECUADOR","resumen":"Distribuidor especializado de insumos, repuestos y consumibles para la industria del cartón corrugado en Ecuador. Filial de Tradecom Colombia desde 2027.","linkedin":f"Mateo Camilo de Wasseige Duperly presentó TRADECOM ECUADOR, distribuidora especializada de insumos para la industria del cartón corrugado en Ecuador, filial de Tradecom Colombia. Colombia exporta conocimiento comercial y construye presencia en LATAM. {HT}"},
  {"proyecto":"VecinoPro","resumen":"Asistente IA conversacional para tiendas de barrio colombianas. Controla inventario, mejora las compras y vende con POS simple, generando más rentabilidad al tendero.","linkedin":f"Oriana Rocio Cendales Reyes presentó VecinoPro, asistente de IA conversacional para tiendas de barrio colombianas que mejora el control de inventario, las compras y las ventas. La tienda de barrio se digitaliza sin perder su esencia ni su alma. {HT}"},
  {"proyecto":"Verifika","resumen":"Plataforma SaaS que valida pagos digitales sin exponer información del negocio. Protege a micronegocios del fraude con comprobantes falsos de Nequi y otras plataformas.","linkedin":f"Andres Camilo Ramirez Rodriguez presentó Verifika, plataforma SaaS que valida pagos digitales de forma segura para micronegocios colombianos. Fraude cero, confianza máxima: exactamente lo que el comercio electrónico colombiano necesitaba. {HT}"},
  {"proyecto":"Viora","resumen":"Ayuda a adultos latinoamericanos con sobrepeso a lograr pérdida de peso sostenida con acompañamiento clínico continuo e inteligencia artificial.","linkedin":f"Alexandra Guarín, Juan José Ordoñez y Edwin Molano presentaron Viora, plataforma de salud digital que acompaña a adultos latinoamericanos con sobrepeso hacia una pérdida de peso sostenida con IA y seguimiento clínico. Porque perder peso de forma sostenida no debería depender de la suerte ni de la fuerza de voluntad. {HT}"},
  {"proyecto":"Zafiro","resumen":"Manufactura de conectores ensamblados MMC y jumpers de fibra óptica de alta precisión para mercados CALA y EE.UU. Solución colombiana de clase mundial.","linkedin":f"Gerardo Jimenez y Daniel Pabon presentaron Zafiro Fiber Solutions, fabricante colombiano de conectores de fibra óptica de alta precisión para mercados de CALA y Estados Unidos. Colombia manufactura conectividad de clase mundial: de aquí para el mundo. {HT}"},
  {"proyecto":"güdplant","resumen":"Exporta plantas tropicales desde Colombia a EE.UU. a un costo 1,72x menor que un grower en Florida. Certificación ICA-APHIS validada en campo.","linkedin":f"Luis Miguel Olarte, Oscar Daniel Lopez y Nicolas Trujillo presentaron güdplant, empresa que exporta plantas tropicales colombianas a Estados Unidos a un costo 1,72x menor que la competencia local. La selva tropical colombiana tiene mercado global, y ellos encontraron la ruta. {HT}"},
  {"proyecto":"sabIO","resumen":"Plataforma FinTech que conecta colaboradores con fondos de pensiones voluntarias (FPV) de manera simple y accesible. Bienestar financiero a largo plazo.","linkedin":f"Marcel Holguín y Andrés Cortés presentaron sabIO, plataforma que democratiza el acceso a fondos de pensiones voluntarias para colaboradores colombianos. El ahorro para el futuro empieza hoy, y sabIO hace que sea posible para todos. {HT}"},
  {"proyecto":"VERIMED","resumen":"Sistema de gestión predictiva del riesgo en salud para aseguradoras y EPS en Colombia. Anticipa eventos costosos y mejora la rentabilidad del portafolio.","linkedin":f"Zain Pena Zea, Carlos Daniel Rodriguez Calderon y Jeisson Fernando Lancheros Jimenez presentaron VERIMED, sistema de gestión predictiva del riesgo en salud para aseguradoras y EPS colombianas. La salud predictiva transforma el sistema: de reactivo a inteligente. {HT}"},
]

def generate_summaries_and_posts(projects_data):
    """Retorna los resúmenes y posts precargados (generados desde los PDFs)."""
    print("  Usando resúmenes generados desde los PDFs...")
    return SUMMARIES_DATA

# ═══════════════════════════════════════════════════════════════
# PASO 6: PREPARAR ARCHIVOS DE SALIDA
# ═══════════════════════════════════════════════════════════════
def prepare_output(projects):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "logos").mkdir(exist_ok=True)
    (OUTPUT_DIR / "pdfs").mkdir(exist_ok=True)

    for proj, data in projects.items():
        safe = re.sub(r'[^\w\-]', '_', proj)
        # Logo
        if data['logo']:
            src = LOGO_DIR / data['logo']
            ext = Path(data['logo']).suffix
            # Handle weird extensions like .pdf.jpeg
            if ext.lower() in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
                dst = OUTPUT_DIR / "logos" / f"{safe}{ext}"
                if src.exists():
                    shutil.copy2(str(src), str(dst))
                    data['logo_web'] = f"logos/{safe}{ext}"
            else:
                # Try to extract real ext
                real_ext = '.' + data['logo'].split('.')[-1]
                dst = OUTPUT_DIR / "logos" / f"{safe}{real_ext}"
                if src.exists():
                    shutil.copy2(str(src), str(dst))
                    data['logo_web'] = f"logos/{safe}{real_ext}"
        else:
            data['logo_web'] = None

        # Resumen / One Pager — acepta PDF, PNG, JPG, JPEG
        RESUMEN_EXTS = ['.pdf', '.png', '.jpg', '.jpeg']
        if data['resumen']:
            res_ext = Path(data['resumen']).suffix.lower()
            if res_ext in RESUMEN_EXTS:
                src = RESUMEN_DIR / data['resumen']
                dst = OUTPUT_DIR / "pdfs" / f"{safe}_resumen{res_ext}"
                if src.exists():
                    shutil.copy2(str(src), str(dst))
                data['resumen_web'] = f"pdfs/{safe}_resumen{res_ext}"
            else:
                data['resumen_web'] = None
        else:
            data['resumen_web'] = None

        # Business Plan PDF
        if data['bp']:
            src = BP_DIR / data['bp']
            dst = OUTPUT_DIR / "pdfs" / f"{safe}_bp.pdf"
            if src.exists():
                shutil.copy2(str(src), str(dst))
            data['bp_web'] = f"pdfs/{safe}_bp.pdf"
        else:
            data['bp_web'] = None

# ═══════════════════════════════════════════════════════════════
# PASO 7: GENERAR HTML
# ═══════════════════════════════════════════════════════════════
def generate_html(projects, summaries_data):
    # Crear mapa de resúmenes
    summary_map = {}
    for item in summaries_data:
        key = normalize(item.get('proyecto', ''))
        summary_map[key] = item

    # Ordenar proyectos por sector y luego por nombre
    sorted_projects = sorted(
        projects.items(),
        key=lambda x: (SECTORES.get(x[0], 'ZZZ'), x[0])
    )

    # Construir filas de la tabla
    rows_html = ""
    current_sector = None
    for proj, data in sorted_projects:
        sector = SECTORES.get(proj, "Otro")
        sector_color = SECTOR_COLORS.get(sector, "#333")

        # Encabezado de sector si cambia
        if sector != current_sector:
            current_sector = sector
            rows_html += f"""
        <tr class="sector-header">
          <td colspan="7" style="background:{sector_color};color:#fff;padding:0.6rem 1.2rem;font-family:'Montserrat',sans-serif;font-size:0.78rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">{sector}</td>
        </tr>"""

        # Authors
        authors_str = ", ".join(data['authors']) if data['authors'] else "—"

        # Summary & LinkedIn
        skey = normalize(proj)
        sdata = summary_map.get(skey, {})
        resumen_text = sdata.get('resumen', '').strip() or f"Proyecto {proj} — MBA FS INALDE 2026."
        linkedin_text = sdata.get('linkedin', '').strip() or f"{authors_str} presentaron {proj}. #NAVES2026 #INALDE"

        # Escape for HTML
        resumen_esc = resumen_text.replace('"', '&quot;').replace('<', '&lt;').replace('>', '&gt;')
        linkedin_esc = linkedin_text.replace('"', '&quot;').replace('<', '&lt;').replace('&', '&amp;')

        # Logo thumbnail
        if data.get('logo_web'):
            logo_cell = f'<img src="{data["logo_web"]}" alt="{proj}" class="logo-thumb">'
        else:
            logo_cell = f'<div class="logo-placeholder">{proj[:2]}</div>'

        # Download buttons — confidencial o normal
        if proj in CONFIDENCIALES:
            downloads = '<span class="btn-confidencial">🔒 Confidencial</span>'
            logo_cell = f'<div class="logo-placeholder conf">{proj[:2]}</div>'
        else:
            downloads = ""
            if data.get('logo_web'):
                downloads += f'<a href="{data["logo_web"]}" download class="btn-dl btn-logo">⬇ Logo</a>'
            if data.get('resumen_web'):
                downloads += f'<a href="{data["resumen_web"]}" download class="btn-dl btn-res">⬇ One Pager</a>'

        # data attributes para Excel export
        logo_url   = data.get('logo_web', '')
        resumen_url= data.get('resumen_web', '')

        # Link al One Pager dentro de la celda de resumen
        if resumen_url and proj not in CONFIDENCIALES:
            op_link = f'<a href="{resumen_url}" target="_blank" class="op-link">Ver One Pager →</a>'
        else:
            op_link = ''

        rows_html += f"""
        <tr data-proj="{proj}" data-authors="{authors_str}" data-sector="{sector}"
            data-resumen="{resumen_esc}" data-linkedin="{linkedin_esc}"
            data-logo="{logo_url}" data-resumen-url="{resumen_url}">
          <td class="col-logo">{logo_cell}</td>
          <td class="col-proyecto"><strong>{proj}</strong></td>
          <td class="col-autores">{authors_str}</td>
          <td class="col-sector"><span class="sector-badge" style="background:{sector_color}">{sector}</span></td>
          <td class="col-resumen">{resumen_esc}{op_link}</td>
          <td class="col-linkedin">
            <div class="linkedin-text">{linkedin_esc}</div>
            <button class="btn-copy" onclick="copyText(this, '{linkedin_esc.replace("'", "\\'")}')">Copiar</button>
          </td>
          <td class="col-downloads">{downloads}</td>
        </tr>"""

    # Contar entregas completas
    total = len(projects)
    completos = sum(1 for d in projects.values() if d.get('logo') and d.get('bp') and d.get('resumen'))

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAVES 2026 | Proyectos Executive MBA FS | INALDE Business School</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700;800;900&family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {{
      --red:    #e30613;
      --blue:   #224d7c;
      --black:  #0a0a0a;
      --text:   #1a1a1a;
      --gray:   #6b6b6b;
      --light:  #f5f5f5;
      --border: #e0e0e0;
      --white:  #ffffff;
    }}
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{ font-family:'Roboto',sans-serif; background:var(--light); color:var(--text); }}

    /* ─── ACCESS GATE ─── */
    #gate {{
      position:fixed; inset:0;
      background:linear-gradient(135deg,#0a0a0a 0%,#1a1a1a 60%,#2a1010 100%);
      z-index:9999; display:flex; align-items:center; justify-content:center;
    }}
    #gate::after {{ content:''; position:absolute; left:0; top:0; width:4px; height:100%; background:var(--red); }}
    .gate-box {{
      position:relative; z-index:2;
      background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1);
      max-width:420px; width:100%; padding:3rem 2.5rem; text-align:center;
    }}
    .gate-title {{ font-family:'Montserrat',sans-serif; font-size:2rem; font-weight:900; color:#fff; margin-bottom:0.3rem; }}
    .gate-title span {{ color:var(--red); }}
    .gate-sub {{ font-size:0.9rem; color:rgba(255,255,255,0.6); margin-bottom:2rem; }}
    .gate-input {{
      width:100%; padding:0.9rem 1rem; margin-bottom:1rem;
      background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.2);
      color:#fff; font-size:1rem; text-align:center; letter-spacing:0.1em;
    }}
    .gate-input:focus {{ outline:none; border-color:var(--red); }}
    .gate-btn {{
      width:100%; padding:0.9rem;
      background:var(--red); color:#fff; border:none;
      font-family:'Montserrat',sans-serif; font-size:0.85rem; font-weight:700;
      letter-spacing:0.12em; text-transform:uppercase; cursor:pointer; border-radius:30px;
    }}
    .gate-btn:hover {{ background:#fff; color:var(--red); }}
    .gate-err {{ color:#ff6b6b; font-size:0.85rem; margin-top:0.8rem; min-height:20px; }}
    body.locked > *:not(#gate) {{ display:none!important; }}

    /* ─── HEADER ─── */
    header {{
      background:var(--white); border-bottom:1px solid var(--border);
      position:sticky; top:0; z-index:100;
      box-shadow:0 2px 8px rgba(0,0,0,0.06);
    }}
    .header-top {{ background:var(--black); padding:0.4rem 2rem; text-align:right; }}
    .header-top span {{ color:rgba(255,255,255,0.7); font-family:'Montserrat',sans-serif; font-size:0.72rem; font-weight:500; letter-spacing:0.12em; text-transform:uppercase; }}
    .header-main {{
      padding:0.8rem 2rem; display:flex; justify-content:space-between;
      align-items:center; max-width:1600px; margin:0 auto;
    }}
    .logo-area {{ display:flex; align-items:center; gap:1.2rem; }}
    .logo-inalde {{ height:48px; width:auto; }}
    .sep {{ width:1px; height:40px; background:var(--border); }}
    .prog-label {{ font-family:'Montserrat',sans-serif; font-size:0.65rem; font-weight:600; color:var(--gray); letter-spacing:0.15em; text-transform:uppercase; }}
    .prog-name {{ font-family:'Montserrat',sans-serif; font-size:1.2rem; font-weight:900; color:var(--text); letter-spacing:0.02em; }}
    .prog-name span {{ color:var(--red); }}

    /* ─── HERO ─── */
    .hero {{
      background:linear-gradient(135deg,#0a0a0a 0%,#1a1a1a 60%,#2a1010 100%);
      padding:3rem 2rem 2.5rem; position:relative; overflow:hidden;
    }}
    .hero::after {{ content:''; position:absolute; left:0; top:0; width:4px; height:100%; background:var(--red); }}
    .hero-inner {{ max-width:1600px; margin:0 auto; padding-left:1rem; }}
    .hero-badge {{
      display:inline-block; background:var(--red); color:#fff;
      padding:0.4rem 1.2rem; font-family:'Montserrat',sans-serif;
      font-size:0.72rem; font-weight:700; letter-spacing:0.18em;
      text-transform:uppercase; margin-bottom:1rem; border-radius:3px;
    }}
    .hero h1 {{ font-family:'Montserrat',sans-serif; font-size:2.5rem; font-weight:900; color:#fff; margin-bottom:0.5rem; }}
    .hero h1 span {{ color:var(--red); }}
    .hero-sub {{ color:rgba(255,255,255,0.7); font-size:1rem; margin-bottom:1.5rem; }}
    .stats {{ display:flex; gap:2rem; flex-wrap:wrap; }}
    .stat {{ text-align:center; }}
    .stat-num {{ font-family:'Montserrat',sans-serif; font-size:2.2rem; font-weight:900; color:var(--red); line-height:1; }}
    .stat-label {{ font-size:0.75rem; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.1em; margin-top:0.2rem; }}

    /* ─── CONTROLES ─── */
    .controls {{
      background:var(--white); border-bottom:1px solid var(--border);
      padding:1rem 2rem; position:sticky; top:73px; z-index:99;
    }}
    .controls-inner {{ max-width:1600px; margin:0 auto; display:flex; gap:1rem; flex-wrap:wrap; align-items:center; }}
    .search-wrap {{ flex:1; min-width:200px; position:relative; }}
    .search-wrap input {{
      width:100%; padding:0.6rem 1rem 0.6rem 2.4rem;
      border:1px solid var(--border); border-bottom:2px solid var(--text);
      font-family:'Roboto',sans-serif; font-size:0.9rem; background:var(--light);
    }}
    .search-wrap input:focus {{ outline:none; border-bottom-color:var(--red); background:#fff; }}
    .search-icon {{ position:absolute; left:0.7rem; top:50%; transform:translateY(-50%); color:var(--gray); font-size:1rem; }}
    .filter-group {{ display:flex; gap:0.5rem; flex-wrap:wrap; }}
    .filter-btn {{
      padding:0.45rem 0.9rem; border:1px solid var(--border); background:#fff;
      font-family:'Montserrat',sans-serif; font-size:0.72rem; font-weight:600;
      letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
      transition:all 0.2s; border-radius:3px;
    }}
    .filter-btn:hover, .filter-btn.active {{ background:var(--red); color:#fff; border-color:var(--red); }}
    .count-label {{ font-size:0.8rem; color:var(--gray); margin-left:auto; white-space:nowrap; }}

    /* ─── TABLE ─── */
    .table-wrap {{ max-width:1600px; margin:1.5rem auto; padding:0 1.5rem 3rem; overflow-x:auto; }}
    table {{ width:100%; border-collapse:collapse; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.08); }}
    thead th {{
      background:var(--text); color:#fff;
      padding:0.75rem 0.8rem; text-align:left;
      font-family:'Montserrat',sans-serif; font-size:0.7rem;
      font-weight:700; letter-spacing:0.1em; text-transform:uppercase;
      white-space:nowrap;
    }}
    tbody tr {{ border-bottom:1px solid var(--border); transition:background 0.15s; }}
    tbody tr:hover {{ background:#fafafa; }}
    tbody td {{ padding:0.7rem 0.8rem; vertical-align:middle; font-size:0.88rem; }}
    .sector-header td {{ border-top:3px solid transparent; }}

    /* Columnas */
    .col-logo    {{ width:80px; text-align:center; }}
    .col-proyecto{{ width:130px; font-family:'Montserrat',sans-serif; font-size:0.88rem; font-weight:700; }}
    .col-autores {{ width:200px; font-size:0.8rem; color:var(--gray); }}
    .col-sector  {{ width:140px; }}
    .col-resumen {{ width:260px; font-size:0.82rem; line-height:1.5; }}
    .col-linkedin{{ width:280px; }}
    .col-downloads{{ width:150px; }}

    .logo-thumb {{ max-width:60px; max-height:50px; object-fit:contain; border:1px solid var(--border); padding:2px; }}
    .logo-placeholder {{
      width:56px; height:44px; background:var(--light); border:1px solid var(--border);
      display:flex; align-items:center; justify-content:center;
      font-family:'Montserrat',sans-serif; font-weight:800; font-size:0.85rem;
      color:var(--gray); margin:0 auto;
    }}

    .sector-badge {{
      display:inline-block; color:#fff; padding:0.2rem 0.55rem;
      font-family:'Montserrat',sans-serif; font-size:0.65rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; border-radius:3px;
      white-space:nowrap;
    }}

    .linkedin-text {{
      font-size:0.78rem; line-height:1.5; color:var(--text);
      margin-bottom:0.4rem;
    }}
    .btn-copy {{
      font-family:'Montserrat',sans-serif; font-size:0.65rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase;
      background:none; border:1px solid var(--border); padding:0.25rem 0.6rem;
      cursor:pointer; color:var(--gray); transition:all 0.2s;
    }}
    .btn-copy:hover {{ background:var(--text); color:#fff; border-color:var(--text); }}
    .btn-copy.copied {{ background:#1a6b3c; color:#fff; border-color:#1a6b3c; }}

    .btn-dl {{
      display:inline-block; padding:0.3rem 0.55rem; margin:0.15rem 0.1rem;
      font-family:'Montserrat',sans-serif; font-size:0.65rem; font-weight:700;
      letter-spacing:0.04em; text-decoration:none; border-radius:3px;
      transition:all 0.2s; white-space:nowrap;
    }}
    .btn-logo {{ background:#f0f4f8; color:#224d7c; border:1px solid #224d7c; }}
    .btn-logo:hover {{ background:#224d7c; color:#fff; }}
    .btn-res  {{ background:#fff5f5; color:var(--red); border:1px solid var(--red); }}
    .btn-res:hover {{ background:var(--red); color:#fff; }}
    .op-link {{
      display:block; margin-top:0.5rem;
      font-family:'Montserrat',sans-serif; font-size:0.68rem; font-weight:700;
      color:var(--red); text-decoration:none; letter-spacing:0.04em;
    }}
    .op-link:hover {{ text-decoration:underline; }}
    .btn-confidencial {{
      display:inline-block; padding:0.35rem 0.7rem;
      background:#2a2a2a; color:#aaa; border:1px solid #555;
      font-family:'Montserrat',sans-serif; font-size:0.65rem; font-weight:700;
      letter-spacing:0.06em; text-transform:uppercase; border-radius:3px;
      cursor:default; white-space:nowrap;
    }}
    .logo-placeholder.conf {{ background:#1a1a1a; color:#555; }}
    .btn-excel {{
      display:inline-flex; align-items:center; gap:0.4rem;
      padding:0.5rem 1.2rem; background:#1a6b3c; color:#fff;
      border:none; font-family:'Montserrat',sans-serif; font-size:0.72rem;
      font-weight:700; letter-spacing:0.08em; text-transform:uppercase;
      cursor:pointer; border-radius:3px; transition:all 0.2s; white-space:nowrap;
    }}
    .btn-excel:hover {{ background:#145530; }}

    /* ─── FOOTER ─── */
    footer {{
      background:var(--black); color:rgba(255,255,255,0.5);
      text-align:center; padding:2rem; font-family:'Montserrat',sans-serif;
      font-size:0.75rem; letter-spacing:0.05em;
    }}
    footer a {{ color:var(--red); text-decoration:none; }}

    /* ─── RESPONSIVE ─── */
    @media(max-width:768px) {{
      .hero h1 {{ font-size:1.8rem; }}
      .controls-inner {{ flex-direction:column; align-items:stretch; }}
      .table-wrap {{ padding:0 0.5rem 2rem; }}
    }}
  </style>
</head>
<body>

<!-- HEADER -->
<header>
  <div class="header-top">
    <span>Executive MBA FS · Cohorte 2024 – 2026</span>
  </div>
  <div class="header-main">
    <div class="logo-area">
      <div class="sep"></div>
      <div>
        <div class="prog-label">Trabajo de grado</div>
        <div class="prog-name">N<span>A</span>VES <span>2026</span></div>
      </div>
    </div>
    <div style="font-family:Montserrat,sans-serif;font-size:0.72rem;font-weight:600;color:var(--gray);letter-spacing:0.08em;text-transform:uppercase;">
      Base de datos de proyectos
    </div>
  </div>
</header>

<!-- HERO -->
<div class="hero">
  <div class="hero-inner">
    <div class="hero-badge">Executive MBA FS</div>
    <h1>Proyectos <span>NAVES</span> 2026</h1>
    <p class="hero-sub">Base de datos de los proyectos del Executive MBA FS 24-26</p>
    <div class="stats">
      <div class="stat">
        <div class="stat-num" id="stat-total">{total}</div>
        <div class="stat-label">Proyectos</div>
      </div>
      <div class="stat">
        <div class="stat-num" id="stat-completos">{completos}</div>
        <div class="stat-label">Entregas completas</div>
      </div>
      <div class="stat">
        <div class="stat-num">35</div>
        <div class="stat-label">Meta total</div>
      </div>
      <div class="stat">
        <div class="stat-num">{len(SECTOR_COLORS)}</div>
        <div class="stat-label">Sectores</div>
      </div>
    </div>
  </div>
</div>

<!-- CONTROLES -->
<div class="controls">
  <div class="controls-inner">
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input type="text" id="search-input" placeholder="Buscar por proyecto, autor o sector..." oninput="filterTable()">
    </div>
    <div class="filter-group" id="sector-filters">
      <button class="filter-btn active" data-sector="all" onclick="setSector('all',this)">Todos</button>
    </div>
    <span class="count-label" id="count-label">Mostrando {total} proyectos</span>
    <button class="btn-excel" onclick="downloadExcel()">⬇ Descargar Excel</button>
  </div>
</div>

<!-- TABLA -->
<div class="table-wrap">
  <table id="main-table">
    <thead>
      <tr>
        <th>Logo</th>
        <th>Proyecto</th>
        <th>Autores</th>
        <th>Sector</th>
        <th>One Pager</th>
        <th>Post LinkedIn</th>
        <th>Descargas</th>
      </tr>
    </thead>
    <tbody id="table-body">
{rows_html}
    </tbody>
  </table>
</div>

<!-- FOOTER -->
<footer>
  <p>&copy; 2026 <a href="https://www.inalde.edu.co" target="_blank">INALDE Business School</a> — Universidad de La Sabana</p>
  <p style="margin-top:0.4rem;">NAVES — Nuevas Aventuras Empresariales · Executive MBA FS 2024–2026</p>
</footer>

<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
<script>
  // ─── FILTROS ───
  let activeSector = 'all';

  function buildSectorFilters() {{
    const sectors = new Set();
    document.querySelectorAll('#table-body td.col-sector span').forEach(s => sectors.add(s.textContent.trim()));
    const container = document.getElementById('sector-filters');
    while (container.children.length > 1) container.removeChild(container.lastChild);
    [...sectors].sort().forEach(s => {{
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.sector = s;
      btn.textContent = s;
      btn.onclick = () => setSector(s, btn);
      container.appendChild(btn);
    }});
  }}

  function setSector(sector, btn) {{
    activeSector = sector;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterTable();
  }}

  function filterTable() {{
    const q = document.getElementById('search-input').value.toLowerCase();
    let visible = 0;
    document.querySelectorAll('#table-body tr:not(.sector-header)').forEach(row => {{
      const text = row.textContent.toLowerCase();
      const sector = (row.querySelector('.sector-badge') || {{}}).textContent || '';
      const show = (!q || text.includes(q)) && (activeSector === 'all' || sector.includes(activeSector));
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    }});
    document.querySelectorAll('.sector-header').forEach(sh => {{
      let next = sh.nextElementSibling, hasVisible = false;
      while (next && !next.classList.contains('sector-header')) {{
        if (next.style.display !== 'none') hasVisible = true;
        next = next.nextElementSibling;
      }}
      sh.style.display = hasVisible ? '' : 'none';
    }});
    document.getElementById('count-label').textContent = `Mostrando ${{visible}} proyecto${{visible !== 1 ? 's' : ''}}`;
  }}

  // ─── COPIAR LINKEDIN ───
  function copyText(btn, text) {{
    navigator.clipboard.writeText(
      text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    ).then(() => {{
      btn.textContent = '✓ Copiado';
      btn.classList.add('copied');
      setTimeout(() => {{ btn.textContent = 'Copiar'; btn.classList.remove('copied'); }}, 2000);
    }});
  }}

  // ─── DESCARGAR EXCEL ───
  function downloadExcel() {{
    const wb = XLSX.utils.book_new();
    const wsData = [['Proyecto','Autores','Sector','One Pager','Post LinkedIn','Logo']];
    const dataRows = document.querySelectorAll('#table-body tr[data-proj]');
    const base = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');

    dataRows.forEach(row => {{
      wsData.push([
        row.dataset.proj,
        row.dataset.authors,
        row.dataset.sector,
        row.dataset.resumen,
        row.dataset.linkedin.replace(/&amp;/g,'&').replace(/&quot;/g,'"'),
        row.dataset.logo ? base + row.dataset.logo : ''
      ]);
    }});

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{{wch:20}},{{wch:40}},{{wch:22}},{{wch:62}},{{wch:95}},{{wch:55}}];

    let rowIdx = 0;
    dataRows.forEach(row => {{
      const excelRow = rowIdx + 2;
      const resUrl  = row.dataset.resumenUrl ? base + row.dataset.resumenUrl : '';
      const logoUrl = row.dataset.logo       ? base + row.dataset.logo       : '';
      const addrD = 'D' + excelRow;
      if (ws[addrD] && resUrl) {{
        ws[addrD] = {{ v: ws[addrD].v, t: 's', l: {{ Target: resUrl, Tooltip: 'Ver One Pager' }} }};
      }}
      const addrF = 'F' + excelRow;
      if (ws[addrF] && logoUrl) {{
        ws[addrF] = {{ v: logoUrl, t: 's', l: {{ Target: logoUrl, Tooltip: 'Ver Logo' }} }};
      }}
      rowIdx++;
    }});

    XLSX.utils.book_append_sheet(wb, ws, 'Proyectos NAVES 2026');
    XLSX.writeFile(wb, 'NAVES_2026_Proyectos.xlsx');
  }}

  // ─── INIT ───
  buildSectorFilters();
</script>
</body>
</html>"""
    return html

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════
def main():
    print("\n🚀 NAVES 2026 — Generador HTML")
    print("=" * 50)

    print("\n📁 Paso 1: Escaneando carpetas...")
    projects = scan_projects()
    print(f"   → {len(projects)} proyectos encontrados")

    print("\n📄 Paso 2: Preparando archivos de salida...")
    prepare_output(projects)
    print(f"   → Archivos copiados a {OUTPUT_DIR}")

    print("\n🤖 Paso 3: Generando resúmenes con Claude API...")
    summaries = generate_summaries_and_posts(projects)
    print(f"   → {len(summaries)} resúmenes generados")

    print("\n🌐 Paso 4: Generando HTML...")
    html = generate_html(projects, summaries)

    out_file = OUTPUT_DIR / "index.html"
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"   → HTML guardado en: {out_file}")

    # Resumen de estado
    print("\n📊 Estado de entregas:")
    for proj, data in sorted(projects.items()):
        logo = '✓' if data.get('logo') else '✗'
        bp   = '✓' if data.get('bp') else '✗'
        res  = '✓' if data.get('resumen') else '✗'
        print(f"   [{logo}{bp}{res}] {proj}")

    completos = sum(1 for d in projects.values() if d.get('logo') and d.get('bp') and d.get('resumen'))
    print(f"\n✅ {completos}/{len(projects)} proyectos completos (de 45 esperados)")
    print(f"\n🎉 Listo. Abra: {OUTPUT_DIR}/index.html")

if __name__ == "__main__":
    main()
