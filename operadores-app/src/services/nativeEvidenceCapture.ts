import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { TaskEvidenceAsset } from '../types/tarea';

export async function captureNativeEvidence(
  mode: 'photo' | 'video',
  maxVideoDurationSeconds: number,
  onPreparing?: (mode: 'photo' | 'video') => void,
): Promise<TaskEvidenceAsset | null> {
  const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
  if (!cameraPermission.granted) {
    throw new Error('Debes permitir el acceso a la cámara para tomar evidencias.');
  }
  if (mode === 'video') {
    const microphonePermission = await Camera.requestMicrophonePermissionsAsync();
    if (!microphonePermission.granted) {
      throw new Error('Debes permitir el micrófono para grabar videos.');
    }
  }
  const locationPermission = await Location.requestForegroundPermissionsAsync();
  if (!locationPermission.granted) {
    throw new Error('Debes permitir la ubicación para agregar cada evidencia. Revisa los permisos del dispositivo.');
  }

  if (mode === 'video') onPreparing?.('video');
  const result = await ImagePicker.launchCameraAsync(mode === 'photo'
    ? { mediaTypes: ['images'], quality: 0.9, exif: true }
    : { mediaTypes: ['videos'], videoMaxDuration: maxVideoDurationSeconds });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) throw new Error('La cámara no devolvió una evidencia.');
  if (mode === 'photo') onPreparing?.('photo');
  const capturedAt = new Date().toISOString();
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (!Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 30000) {
    throw new Error('La ubicación no está actualizada. Activa el GPS e inténtalo nuevamente.');
  }
  if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)
      || Math.abs(position.coords.latitude) > 90 || Math.abs(position.coords.longitude) > 180) {
    throw new Error('La ubicación obtenida no es válida. Inténtalo nuevamente.');
  }

  const mimeType = mode === 'photo'
    ? normalizePhotoMimeType(asset.mimeType, asset.fileName ?? asset.uri)
    : asset.mimeType ?? (Platform.OS === 'ios' ? 'video/quicktime' : 'video/mp4');
  const extension = mode === 'photo'
    ? photoExtension(mimeType)
    : mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  // Camera providers sometimes return an extensionless or mismatched filename.
  // The API validates the MIME type together with the extension, so send a
  // canonical name matching the actual image format instead of the provider name.
  const name = mode === 'photo'
    ? `foto-${Date.now()}.${extension}`
    : asset.fileName?.toLowerCase().endsWith(`.${extension}`)
      ? asset.fileName
      : `video-${Date.now()}.${extension}`;

  return {
    uri: asset.uri,
    name,
    mimeType,
    size: asset.fileSize,
    durationMs: mode === 'video' ? asset.duration ?? undefined : undefined,
    capturedAt,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

function normalizePhotoMimeType(mimeType: string | null | undefined, fileName: string): string {
  const normalizedMime = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  const aliases: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/x-png': 'image/png',
    'image/heic-sequence': 'image/heic',
    'image/heif-sequence': 'image/heif',
  };
  const candidate = normalizedMime ? aliases[normalizedMime] ?? normalizedMime : '';
  if (PHOTO_EXTENSIONS[candidate]) return candidate;

  const extension = fileName.toLowerCase().match(/\.(jpe?g|png|webp|heic|heif)$/)?.[1];
  if (extension) {
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'heic') return 'image/heic';
    if (extension === 'heif') return 'image/heif';
  }

  // ImagePicker's camera result is an image; JPEG is the interoperable fallback
  // when a camera provider omits or mislabels its MIME type.
  return 'image/jpeg';
}

const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function photoExtension(mimeType: string): string {
  return PHOTO_EXTENSIONS[mimeType] ?? 'jpg';
}
