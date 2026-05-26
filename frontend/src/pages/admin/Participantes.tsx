import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatBackendError } from '../../lib/errors';

interface Cohorte { id: string; etiqueta: string; participantes_count: number; }

export default function Participantes() {
  const [cohortes, setCohortes] = useState<Cohorte[]>([]);
  const [cohorte, setCohorte] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { (async () => {
    const { data } = await api.get('/admin/cohortes');
    setCohortes(data);
    setCohorte(data.find((c: Cohorte) => c.participantes_count === 0)?.id ?? data[0]?.id ?? '');
  })(); }, []);

  async function upload() {
    setErr(null); setResult(null);
    if (!cohorte) { setErr('Selecciona una cohorte'); return; }
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr('Selecciona un archivo Excel (.xlsx)'); return; }

    const fd = new FormData();
    fd.append('cohorte_id', cohorte);
    fd.append('file', file);

    setBusy(true);
    try {
      const { data } = await api.post('/admin/participantes/cargar-excel', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      // refresh cohortes counts
      const fresh = await api.get('/admin/cohortes');
      setCohortes(fresh.data);
    } catch (e: any) {
      setErr(formatBackendError(e));
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="border-b-[3px] border-inalde-red pb-4 mb-6">
        <p className="section-subtitle mb-1">Administración</p>
        <h1 className="section-title">Cargar lista de participantes</h1>
        <p className="text-sm text-inalde-text mt-2">
          Sube un Excel con las siguientes columnas (flexible — no importan mayúsculas ni acentos):
        </p>
        <ul className="text-sm text-inalde-text mt-2 list-disc pl-5 space-y-1">
          <li>
            <strong>Nombre</strong>: puede ser <code className="bg-inalde-gray-bg px-1 rounded">Nombre completo</code> en una sola columna,
            <strong> o bien</strong> <code className="bg-inalde-gray-bg px-1 rounded">Nombre</code> y <code className="bg-inalde-gray-bg px-1 rounded">Apellido</code> en dos columnas separadas (se combinan automáticamente).
          </li>
          <li><strong>Cédula</strong>: acepta <code className="bg-inalde-gray-bg px-1 rounded">Cedula</code>, <code className="bg-inalde-gray-bg px-1 rounded">CC</code>, <code className="bg-inalde-gray-bg px-1 rounded">Documento</code>, <code className="bg-inalde-gray-bg px-1 rounded">DNI</code> o <code className="bg-inalde-gray-bg px-1 rounded">Identificación</code>.</li>
          <li><strong>Email</strong>: acepta <code className="bg-inalde-gray-bg px-1 rounded">Email</code>, <code className="bg-inalde-gray-bg px-1 rounded">Correo</code> o <code className="bg-inalde-gray-bg px-1 rounded">Correo electrónico</code>.</li>
        </ul>
        <p className="text-xs text-inalde-gray mt-3">
          Los participantes quedarán en estado <em>pendiente_activacion</em> con clave temporal <code>TempCambiar2026!</code>.
        </p>
      </div>

      <div className="space-y-4 max-w-md">
        <div>
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">Cohorte</label>
          <select value={cohorte} onChange={(e) => setCohorte(e.target.value)} className="input-inalde">
            {cohortes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.etiqueta} {c.participantes_count > 0 && `· ${c.participantes_count} ya cargados`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block font-primary font-semibold text-xs tracking-wider uppercase text-inalde-gray mb-2">Archivo Excel (.xlsx)</label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls"
            className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-inalde-red file:text-white file:font-semibold hover:file:bg-inalde-red-hover" />
        </div>

        <button onClick={upload} disabled={busy} className="btn-inalde-primary">
          {busy ? 'Procesando…' : 'Cargar →'}
        </button>
      </div>

      {err && <pre className="mt-6 rounded border-l-4 border-inalde-red bg-red-50 px-4 py-3 text-xs whitespace-pre-wrap">{err}</pre>}

      {result && (
        <div className="mt-6 rounded border-l-4 border-inalde-blue bg-blue-50 px-4 py-3 text-sm">
          <p className="font-semibold mb-1">Carga completada</p>
          <p>Insertados / actualizados: <strong>{result.inserted}</strong></p>
          {result.errors?.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">{result.errors.length} errores</summary>
              <ul className="mt-2 text-xs">{result.errors.map((e: any, i: number) => <li key={i}>Fila {e.row}: {e.error}</li>)}</ul>
            </details>
          )}
          {result.nota && <p className="text-xs text-inalde-gray mt-2">{result.nota}</p>}
        </div>
      )}
    </>
  );
}
