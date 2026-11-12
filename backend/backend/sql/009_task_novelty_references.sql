BEGIN;

ALTER TABLE "DW_OPERACIONAL".tareas_operador
    ADD COLUMN IF NOT EXISTS novedades_referencias JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "DW_OPERACIONAL".tareas_operador
    DROP CONSTRAINT IF EXISTS ck_tareas_operador_novedades_referencias;

ALTER TABLE "DW_OPERACIONAL".tareas_operador
    ADD CONSTRAINT ck_tareas_operador_novedades_referencias
    CHECK (jsonb_typeof(novedades_referencias) = 'array');

COMMIT;
