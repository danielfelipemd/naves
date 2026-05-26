export function Header() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-white border-b border-inalde-gray-light shadow-sm">
      <div className="bg-inalde-black px-8 py-2">
        <p className="text-right text-white font-primary font-medium text-xs tracking-wider uppercase">
          INALDE Business School
        </p>
      </div>
      <div className="flex items-center max-w-[1400px] mx-auto px-8 py-4 bg-white">
        <a href="/" className="flex items-center gap-6">
          <svg viewBox="0 0 128 128" className="h-14 w-auto" xmlns="http://www.w3.org/2000/svg">
            <rect width="128" height="128" fill="#e30613" />
            <text
              x="64" y="80"
              fontFamily="Montserrat" fontSize="48" fontWeight="700" fill="white"
              textAnchor="middle"
            >
              N
            </text>
          </svg>
          <div className="w-px h-11 bg-inalde-gray-light" />
          <div>
            <p className="font-primary font-semibold text-[0.7rem] tracking-widest uppercase text-inalde-gray mb-0.5">
              Trabajo de grado
            </p>
            <p className="font-primary font-extrabold text-xl tracking-tight leading-none text-inalde-text">
              MBA
            </p>
          </div>
        </a>
      </div>
    </header>
  );
}
