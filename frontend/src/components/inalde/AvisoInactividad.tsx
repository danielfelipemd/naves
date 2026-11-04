import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/store';
import { api } from '../../lib/api';
import {
  AVISO_ANTES_MS,
  CLAVE_ACTIVIDAD,
  INACTIVIDAD_MAX_MS,
  leerUltimaActividad,
  marcarActividad,
} from '../../auth/actividad';
import { Modal } from './Modal';

/**
 * Cierra la sesión tras 1 hora sin actividad real, avisando 10 minutos antes.
 *
 * Quien hace cumplir la política es el backend (responde 401 SESION_EXPIRADA).
 * Esto hace dos cosas que el backend no puede:
 *
 *  1. Contar como actividad lo que no pasa por la API: escribir un texto largo,
 *     leer, desplazarse. Se manda un latido como mucho una vez por minuto, y
 *     solo si hubo interacción de verdad.
 *  2. Avisar ANTES. Sin aviso, quien lleva 50 minutos con el resumen de su
 *     anteproyecto a medio escribir y vuelve del café se encontraría el login.
 *
 * Solo se monta con sesión: en las páginas públicas (firma de actas, portal del
 * panelista) no hay nada que vigilar.
 */

const LATIDO_CADA_MS = 60 * 1000;
const GUARDAR_CADA_MS = 15 * 1000;
const REVISAR_CADA_MS = 15 * 1000;

/** Interacción de la persona. Mover el ratón no cuenta: pasa solo. */
const EVENTOS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export function AvisoInactividad() {
  const session = useAuth((s) => s.session);
  const signOut = useAuth((s) => s.signOut);
  const [minutosRestantes, setMinutosRestantes] = useState<number | null>(null);
  const ultimoLatido = useRef(0);
  const ultimoGuardado = useRef(0);
  const cerrando = useRef(false);

  const latido = useCallback((forzar = false) => {
    const ahora = Date.now();
    if (!forzar && ahora - ultimoLatido.current < LATIDO_CADA_MS) return;
    ultimoLatido.current = ahora;
    // Un 401 aquí lo atiende el interceptor de la API (sale al login).
    api.post('/auth/actividad').catch(() => { /* red caída: se reintenta en la próxima interacción */ });
  }, []);

  const revisar = useCallback(() => {
    if (cerrando.current) return;
    const ultima = leerUltimaActividad();
    if (ultima === null) { marcarActividad(); return; }
    const inactivo = Date.now() - ultima;
    if (inactivo >= INACTIVIDAD_MAX_MS) {
      cerrando.current = true;
      void signOut('inactividad');
      return;
    }
    if (inactivo >= INACTIVIDAD_MAX_MS - AVISO_ANTES_MS) {
      setMinutosRestantes(Math.max(1, Math.ceil((INACTIVIDAD_MAX_MS - inactivo) / 60000)));
    } else {
      setMinutosRestantes(null);
    }
  }, [signOut]);

  useEffect(() => {
    if (!session) { setMinutosRestantes(null); return; }
    cerrando.current = false;

    // Primera vez con sesión en este navegador (p. ej. justo tras desplegar
    // esto): se arranca a contar desde ahora en vez de echar a nadie.
    if (leerUltimaActividad() === null) marcarActividad();
    revisar();

    const alInteractuar = () => {
      const ahora = Date.now();
      if (ahora - ultimoGuardado.current >= GUARDAR_CADA_MS) {
        ultimoGuardado.current = ahora;
        marcarActividad(ahora);
      }
      latido();
    };
    // Al volver a la pestaña después de un rato, se revisa en el acto: quien
    // vuelve tras dos horas ve el aviso de cierre, no la pantalla vieja.
    const alVolver = () => { if (document.visibilityState === 'visible') revisar(); };
    // Otra pestaña de NAVES marcó actividad: puede que haya que quitar el aviso.
    const alCambiarOtraPestana = (e: StorageEvent) => { if (e.key === CLAVE_ACTIVIDAD) revisar(); };

    EVENTOS.forEach((ev) => window.addEventListener(ev, alInteractuar, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('storage', alCambiarOtraPestana);
    const t = window.setInterval(revisar, REVISAR_CADA_MS);

    return () => {
      EVENTOS.forEach((ev) => window.removeEventListener(ev, alInteractuar, { capture: true }));
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('storage', alCambiarOtraPestana);
      window.clearInterval(t);
    };
  }, [session, revisar, latido]);

  function seguirConectado() {
    marcarActividad();
    ultimoGuardado.current = Date.now();
    latido(true);
    setMinutosRestantes(null);
  }

  if (!session || minutosRestantes === null) return null;

  return (
    <Modal
      open
      onClose={seguirConectado}
      size="sm"
      subtitle="Sesión"
      title="¿Sigues ahí?"
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={seguirConectado} className="btn-inalde-primary">
            Seguir conectado
          </button>
        </div>
      }
    >
      <p className="text-sm text-inalde-text">
        Por seguridad, tu sesión se cerrará en{' '}
        <strong>{minutosRestantes === 1 ? '1 minuto' : `${minutosRestantes} minutos`}</strong>{' '}
        si no hay actividad.
      </p>
      <p className="text-sm text-inalde-gray mt-3">
        Si estabas escribiendo algo, pulsa «Seguir conectado» para no perderlo.
      </p>
    </Modal>
  );
}
