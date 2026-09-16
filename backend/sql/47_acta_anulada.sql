-- 47 — Anular un acta.
--
-- Caso real: el acta ya salió a firma y resulta que ese participante no se
-- gradúa (no cumplió un requisito, se retira, queda pendiente de una materia).
-- El acta no se puede borrar —ya circuló y puede tener firmas selladas— pero
-- tampoco puede seguir su curso como si nada.
--
-- Se marca ANULADA: deja de pedir firmas, deja de contar como pendiente y su
-- PDF sale con una marca de agua "ANULADA" cruzada, para que una copia impresa
-- de antes no se pueda confundir con una válida.

alter table acta drop constraint if exists acta_estado_check;
alter table acta add constraint acta_estado_check check (estado in (
  'faltan_datos', 'generada', 'enviada', 'en_firmas_internas',
  'lista_para_cierre', 'completa', 'archivada', 'anulada'
));

alter table acta add column if not exists anulada_en     timestamptz;
alter table acta add column if not exists anulada_motivo text;
alter table acta add column if not exists anulada_por    text;

comment on column acta.anulada_en     is 'Cuándo se anuló. Null = vigente.';
comment on column acta.anulada_motivo is 'Por qué se anuló. Queda en el PDF y en la auditoría.';
comment on column acta.anulada_por    is 'Quién la anuló (correo del super admin).';
