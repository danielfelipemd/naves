import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';

interface Props {
  value: string;
  onChange: (codigo: string) => void;
  // Los inyecta <Field> para asociar la etiqueta con el input de búsqueda.
  id?: string;
  'aria-describedby'?: string;
}

interface Option { codigo: string; descripcion: string; seccion: string; }

let cache: Option[] | null = null;

export function CiiuPicker({ value, onChange, id, 'aria-describedby': ariaDescribedBy }: Props) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Option[]>(cache ?? []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(!cache);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cache) return;
    (async () => {
      try {
        const { data } = await api.get<Option[]>('/ciiu/listar');
        cache = data;
        setAll(data);
      } finally { setLoading(false); }
    })();
  }, []);

  // Etiqueta del valor seleccionado
  const selectedLabel = useMemo(() => {
    if (!value) return '';
    const found = all.find((o) => o.codigo === value);
    return found ? `${found.codigo} — ${found.descripcion}` : value;
  }, [value, all]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) =>
      o.codigo.startsWith(q) ||
      o.descripcion.toLowerCase().includes(q) ||
      (o.seccion ?? '').toLowerCase().includes(q),
    );
  }, [query, all]);

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        aria-describedby={ariaDescribedBy}
        type="text"
        value={open ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        placeholder={loading ? 'Cargando códigos…' : 'Haz click y elige de la lista, o busca por código o descripción'}
        className="input-inalde"
        autoComplete="off"
        spellCheck={false}
        disabled={loading}
      />
      {open && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-inalde-gray-light rounded shadow-inalde-card max-h-80 overflow-auto">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-inalde-gray italic">Sin resultados para "{query}"</li>
          )}
          {filtered.map((o) => (
            <li
              key={o.codigo}
              onClick={() => { onChange(o.codigo); setOpen(false); setQuery(''); }}
              className={`px-4 py-2 cursor-pointer hover:bg-inalde-gray-bg border-b border-inalde-gray-light last:border-b-0 ${value === o.codigo ? 'bg-inalde-red/5' : ''}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-semibold text-inalde-red text-sm">{o.codigo}</span>
                <span className="text-xs text-inalde-gold">[{o.seccion}]</span>
              </div>
              <div className="text-sm text-inalde-text leading-snug">{o.descripcion}</div>
            </li>
          ))}
        </ul>
      )}
      {!open && (
        <p className="text-xs text-inalde-gray mt-1">
          {value ? 'Haz click para cambiar' : `${all.length} códigos disponibles · haz click para ver la lista`}
        </p>
      )}
    </div>
  );
}
