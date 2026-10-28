export type TaskStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'COMPLETADA'
  | 'CERRADO';
export type TaskEvidenceType = 'image' | 'video';

export type TaskEvidence = {
  nombre: string;
  ruta: string;
  fecha: string;
  tipo: TaskEvidenceType;
  fecha_captura?: string | null;
};

export type OperatorTask = {
  id: number;
  novedades_ids: number[];
  operador_id: number;
  tipo_tarea: string;
  descripcion: string;
  fecha_creacion: string;
  usuario_creacion: string;
  estado: TaskStatus;
  evidencias: TaskEvidence[];
};

export type AssignableOperator = {
  codigo: string;
  tipo_documento: string;
  identificacion: string;
  nombre_completo: string;
};

export type AssignableNovelty = {
  id_novedad: number;
  fecha_novedad: string | null;
  codigo: number;
  tipo_novedad: string | null;
  grupo?: string | null;
  subgrupo?: string | null;
  novedad?: string | null;
  descripcion: string | null;
  estado: string | null;
  tipo_documento?: string | null;
  identificacion?: string | null;
  nombre_completo?: string | null;
};

export type TaskTypeOption = {
  id: number;
  nombre: string;
};

export type CreateTaskRequest = {
  operador_id: number;
  novedades_ids: number[];
  tipo_tarea_id: number;
  descripcion: string;
};

export type TaskAssignmentResponse = {
  tarea: OperatorTask;
  notificaciones_programadas: number;
};

export type TaskEvidenceAsset = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  durationMs?: number;
  capturedAt?: string;
  webFile?: Blob;
};
