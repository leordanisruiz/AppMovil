import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { isAxiosError } from 'axios';
import * as Network from 'expo-network';
import type { TaskEvidenceAsset } from '../types/tarea';
import { tareasService } from './tareasService';

const STORAGE_KEY = 'evidence-upload-queue-v1';
const QUEUE_DIRECTORY = new Directory(Paths.document, 'evidence-upload-queue');

export type QueuedEvidence = {
  uploadId: string;
  taskId: number;
  ownerIdentification: string;
  fileUri: string;
  name: string;
  mimeType: string;
  size?: number;
  durationMs?: number;
  capturedAt: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  blockedMessage?: string;
};

function newUploadId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function readQueue(): Promise<QueuedEvidence[]> {
  const serialized = await AsyncStorage.getItem(STORAGE_KEY);
  if (!serialized) return [];
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is QueuedEvidence =>
    Boolean(item && typeof item === 'object'
      && typeof item.uploadId === 'string'
      && typeof item.taskId === 'number'
      && typeof item.ownerIdentification === 'string'
      && typeof item.fileUri === 'string'
      && typeof item.capturedAt === 'string'
      && typeof item.latitude === 'number'
      && typeof item.longitude === 'number'),
  );
}

async function writeQueue(entries: QueuedEvidence[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function getQueuedEvidence(taskId?: number): Promise<QueuedEvidence[]> {
  const queue = await readQueue();
  return taskId === undefined ? queue : queue.filter((item) => item.taskId === taskId);
}

/** Copies media to durable app storage before any network request is started. */
export async function enqueueEvidence(
  taskId: number,
  ownerIdentification: string,
  assets: TaskEvidenceAsset[],
): Promise<QueuedEvidence[]> {
  if (!assets.length) return [];
  QUEUE_DIRECTORY.create({ idempotent: true, intermediates: true });
  const created: QueuedEvidence[] = [];
  try {
    for (const asset of assets) {
      if (asset.webFile) {
        throw new Error('La cola sin conexión está disponible en la aplicación móvil.');
      }
      const uploadId = newUploadId();
      const safeName = asset.name.replace(/[^\w.-]/g, '_').slice(-90) || 'evidencia';
      const destination = new File(QUEUE_DIRECTORY, `${uploadId}-${safeName}`);
      await new File(asset.uri).copy(destination);
      created.push({
        uploadId,
        taskId,
        ownerIdentification,
        fileUri: destination.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        durationMs: asset.durationMs,
        capturedAt: asset.capturedAt,
        latitude: asset.latitude,
        longitude: asset.longitude,
        createdAt: new Date().toISOString(),
      });
    }
    await writeQueue([...(await readQueue()), ...created]);
    return created;
  } catch (error) {
    created.forEach((entry) => {
      try { new File(entry.fileUri).delete(); } catch { /* Best effort cleanup. */ }
    });
    throw error;
  }
}

async function removeQueuedEvidence(uploadId: string): Promise<void> {
  const queue = await readQueue();
  const removed = queue.find((item) => item.uploadId === uploadId);
  await writeQueue(queue.filter((item) => item.uploadId !== uploadId));
  if (removed) {
    try { new File(removed.fileUri).delete(); } catch { /* Queue metadata is authoritative. */ }
  }
}

function isPermanentUploadError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === 401 || status === 403) return false;
  return typeof status === 'number' && status >= 400 && status < 500
    && status !== 408 && status !== 429;
}

async function markBlocked(uploadId: string, message: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map((item) => item.uploadId === uploadId
    ? { ...item, blockedMessage: message }
    : item));
}

let flushInProgress: Promise<number[]> | null = null;

/** Retries one file at a time; upload IDs make server retries idempotent. */
export function flushEvidenceQueue(ownerIdentification: string): Promise<number[]> {
  if (flushInProgress) return flushInProgress;
  flushInProgress = (async () => {
    const uploadedTaskIds: number[] = [];
    const network = await Network.getNetworkStateAsync();
    if (!network.isConnected || network.isInternetReachable === false) return uploadedTaskIds;
    const queue = (await readQueue())
      .filter((item) => item.ownerIdentification === ownerIdentification && !item.blockedMessage)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const item of queue) {
      try {
        const file = new File(item.fileUri);
        if (!file.exists) {
          await markBlocked(item.uploadId, 'No se encontró el archivo guardado en el dispositivo.');
          continue;
        }
        await tareasService.uploadEvidence(item.taskId, [{
          uri: item.fileUri,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
          durationMs: item.durationMs,
          capturedAt: item.capturedAt,
          latitude: item.latitude,
          longitude: item.longitude,
          clientUploadId: item.uploadId,
        }], 120_000);
        await removeQueuedEvidence(item.uploadId);
        uploadedTaskIds.push(item.taskId);
      } catch (error) {
        if (isPermanentUploadError(error)) {
          const message = isAxiosError(error)
            ? String((error.response?.data as { detail?: unknown } | undefined)?.detail
              ?? 'El servidor rechazó esta evidencia. Revisa la tarea antes de reintentar.')
            : 'El servidor rechazó esta evidencia.';
          await markBlocked(item.uploadId, message);
          continue;
        }
        // A network/5xx failure stops the loop; keep this and later files queued.
        break;
      }
    }
    return [...new Set(uploadedTaskIds)];
  })().finally(() => { flushInProgress = null; });
  return flushInProgress;
}

export async function retryBlockedEvidence(taskId: number): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map((item) => item.taskId === taskId
    ? { ...item, blockedMessage: undefined }
    : item));
}
