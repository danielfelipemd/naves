import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes: Record<NonNullable<Props['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
};

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-10 px-4"
      onClick={onClose}>
      <div className={`bg-white rounded-lg shadow-xl w-full ${sizes[size]} animate-in fade-in zoom-in-95`}
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b-[3px] border-inalde-red">
          <div>
            {subtitle && <p className="section-subtitle mb-1">{subtitle}</p>}
            <h2 className="font-primary font-bold text-xl text-inalde-text">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="text-2xl leading-none text-inalde-gray hover:text-inalde-red transition">×</button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <footer className="px-6 py-4 border-t border-inalde-gray-light flex justify-end gap-2 bg-inalde-gray-bg/50 rounded-b-lg">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
