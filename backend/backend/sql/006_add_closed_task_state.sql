BEGIN;

ALTER TABLE "DW_OPERACIONAL".tareas_operador
    DROP CONSTRAINT IF EXISTS ck_tareas_operador_estado;

ALTER TABLE "DW_OPERACIONAL".tareas_operador
    ADD CONSTRAINT ck_tareas_operador_estado
    CHECK (estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CERRADO'));

COMMIT;
