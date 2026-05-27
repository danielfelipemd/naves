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
    INVALID_MIME: 'El tipo de archivo no es válido. Usa PDF (anteproyecto) o PDF/Word (proyecto final).',
    FILE_TOO_LARGE: 'El archivo supera el tamaño máximo de 25 MB.',
    POSITION_TAKEN: 'Esa posición ya está ocupada por otro miembro.',
    COHORTE_MISMATCH: 'El participante pertenece a otra cohorte.',
    PARTICIPANT_NOT_ACTIVE: 'Tu cuenta no está activa. Contacta al administrador.',
    NOT_AUTHENTICATED: 'Sesión expirada. Vuelve a iniciar sesión.',
    INVALID_TOKEN: 'Sesión inválida. Vuelve a iniciar sesión.',
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

  // Code conocido pero sin traducción → mensaje genérico (NO el código crudo)
  if (data?.error) return 'Ocurrió un error procesando tu solicitud. Inténtalo de nuevo o contacta a la asistente del programa.';
  if (data?.message) return String(data.message);
  // Último recurso: nunca mostrar "Request failed with status code XXX"
  if (typeof e?.message === 'string' && !/^Request failed/i.test(e.message)) return e.message;
  return 'Error inesperado. Inténtalo de nuevo. Si persiste, contacta a la asistente del programa.';
}
