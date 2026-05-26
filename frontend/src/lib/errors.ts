// Traducción de errores del backend NAVES a mensajes legibles para el usuario.
// Cubre tanto los errores de aplicación (`{ error: "CODE" }`) como los de validación Zod
// (`{ error: "INVALID", details: [...] }`).

export function formatBackendError(e: any): string {
  const data = e?.response?.data;

  const codeMessages: Record<string, string> = {
    NO_PROYECTOS: 'Debes crear al menos un proyecto antes de enviar.',
    HITOS_INSUFICIENTES: 'Cada proyecto necesita al menos 5 hitos con descripción y fechas.',
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

  if (data?.error) return String(data.error);
  if (data?.message) return String(data.message);
  if (e?.message) return String(e.message);
  return 'Error inesperado. Inténtalo de nuevo.';
}
