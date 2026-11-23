import type { TaskEvidenceAsset } from '../types/tarea';

export const MAX_EVIDENCE_UPLOAD_BYTES = 1536 * 1024 * 1024;

export function isWithinEvidenceUploadLimit(
  assets: readonly Pick<TaskEvidenceAsset, 'size'>[],
): boolean {
  return assets.reduce((total, asset) => total + (asset.size ?? 0), 0)
    <= MAX_EVIDENCE_UPLOAD_BYTES;
}
