-- =====================================================
-- NAVES — Seed inicial
-- Cohortes confirmadas y placeholder para 27-29
-- =====================================================

INSERT INTO cohortes (id, etiqueta, fecha_inicio, fecha_fin) VALUES
    ('int-24-26', 'MBA INT 24-26', '2024-01-13', '2024-04-07'),
    ('fs-24-26',  'MBA FS 24-26',  '2024-01-18', '2024-05-10'),
    ('int-26-28', 'MBA INT 26-28', '2026-01-12', '2026-04-06'),
    ('fs-26-28',  'MBA FS 26-28',  '2026-01-17', '2026-05-09'),
    ('int-28-30', 'MBA INT 28-30', '2028-01-11', '2028-04-05'),
    ('fs-28-30',  'MBA FS 28-30',  '2028-01-16', '2028-05-08')
ON CONFLICT (id) DO NOTHING;

-- Cohortes 27-29: fechas placeholder, deben actualizarse manualmente
INSERT INTO cohortes (id, etiqueta, fecha_inicio, fecha_fin, activa) VALUES
    ('int-27-29', 'MBA INT 27-29', '2027-01-01', '2027-04-01', FALSE),
    ('fs-27-29',  'MBA FS 27-29',  '2027-01-01', '2027-05-01', FALSE)
ON CONFLICT (id) DO NOTHING;
