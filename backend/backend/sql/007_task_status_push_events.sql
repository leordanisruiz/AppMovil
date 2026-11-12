BEGIN;

ALTER TABLE "DW_CONFIG".expo_push_outbox
    ADD COLUMN IF NOT EXISTS task_event VARCHAR(24) NOT NULL DEFAULT 'asignacion';

ALTER TABLE "DW_CONFIG".expo_push_outbox
    DROP CONSTRAINT IF EXISTS ck_expo_push_outbox_task_event;

ALTER TABLE "DW_CONFIG".expo_push_outbox
    ADD CONSTRAINT ck_expo_push_outbox_task_event
    CHECK (
        task_id IS NULL
        OR task_event IN ('asignacion', 'completada', 'cerrada')
    );

DROP INDEX IF EXISTS "DW_CONFIG".uq_expo_push_outbox_task_recipient;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expo_push_outbox_task_event_recipient
    ON "DW_CONFIG".expo_push_outbox (task_id, token_hash, task_event)
    WHERE task_id IS NOT NULL;

COMMIT;
