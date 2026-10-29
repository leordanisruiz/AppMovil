import { apiBaseUrl, httpClient } from '../api/httpClient';
import { Platform } from 'react-native';
import type {
  AssignableNovelty,
  AssignableOperator,
  CreateTaskRequest,
  OperatorTask,
  TaskAssignmentResponse,
  TaskEvidenceAsset,
  TaskStatus,
  TaskTypeOption,
} from '../types/tarea';

type UploadEvidenceResponse = {
  tarea: OperatorTask;
  evidencias_agregadas: number;
};

type NativeUploadPart = {
  uri: string;
  name: string;
  type: string;
};

type NativeFormData = FormData & {
  append(name: string, value: NativeUploadPart): void;
};

export const tareasService = {
  async searchOperators(search: string): Promise<AssignableOperator[]> {
    const response = await httpClient.get<AssignableOperator[]>(
      '/tareas/asignacion/operadores',
      { params: { buscar: search } },
    );
    return response.data;
  },

  async getOperatorNovelties(operatorCode: string): Promise<AssignableNovelty[]> {
    const response = await httpClient.get<AssignableNovelty[]>(
      `/tareas/asignacion/operadores/${encodeURIComponent(operatorCode)}/novedades`,
    );
    return response.data;
  },

  async getNovelty(noveltyId: number): Promise<AssignableNovelty> {
    const response = await httpClient.get<AssignableNovelty>(
      `/tareas/asignacion/novedades/${noveltyId}`,
    );
    return response.data;
  },

  async getTaskTypes(): Promise<TaskTypeOption[]> {
    const response = await httpClient.get<TaskTypeOption[]>(
      '/tareas/asignacion/tipos',
    );
    return response.data;
  },

  async createAssignment(
    assignment: CreateTaskRequest,
  ): Promise<TaskAssignmentResponse> {
    const response = await httpClient.post<TaskAssignmentResponse>(
      '/tareas/asignacion',
      assignment,
    );
    return response.data;
  },

  async getAll(): Promise<OperatorTask[]> {
    const response = await httpClient.get<OperatorTask[]>('/tareas');
    return response.data;
  },

  async getNotClosedCount(): Promise<number> {
    const response = await httpClient.get<number>('/tareas/resumen/activas');
    return response.data;
  },

  async getCreated(): Promise<OperatorTask[]> {
    const response = await httpClient.get<OperatorTask[]>('/tareas/creadas');
    return response.data;
  },

  async getCreatedById(taskId: number): Promise<OperatorTask> {
    const response = await httpClient.get<OperatorTask>(
      `/tareas/creadas/${taskId}`,
    );
    return response.data;
  },

  async closeCreated(taskId: number): Promise<OperatorTask> {
    const response = await httpClient.patch<OperatorTask>(
      `/tareas/creadas/${taskId}/cerrar`,
    );
    return response.data;
  },

  async getById(taskId: number): Promise<OperatorTask> {
    const response = await httpClient.get<OperatorTask>(`/tareas/${taskId}`);
    return response.data;
  },

  async uploadEvidence(
    taskId: number,
    assets: TaskEvidenceAsset[],
  ): Promise<UploadEvidenceResponse> {
    const formData = new FormData() as NativeFormData;
    for (const asset of assets) {
      if (asset.webFile) {
        (formData as FormData).append('files', asset.webFile, asset.name);
      } else {
        formData.append('files', {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType,
        });
      }
      formData.append('captured_at', asset.capturedAt ?? new Date().toISOString());
    }

    const response = await httpClient.post<UploadEvidenceResponse>(
      `/tareas/${taskId}/evidencias`,
      formData,
      {
        headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
        timeout: 600_000,
      },
    );
    return response.data;
  },

  async updateStatus(taskId: number, estado: TaskStatus): Promise<OperatorTask> {
    const response = await httpClient.patch<OperatorTask>(
      `/tareas/${taskId}/estado`,
      { estado },
    );
    return response.data;
  },

  evidenceUrl(taskId: number, nombre: string): string {
    return `${apiBaseUrl}/tareas/${taskId}/evidencias/${encodeURIComponent(nombre)}`;
  },

  evidenceThumbnailUrl(taskId: number, nombre: string): string {
    return `${apiBaseUrl}/tareas/${taskId}/evidencias/${encodeURIComponent(nombre)}/thumbnail`;
  },

  evidenceOriginalPreviewUrl(taskId: number, nombre: string): string {
    return (
      `${apiBaseUrl}/tareas/${taskId}/evidencias/` +
      `${encodeURIComponent(nombre)}/thumbnail?original=true`
    );
  },

  evidenceDownloadUrl(taskId: number, nombre: string): string {
    return `${apiBaseUrl}/tareas/${taskId}/evidencias/${encodeURIComponent(nombre)}/download`;
  },

  evidenceStreamTokenUrl(taskId: number, nombre: string): string {
    return `${apiBaseUrl}/tareas/${taskId}/evidencias/${encodeURIComponent(nombre)}/stream-token`;
  },

  evidenceStreamPlaybackUrl(token: string): string {
    return `${apiBaseUrl}/tareas/video-stream/${encodeURIComponent(token)}`;
  },
};
