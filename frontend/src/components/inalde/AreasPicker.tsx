import { useEffect, useRef, useState } from 'react';
import { AREAS_AFINIDAD } from '../../lib/areas';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  size?: 'normal' | 'compact';
}

export function AreasPicker({ value, onChange, size = 'normal' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function toggle(area: string) {
    if (value.includes(area)) onChange(value.filter((a) => a !== area));
    else onChange([...value, area]);
  }

  const triggerClass = size === 'compact'
    ? 'input-inalde !py-1 !text-sm text-left cursor-pointer'
    : 'input-inalde text-left cursor-pointer';

  const label = value.length === 0
    ? <span className="text-inalde-gray italic">Selecciona áreas…</span>
    : <span>{value.join(', ')}</span>;

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={triggerClass}>
        {label}
        <span className="float-right text-inalde-gray text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[280px] bg-white border border-inalde-gray-light rounded shadow-inalde-card p-2 max-h-72 overflow-auto">
          {AREAS_AFINIDAD.map((area) => {
            const checked = value.includes(area);
            return (
              <label
                key={area}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm hover:bg-inalde-gray-bg ${checked ? 'bg-inalde-red/5' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(area)}
                  className="accent-inalde-red"
                />
                <span className={checked ? 'text-inalde-text font-medium' : 'text-inalde-text'}>{area}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
