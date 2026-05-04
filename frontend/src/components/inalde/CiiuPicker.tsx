import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

interface Props {
  value: string;
  onChange: (codigo: string) => void;
}

interface Option { codigo: string; descripcion: string; seccion: string; }

export function CiiuPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setOptions([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/ciiu/buscar', { params: { q: query, limit: 8 } });
        setOptions(data);
      } finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Busca por código (ej. 6201) o descripción (ej. software)"
        className="input-inalde"
      />
      {open && (options.length > 0 || loading) && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-inalde-gray-light rounded shadow-inalde-card max-h-72 overflow-auto">
          {loading && <li className="px-4 py-3 text-sm text-inalde-gray">Buscando…</li>}
          {options.map((o) => (
            <li
              key={o.codigo}
              onClick={() => { onChange(o.codigo); setQuery(`${o.codigo} — ${o.descripcion}`); setOpen(false); }}
              className="px-4 py-2 cursor-pointer hover:bg-inalde-gray-bg border-b border-inalde-gray-light last:border-b-0"
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
    </div>
  );
}
