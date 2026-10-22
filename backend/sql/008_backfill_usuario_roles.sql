BEGIN;

UPDATE "DW_CONFIG".usuarios_app AS usuario
SET rol_id = CASE
    WHEN upper(trim(coalesce(empleado."Clasificacion", ''))) IN (
        'ADMINISTRATIVO',
        'ADMINISTRATIVA'
    ) THEN 1
    ELSE 2
END
FROM "DW_SUMA"."DimEmpleados" AS empleado
WHERE usuario.rol_id IS NULL
  AND empleado."TipoDocumento" = usuario.tipo_documento
  AND empleado."Identificacion" = usuario.identificacion;

COMMIT;
