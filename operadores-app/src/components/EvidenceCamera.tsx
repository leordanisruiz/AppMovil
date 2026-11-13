import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';
import type { TaskEvidenceAsset } from '../types/tarea';

type CaptureMode = 'photo' | 'video';

export function EvidenceCamera({
  mode, onClose, onCapture,
}: {
  mode: CaptureMode;
  onClose: () => void;
  onCapture: (asset: TaskEvidenceAsset) => void;
}) {
  const camera = useRef<CameraView>(null);
  const webVideo = useRef<HTMLVideoElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(false);
  const capturing = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [, requestMicrophonePermission] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let open = true;
    active.current = true;
    let stream: MediaStream | null = null;
    const openCamera = async () => {
      try {
        if (Platform.OS === 'web') {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('La cámara requiere HTTPS o localhost y un navegador compatible.');
          }
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (!open) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          if (!webVideo.current) throw new Error('No fue posible mostrar la cámara.');
          webVideo.current.srcObject = stream;
          await webVideo.current.play();
          if (open) setReady(true);
        } else {
          const permission = await requestCameraPermission();
          if (!permission.granted && open) {
            setError('Debes permitir el acceso a la cámara para tomar evidencias.');
          }
        }
      } catch (cause) {
        if (open) setError(cause instanceof Error ? cause.message : 'No fue posible abrir la cámara.');
      }
    };
    void openCamera();
    return () => {
      open = false;
      active.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [mode, requestCameraPermission]);

  const capture = async () => {
    if (!ready || capturing.current) return;
    capturing.current = true;
    setBusy(true);
    setError(null);
    let audio: MediaStream | null = null;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active.current) return;
      if (!permission.granted) {
        throw new Error('Debes permitir la ubicación para agregar cada evidencia. Revisa los permisos del dispositivo.');
      }
      if (mode === 'video' && Platform.OS !== 'web') {
        const microphone = await requestMicrophonePermission();
        if (!active.current) return;
        if (!microphone.granted) throw new Error('Debes permitir el micrófono para grabar videos.');
      }
      if (mode === 'video' && Platform.OS === 'web') {
        if (!MediaRecorder.isTypeSupported('video/mp4')) {
          throw new Error('Este navegador no permite grabar video MP4. Usa la aplicación móvil u otro navegador compatible.');
        }
        audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active.current) return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No fue posible obtener la ubicación. Activa el GPS e inténtalo nuevamente.')), 20000)),
      ]);
      if (!active.current) return;
      if (!Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 30000) {
        throw new Error('La ubicación no está actualizada. Activa el GPS e inténtalo nuevamente.');
      }
      if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)
          || Math.abs(position.coords.latitude) > 90 || Math.abs(position.coords.longitude) > 180) {
        throw new Error('La ubicación obtenida no es válida. Inténtalo nuevamente.');
      }
      const capturedAt = new Date().toISOString();
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (mode === 'photo') {
        if (Platform.OS === 'web') {
          const video = webVideo.current;
          if (!video || !video.videoWidth || !video.videoHeight) throw new Error('La cámara aún no está lista.');
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('No fue posible capturar la imagen.');
          context.drawImage(video, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No fue posible guardar la imagen.')), 'image/jpeg', 0.9),
          );
          if (!active.current) return;
          onCapture({ uri: URL.createObjectURL(blob), webFile: blob, name: `foto-${Date.now()}.jpg`, mimeType: 'image/jpeg', size: blob.size, capturedAt, ...location });
        } else {
          const picture = await camera.current?.takePictureAsync({ quality: 0.9 });
          if (!active.current) return;
          if (!picture) throw new Error('No fue posible capturar la imagen.');
          onCapture({ uri: picture.uri, name: `foto-${Date.now()}.jpg`, mimeType: 'image/jpeg', capturedAt, ...location });
        }
      } else if (Platform.OS === 'web') {
        const videoStream = webVideo.current?.srcObject;
        if (!(videoStream instanceof MediaStream)) throw new Error('La cámara aún no está lista.');
        const combined = new MediaStream([...videoStream.getVideoTracks(), ...audio!.getAudioTracks()]);
        const mediaRecorder = new MediaRecorder(combined, { mimeType: 'video/mp4' });
        recorder.current = mediaRecorder;
        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        const result = new Promise<Blob>((resolve, reject) => {
          mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }));
          mediaRecorder.onerror = () => reject(new Error('No fue posible grabar el video.'));
        });
        mediaRecorder.start();
        setRecording(true);
        const timer = setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 180000);
        try {
          const blob = await result;
          if (!active.current) return;
          if (!blob.size) throw new Error('El video grabado está vacío.');
          onCapture({ uri: URL.createObjectURL(blob), webFile: blob, name: `video-${Date.now()}.mp4`, mimeType: 'video/mp4', size: blob.size, capturedAt, ...location });
        } finally {
          clearTimeout(timer);
          recorder.current = null;
        }
      } else {
        if (!camera.current) throw new Error('La cámara aún no está lista.');
        setRecording(true);
        const video = await camera.current.recordAsync({ maxDuration: 180 });
        if (!active.current) return;
        if (!video) throw new Error('No fue posible grabar el video.');
        const isMov = Platform.OS === 'ios';
        onCapture({ uri: video.uri, name: `video-${Date.now()}.${isMov ? 'mov' : 'mp4'}`, mimeType: isMov ? 'video/quicktime' : 'video/mp4', capturedAt, ...location });
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'No fue posible capturar la evidencia.');
    } finally {
      audio?.getTracks().forEach((track) => track.stop());
      capturing.current = false;
      if (active.current) {
        setRecording(false);
        setBusy(false);
      }
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.container}>
        {Platform.OS === 'web'
          ? <video ref={webVideo} muted playsInline style={{ width: '100%', flex: 1, objectFit: 'contain' }} />
          : cameraPermission?.granted ? <CameraView ref={camera} mode={mode === 'video' ? 'video' : 'picture'} style={styles.preview}
              onCameraReady={() => setReady(true)} onMountError={(event) => setError(event.message)} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>La ubicación es obligatoria para cada evidencia.</Text>
        <View style={styles.actions}>
          <Pressable disabled={busy} onPress={onClose} style={styles.button}><Text style={styles.text}>Cancelar</Text></Pressable>
          {recording ? (
            <Pressable onPress={() => {
              if (Platform.OS === 'web') {
                if (recorder.current?.state === 'recording') recorder.current.stop();
              } else {
                camera.current?.stopRecording();
              }
            }} style={styles.button}>
              <Text style={styles.text}>Detener grabación</Text>
            </Pressable>
          ) : (
            <Pressable disabled={!ready || busy} onPress={() => void capture()} style={styles.button}>
              {busy ? <ActivityIndicator color="white" /> : <Text style={styles.text}>{mode === 'photo' ? 'Tomar foto' : 'Grabar video'}</Text>}
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#171717' },
  preview: { flex: 1 },
  error: { color: '#fff', backgroundColor: '#8b2e00', padding: 12 },
  hint: { color: '#fff', padding: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', padding: 16 },
  button: { backgroundColor: '#d90000', borderRadius: 10, padding: 14, minWidth: 120, alignItems: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
