// Traducción de errores del backend NAVES a mensajes legibles para el usuario.
// Cubre tanto los errores de aplicación (`{ error: "CODE" }`) como los de validación Zod
// (`{ error: "INVALID", details: [...] }`).

export function formatBackendError(e: any): string {
  const status: number | undefined = e?.response?.status ?? e?.status;
  const data = e?.response?.data;

  // Errores comunes por status HTTP (sin payload útil del backend)
  if (status === 429) {
    return 'Demasiados intentos en poco tiempo. Espera unos segundos antes de volver a intentar.';
  }
  if (status === 401 && !data?.error) {
    return 'Sesión expirada o credenciales inválidas. Vuelve a iniciar sesión.';
  }
  if (status === 403 && !data?.error) {
    return 'No tienes permiso para realizar esta acción.';
  }
  if (status === 404 && !data?.error) {
    return 'No encontramos el recurso solicitado. Verifica e inténtalo de nuevo.';
  }
  if (status === 413) {
    return 'El archivo supera el tamaño máximo permitido.';
  }
  if (status && status >= 500) {
    return 'Tuvimos un problema del lado del servidor. Inténtalo en unos minutos. Si persiste, contacta a la asistente del programa.';
  }
  if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') {
    return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  }

  const codeMessages: Record<string, string> = {
    NO_PROYECTOS: 'Debes crear al menos un proyecto antes de enviar.',
    HITOS_INSUFICIENTES: 'Cada proyecto necesita al menos 5 hitos con descripción y fechas.',
    MISSING_COHORTE: 'Selecciona una cohorte antes de cargar el archivo.',
    MISSING_FILE: 'Selecciona el archivo Excel a cargar.',
    EMPTY_WORKBOOK: 'El archivo Excel está vacío o no tiene hojas.',
    COHORTE_NOT_FOUND: 'La cohorte seleccionada no existe.',
    PARTICIPANTE_EN_EQUIPO: 'No se puede borrar: el participante ya pertenece a un equipo o es creador de uno. Quítalo del equipo primero.',
    CEDULA_DUPLICADA: 'Esa cédula ya pertenece a otro participante de la misma cohorte.',
    COHORTE_TIENE_DATOS: 'No se puede borrar: la cohorte tiene participantes o equipos. Bórralos primero.',
    NOT_TEAM_MEMBER: 'No formas parte de este equipo.',
    ALREADY_SUBMITTED: 'Este anteproyecto ya fue enviado y no se puede modificar.',
    FECHA_LIMITE_EXPIRADA: 'La fecha límite para esta acción ya pasó.',
    ARCHIVOS_FALTANTES: 'Debes subir el anteproyecto y el proyecto final antes de enviar.',
    MODALIDAD_NO_USA_ARCHIVOS: 'Esta modalidad no usa archivos. Usa el formulario completo en lugar.',
    MODALIDAD_NO_DEFINIDA: 'Primero debes elegir tu modalidad de trabajo de grado en el Dashboard.',
    MODALIDAD_MISMATCH: 'El participante que intentas agregar tiene una modalidad distinta a la del equipo.',
    TARGET_SIN_MODALIDAD: 'El participante que intentas agregar todavía no eligió su modalidad.',
    ALREADY_IN_TEAM: 'Ese participante ya está en un equipo.',
    ALREADY_SET: 'Tu modalidad ya está fijada; no se puede cambiar.',
    INVALID_CIIU: 'Uno o varios códigos CIIU no son válidos.',
    INVALID_MIME: 'El tipo de archivo no es válido. El anteproyecto y el proyecto final se cargan en PDF.',
    FILE_TOO_LARGE: 'El archivo pesa más de lo permitido para esta carga. Comprímelo e inténtalo de nuevo.',
    POSITION_TAKEN: 'Esa posición ya está ocupada por otro miembro.',
    COHORTE_MISMATCH: 'El participante pertenece a otra cohorte.',
    PARTICIPANT_NOT_ACTIVE: 'Tu cuenta no está activa. Contacta al administrador.',
    NOT_AUTHENTICATED: 'Sesión expirada. Vuelve a iniciar sesión.',
    INVALID_TOKEN: 'Sesión inválida. Vuelve a iniciar sesión.',
    PERFIL_NO_COMPLETO: 'Debes completar tu perfil emprendedor antes de crear un equipo.',
    TARGET_PERFIL_NO_COMPLETO: 'El participante seleccionado todavía no completó su perfil emprendedor. Pídele que lo termine antes de agregarlo al equipo.',
    MIEMBRO_NO_ACTIVO: 'El participante seleccionado no está activo todavía. Avísale para que active su cuenta antes de agregarlo.',
    MIEMBRO_NOT_FOUND: 'El participante seleccionado no existe o fue eliminado.',
    MIEMBRO_YA_EN_EQUIPO: 'Uno de los participantes que seleccionaste ya pertenece a otro equipo.',
    TEAM_NOT_FOUND: 'No se encontró el equipo.',
    PARTICIPANT_NOT_FOUND: 'No se encontró al participante.',
    NO_FILE: 'No adjuntaste ningún archivo.',
    TIPO_INVALIDO: 'El tipo de archivo solicitado no es válido.',
    ANTEPROYECTO_YA_SUBIDO: 'El anteproyecto ya fue cargado y no se puede reemplazar.',
    PROYECTO_FINAL_YA_SUBIDO: 'El proyecto final ya fue cargado y no se puede reemplazar.',
    ESPERA_APROBACION_ANTEPROYECTO: 'El proyecto final estará disponible cuando se cumpla la fecha establecida en el cronograma.',
    DIRECTOR_NO_SELECCIONADO: 'Selecciona a la dirección antes de cargar el anteproyecto.',
    ARCHIVO_NO_SUBIDO: 'Aún no se ha cargado ese archivo.',
    TIPO_TRABAJO_GRADO_INMUTABLE: 'Tu modalidad ya está fijada y no se puede cambiar.',
    // --- Programación de presentaciones ---
    PROYECTO_NO_PROGRAMABLE: 'Ese proyecto no se puede programar: no es el proyecto definitivo de ningún equipo de la cohorte.',
    PROYECTO_DUPLICADO: 'Ese proyecto ya está en esta jornada.',
    PROYECTO_YA_PROGRAMADO: 'Ese proyecto ya está programado en otra jornada. Un proyecto se presenta una sola vez en todo el evento.',
    SLOTS_DELETE_FAILED: 'No pudimos reorganizar la jornada. Recarga la página y verifica el orden antes de continuar.',
    SLOTS_INSERT_FAILED: 'No pudimos guardar el orden de la jornada. Recarga la página: puede haber quedado sin horarios.',
    PROGRAMACION_PUBLICADA: 'La programación ya se publicó y es definitiva: no se puede modificar.',
    YA_PUBLICADA: 'Esta programación ya estaba publicada.',
    SIN_JORNADAS: 'Esta cohorte todavía no tiene jornadas. Créalas en Panelistas → Jornadas.',
    SIN_PROYECTOS_ASIGNADOS: 'No hay ningún proyecto asignado. Publicar ahora dejaría la programación vacía y definitiva.',
    JORNADAS_DERIVADAS: 'Las jornadas salen del cronograma de la cohorte (hitos 12 y 13). Cambia la fecha en Cohortes y se actualizará sola.',
    HORA_FIN_ANTES_DE_INICIO: 'La hora de fin de la jornada tiene que ser posterior a la de inicio.',
    ROL_AREA_NO_EXISTE: 'Falta el rol de área en la base de datos. Avisa al equipo técnico.',
    ROL_ASIGNACION_FALLIDA: 'Se creó la cuenta pero no se le pudo asignar el rol. Asígnaselo en Roles y permisos.',

    // ── Acceso y sesión ──────────────────────────────────────────────────
    CEDULA_NO_ENCONTRADA: 'Esa cédula no está en la lista de participantes de ninguna cohorte. Verifica el número o contacta a la asistente del programa.',
    CLAVE_INCORRECTA: 'La clave no es correcta. Si es tu primer ingreso, tu clave es tu número de cédula.',
    USER_NOT_FOUND: 'No encontramos esa cuenta. Verifica los datos o contacta a la asistente del programa.',
    MISSING_BEARER: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    TOKEN_EXPIRED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
    NO_TOKEN: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    TOKEN_REQUERIDO: 'Falta el enlace de acceso. Abre el enlace que te llegó por correo.',
    FORBIDDEN: 'No tienes permiso para esta acción.',
    SOLO_ADMIN: 'Solo la dirección del programa puede hacer esto.',
    SOLO_PARTICIPANTES: 'Esta sección es solo para participantes.',
    SOLO_CREADOR_EQUIPO: 'Solo quien creó el equipo puede hacer esto.',
    FALTA_ROL: 'Tu cuenta no tiene un rol asignado. Contacta a la asistente del programa.',
    ACTIVACION_FALLIDA: 'No pudimos activar tu cuenta. Inténtalo de nuevo o contacta a la asistente del programa.',

    // ── Recuperación de clave ────────────────────────────────────────────
    TOKEN_NOT_FOUND: 'Este enlace de recuperación ya no sirve. Pide uno nuevo desde "¿Olvidaste tu clave?".',
    TOKEN_INVALIDO: 'Este enlace de recuperación no es válido. Pide uno nuevo.',
    TOKEN_INVALIDO_O_EXPIRADO: 'Este enlace ya venció. Pide uno nuevo desde "¿Olvidaste tu clave?".',
    TOKEN_USED: 'Este enlace ya se usó. Pide uno nuevo si necesitas cambiar tu clave.',
    INVALID_CODE: 'El código no es correcto. Revísalo e inténtalo de nuevo.',

    // ── Equipos ──────────────────────────────────────────────────────────
    TEAM_FULL: 'El equipo ya está completo.',
    EN_EQUIPO: 'Ya perteneces a un equipo.',
    YA_EN_EQUIPO: 'Ese participante ya está en un equipo.',
    NOT_IN_TEAM: 'No perteneces a este equipo.',
    SIN_EQUIPO: 'Todavía no perteneces a ningún equipo.',
    ALGUNO_EN_OTRO_EQUIPO: 'Alguno de los participantes que elegiste ya está en otro equipo.',
    ALGUNO_NO_EXISTE: 'Alguno de los participantes que elegiste ya no está disponible. Actualiza la página.',
    CANNOT_REMOVE_CREATOR: 'No se puede quitar a quien creó el equipo. Traspasa primero esa condición a otro integrante.',
    REMOVER_MIEMBRO_FALLIDO: 'No pudimos quitar al participante del equipo. Inténtalo de nuevo.',
    TRASPASO_CREADOR_FALLIDO: 'No pudimos traspasar la condición de creador. Inténtalo de nuevo.',

    // ── Anteproyecto y proyectos ─────────────────────────────────────────
    NO_ANTEPROYECTO: 'Tu equipo todavía no tiene anteproyecto.',
    EQUIPO_SIN_ANTEPROYECTO: 'Ese equipo todavía no tiene anteproyecto.',
    ANTEPROYECTO_NO_ENVIADO: 'El anteproyecto todavía está en borrador. Envíalo primero.',
    ANTEPROYECTO_NO_SUBIDO: 'Todavía no se ha subido el anteproyecto.',
    ANTEPROYECTO_YA_APROBADO: 'Este anteproyecto ya fue aprobado.',
    FALTA_ANTEPROYECTO: 'Falta subir el anteproyecto.',
    NOMBRE_PROYECTO_REQUERIDO: 'Escribe el nombre del proyecto.',
    TIPO_PROYECTO_REQUERIDO: 'Selecciona si es emprendimiento o intraemprendimiento.',
    PROYECTO_NO_ENCONTRADO: 'No encontramos ese proyecto.',
    PROJECT_NOT_IN_TEAM: 'Ese proyecto no pertenece a tu equipo.',
    NOT_ARCHIVED: 'Ese proyecto no está archivado.',
    ALREADY_SELECTED: 'Ya se eligió el proyecto definitivo de este equipo.',
    SELECCION_PENDIENTE: 'Todavía no se ha elegido el proyecto definitivo.',
    ESPERA_PROYECTO_DEFINITIVO: 'Primero hay que elegir el proyecto definitivo.',
    SELECCION_FALLIDA: 'No pudimos guardar la selección. Inténtalo de nuevo.',
    FLAG_BUSCANDO_SOCIOS_REQUERIDO: 'Indica si el proyecto está buscando socios.',
    FLAG_BUSCANDO_ASOCIACION_REQUERIDO: 'Indica si el proyecto busca asociarse con otro.',

    // ── Reuniones y fechas ───────────────────────────────────────────────
    TOO_EARLY: 'Todavía no se abre la ventana para esta acción. Consulta el cronograma de tu cohorte.',
    ALREADY_MARKED: 'Esta reunión ya estaba marcada como realizada.',
    ALREADY_RESOLVED: 'Esta solicitud ya fue resuelta.',
    FECHA_LIMITE_AVANCE_EXPIRADA: 'La fecha límite para entregar el avance ya pasó. Contacta a la asistente del programa.',
    FECHA_LIMITE_PROYECTO_EXPIRADA: 'La fecha límite para entregar el proyecto final ya pasó. Contacta a la asistente del programa.',

    // ── Archivos ─────────────────────────────────────────────────────────
    MIME_INVALIDO: 'Ese tipo de archivo no se admite aquí. Revisa el formato pedido.',
    ARCHIVO_NO_DISPONIBLE: 'El archivo no está disponible. Puede que se haya movido o borrado.',
    ASSET_YA_SUBIDO: 'Ese documento ya fue subido y no se puede reemplazar.',
    AVANCE_YA_SUBIDO: 'El avance ya fue subido y no se puede reemplazar.',
    UPLOAD_FAILED: 'No pudimos subir el archivo. Revisa tu conexión e inténtalo de nuevo.',
    INVALID_XLSX: 'El archivo no es un Excel válido. Usa la plantilla que se descarga desde esta pantalla.',
    MISSING_COLUMN: 'Al archivo Excel le falta una columna obligatoria. Usa la plantilla de esta pantalla.',

    // ── Directores ───────────────────────────────────────────────────────
    DIRECTOR_NOT_FOUND: 'No encontramos ese director.',
    DIRECTOR_INACTIVO: 'Ese director está inactivo. Actívalo primero en Directores.',
    DIRECTOR_YA_ASIGNADO: 'Este equipo ya tiene director asignado.',
    DIRECTOR_EN_USO: 'No se puede borrar: ese director ya está asignado a uno o más equipos.',
    MODALIDAD_NO_USA_DIRECTOR: 'Esta modalidad no usa director de proyecto.',
    MODALIDAD_NO_REQUIERE_APROBACION: 'Esta modalidad no requiere aprobación del anteproyecto.',
    NOT_ASSIGNED_TO_TEAM: 'No estás asignado a ese equipo.',

    // ── Programación y presentaciones ────────────────────────────────────
    NO_PROGRAMADO: 'Tu equipo todavía no tiene horario de presentación asignado.',
    PROGRAMACION_NO_PUBLICADA: 'La programación todavía no se ha publicado.',
    SIN_PROYECTOS_PROGRAMABLES: 'No hay proyectos listos para programar. Deben tener su entrega final completa.',
    PUBLICAR_FALLIDO: 'No pudimos publicar la programación. Inténtalo de nuevo.',
    JORNADAS_FAILED: 'No pudimos actualizar las jornadas. Inténtalo de nuevo.',

    // ── Actas de grado ───────────────────────────────────────────────────
    SIN_ACTA: 'Todavía no tienes acta. Se genera cuando termina tu sustentación.',
    ACTA_NO_ENCONTRADA: 'No encontramos esa acta.',
    NO_ENCONTRADA: 'No encontramos ese registro.',
    ACTA_FUERA_DEL_ENLACE: 'Esa acta no corresponde a tu enlace de firma.',
    SIN_CASILLA: 'No tienes una casilla de firma en esta acta.',
    YA_FIRMADO: 'Estas actas ya fueron firmadas. No hace falta que hagas nada más.',
    YA_ANULADA: 'Esta acta ya está anulada.',
    NO_ESTA_ANULADA: 'Esta acta no está anulada.',
    ANULAR_FALLO: 'No pudimos anular el acta. Inténtalo de nuevo.',
    ARCHIVAR_FALLO: 'No pudimos archivar las actas. Inténtalo de nuevo.',
    VERIFICACION_INCORRECTA: 'Los datos de verificación no coinciden. Revísalos e inténtalo de nuevo.',
    YA_DILIGENCIADO: 'Este formulario ya fue diligenciado.',
    ENVIO_FALLIDO: 'No pudimos enviar el correo. Revisa la dirección e inténtalo de nuevo.',

    // ── Enlaces de firma ─────────────────────────────────────────────────
    ENLACE_NO_VALIDO: 'Este enlace no es válido. Solicita uno nuevo a la asistente del programa.',
    ENLACE_VENCIDO: 'Este enlace ya venció. Solicita uno nuevo a la asistente del programa.',
    ENLACE_REVOCADO: 'Este enlace fue anulado. Solicita uno nuevo a la asistente del programa.',
    ENLACE_BLOQUEADO: 'Este enlace se bloqueó por varios intentos fallidos. Solicita uno nuevo a la asistente del programa.',

    // ── Cohortes y sábana ────────────────────────────────────────────────
    COHORTE_NO_ENCONTRADA: 'No encontramos esa cohorte.',
    FALTA_COHORTE: 'Selecciona una cohorte.',
    NO_COHORTE: 'Tu cuenta no tiene cohorte asignada. Contacta a la asistente del programa.',
    COHORTE_FUERA_DE_ALCANCE: 'No tienes acceso a esa cohorte.',
    SABANA_NOT_FOUND: 'Esta cohorte todavía no tiene sábana de proyectos.',
    SABANA_NOT_GENERATED: 'La sábana todavía no se ha generado.',

    // ── Roles y permisos ─────────────────────────────────────────────────
    CANNOT_DELETE_SYSTEM_ROLE: 'Los roles del sistema no se pueden borrar.',
    ROL_UPDATE_FAILED: 'No pudimos guardar los cambios del rol. Inténtalo de nuevo.',
    ROL_PERMISOS_FAILED: 'No pudimos guardar los permisos del rol. Inténtalo de nuevo.',
    ROLES_ASIGNAR_FAILED: 'No pudimos asignar los roles. Inténtalo de nuevo.',
    PERMISO_GRANT_FAILED: 'No pudimos otorgar el permiso. Inténtalo de nuevo.',
    PERMISO_REVOKE_FAILED: 'No pudimos quitar el permiso. Inténtalo de nuevo.',

    // ── Datos y formularios ──────────────────────────────────────────────
    FALTAN_DATOS: 'Faltan datos por completar. Revisa el formulario.',
    DATOS_INCOMPLETOS: 'Faltan datos obligatorios. Revisa el formulario.',
    EMAIL_INVALIDO: 'El correo no tiene un formato válido.',
    EMAIL_DUPLICADO: 'Ese correo ya está registrado.',
    MISSING_MODALIDAD: 'Selecciona la modalidad de trabajo de grado.',
    NADA_QUE_ACTUALIZAR: 'No hay cambios por guardar.',
    NOT_FOUND: 'No encontramos lo que buscas. Actualiza la página e inténtalo de nuevo.',
    GUARDAR_FALLIDO: 'No pudimos guardar los cambios. Inténtalo de nuevo.',

    // ── Fallos del sistema: no son culpa del usuario ─────────────────────
    // Se dice claramente que hay que avisar, porque él no puede corregirlo.
    DB_ERROR: 'Tuvimos un problema guardando la información. Inténtalo de nuevo; si sigue igual, avisa a la asistente del programa.',
    DB_UPDATE_FAILED: 'Tuvimos un problema guardando los cambios. Inténtalo de nuevo; si sigue igual, avisa a la asistente del programa.',
    INTERNAL: 'Tuvimos un problema interno. Inténtalo en unos minutos; si sigue igual, avisa a la asistente del programa.',
    NETWORK: 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
    DECRYPT_FAILED: 'No pudimos leer unos datos guardados. Avisa a la asistente del programa.',
    ANTEPROYECTO_CREATE_FAILED: 'No pudimos crear el anteproyecto. Avisa a la asistente del programa.',
    ANTEPROYECTO_REPAIR_FAILED: 'No pudimos reparar el anteproyecto. Avisa a la asistente del programa.',
    ASSET_DB_FAILED: 'El archivo se subió pero no quedó registrado. Avisa a la asistente del programa.',
    AUTH_UPDATE_FAILED: 'No pudimos actualizar la cuenta. Avisa a la asistente del programa.',
    AUTH_USER_CREATE_FAILED: 'No pudimos crear la cuenta de acceso. Avisa a la asistente del programa.',
    AUTH_USER_UPDATE_FAILED: 'No pudimos actualizar la cuenta de acceso. Avisa a la asistente del programa.',
    TOKEN_UPDATE_FAILED: 'No pudimos actualizar el enlace. Inténtalo de nuevo.',

    // ── Internos: no deberían llegar al usuario, pero por si acaso ────────
    NO_PARTICIPANT_ID: 'Tu cuenta no está vinculada a un participante. Contacta a la asistente del programa.',
    NO_PROFESOR_ID: 'Tu cuenta no está vinculada a un profesor. Contacta a la asistente del programa.',
    INVALID: 'Hay datos inválidos en el formulario. Revísalo e inténtalo de nuevo.',
    REACTIVAR_FALLO: 'No pudimos reactivar el acta. Inténtalo de nuevo.',
    UPLOAD_ERROR: 'No pudimos subir el archivo. Revisa tu conexión e inténtalo de nuevo.',
    // El backend manda "Falta configurar ANTHROPIC_API_KEY en el servidor",
    // que es jerga para quien administra, no para quien usa la pantalla.
    IA_NO_CONFIGURADA: 'La generación automática de contenido no está disponible ahora mismo. Avisa a la asistente del programa.',
  };

  if (data?.error && codeMessages[data.error]) {
    if (data.error === 'ARCHIVOS_FALTANTES' && Array.isArray(data.faltantes)) {
      return `Faltan archivos: ${data.faltantes.join(', ')}.`;
    }
    if (data.error === 'HITOS_INSUFICIENTES') {
      return `El proyecto "${data.proyecto ?? ''}" tiene ${data.hitos_validos ?? 0} hito(s) completos. Necesitas al menos ${data.minimo ?? 5} hitos con descripción, fecha de inicio y fecha de fin.`;
    }
    return codeMessages[data.error];
  }

  // MISSING_COLUMN del Excel — el backend manda detail + header_recibido
  if (data?.error === 'MISSING_COLUMN') {
    const detail = data.detail ?? `Falta la columna "${data.column ?? ''}".`;
    const recibido = Array.isArray(data.header_recibido) && data.header_recibido.length
      ? `\n\nColumnas encontradas en el archivo: ${data.header_recibido.filter(Boolean).join(', ')}.`
      : '';
    return detail + recibido;
  }

  // Error específico de crear profesor: AUTH_USER_CREATE_FAILED + detail
  if (data?.error === 'AUTH_USER_CREATE_FAILED') {
    const detail = String(data.detail ?? '').toLowerCase();
    if (detail.includes('already') || detail.includes('exists') || detail.includes('registered') || detail.includes('duplicate')) {
      return 'Ese correo electrónico ya está registrado para otro usuario. Usa uno distinto.';
    }
    if (detail.includes('password')) {
      return 'La clave no cumple los requisitos de seguridad (mínimo 8 caracteres, una mayúscula, una minúscula y un número).';
    }
    if (detail.includes('email')) {
      return 'El correo electrónico no es válido o no fue aceptado por el proveedor de autenticación.';
    }
    return `No se pudo crear la cuenta del profesor: ${data.detail ?? 'error del servidor de autenticación'}.`;
  }

  // Errores de validación Zod: data.error === 'INVALID' con details[]
  if (data?.error === 'INVALID' && Array.isArray(data.details)) {
    const msgs: string[] = [];
    for (const d of data.details) {
      const path = Array.isArray(d.path) ? d.path : [];

      // --- Crear/editar profesor ---
      if (path[0] === 'nombre_completo') {
        if (d.code === 'too_small') msgs.push('El nombre completo es obligatorio (mínimo 2 caracteres).');
        else if (d.code === 'too_big') msgs.push('El nombre completo es demasiado largo (máximo 150 caracteres).');
        else msgs.push(d.message ?? 'Nombre completo inválido.');
        continue;
      }
      if (path[0] === 'email') {
        msgs.push('El email no es válido. Debe ser una dirección institucional bien formada (ej. profesor@inalde.edu.co).');
        continue;
      }
      if (path[0] === 'password') {
        if (d.code === 'too_small') msgs.push('La clave temporal debe tener al menos 8 caracteres.');
        else if (d.code === 'invalid_string' || d.validation === 'regex') {
          // El schema exige una mayúscula, una minúscula y un número
          msgs.push('La clave temporal debe contener al menos una letra MAYÚSCULA, una minúscula y un número.');
        } else msgs.push(d.message ?? 'Clave inválida.');
        continue;
      }
      if (path[0] === 'booking_url') {
        msgs.push('El Booking URL no es válido. Debe empezar con https:// (ej. https://calendly.com/tu-link).');
        continue;
      }
      if (path[0] === 'areas_afinidad') {
        msgs.push('Las áreas de afinidad son inválidas. Sepáralas por coma (ej. Tecnología, Finanzas).');
        continue;
      }

      // --- Anteproyecto ---
      if (path[0] === 'miembros' && path[2] === 'emociones') {
        msgs.push(`Miembro ${(path[1] ?? 0) + 1}: marca al menos una emoción que te motiva del emprendimiento.`);
      } else if (path[0] === 'miembros' && path[2] === 'preocupaciones') {
        msgs.push(`Miembro ${(path[1] ?? 0) + 1}: marca al menos una preocupación.`);
      } else if (path[0] === 'miembros' && path[2] === 'perfil') {
        msgs.push(`Miembro ${(path[1] ?? 0) + 1}: selecciona el rol con el que más te identificas.`);
      } else if (path[0] === 'miembros' && path[2] === 'fue_emprendedor') {
        msgs.push(`Miembro ${(path[1] ?? 0) + 1}: indica si has sido emprendedor antes.`);
      } else if (path[0] === 'proyectos' && path[2] === 'nombre') {
        msgs.push(`Proyecto ${(path[1] ?? 0) + 1}: falta el nombre.`);
      } else if (path[0] === 'proyectos' && path[2] === 'tipo') {
        msgs.push(`Proyecto ${(path[1] ?? 0) + 1}: selecciona el tipo (emprendimiento o intraemprendimiento).`);
      } else if (path[0] === 'proyectos' && d.code === 'too_small') {
        msgs.push('Debes crear al menos un proyecto.');
      } else if (path[0] === 'numero_miembros' || path[0] === 'numero_proyectos') {
        msgs.push(d.message ?? 'Cantidad inválida.');
      } else if (path[0] === 'miembros' && d.code === 'too_small') {
        msgs.push('Debes registrar al menos un miembro.');
      } else if (path[0] === 'tipo' && (path[1] === undefined || path[1] === null)) {
        msgs.push('Modalidad inválida.');
      } else {
        const where = path.length ? ` (${path.join('.')})` : '';
        msgs.push(`${d.message ?? 'Campo inválido'}${where}`);
      }
    }
    const unique = Array.from(new Set(msgs));
    return 'Hay campos por completar:\n• ' + unique.join('\n• ');
  }

  // Si el backend nos manda un mensaje en espanol ('mensaje' o 'message'),
  // usalo antes de caer al generico. Asi siempre vemos el detalle real.
  if (data?.mensaje) return String(data.mensaje);
  if (data?.message) return String(data.message);
  // Code conocido pero sin traducción → mensaje genérico (NO el código crudo)
  if (data?.error) return 'Ocurrió un error procesando tu solicitud. Inténtalo de nuevo o contacta a la asistente del programa.';
  // Último recurso: nunca mostrar "Request failed with status code XXX"
  if (typeof e?.message === 'string' && !/^Request failed/i.test(e.message)) return e.message;
  return 'Error inesperado. Inténtalo de nuevo. Si persiste, contacta a la asistente del programa.';
}
