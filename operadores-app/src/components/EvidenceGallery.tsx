import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { httpClient } from '../api/httpClient';
import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { VideoView, useVideoPlayer } from 'expo-video';
import { tareasService } from '../services/tareasService';
import { tokenStorage } from '../services/tokenStorage';
import { colors, radius, spacing, typography } from '../theme';
import type { TaskEvidence, TaskEvidenceType } from '../types/tarea';

type EvidenceGalleryProps = {
  taskId: number;
  evidences: TaskEvidence[];
  emptyMessage: string;
};

type EvidenceAction = 'download' | 'share';

const CACHE_DIRECTORY = 'evidencias';
const STORED_FILENAME_PREFIX = /^[0-9a-f]{8}_/;
const DOUBLE_TAP_DELAY = 300;
const ZOOM_SCALE = 2.5;

export function EvidenceGallery({
  taskId,
  evidences,
  emptyMessage,
}: EvidenceGalleryProps) {
  const headers = useEvidenceAuthHeaders();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (!evidences.length) {
    return (
      <View style={styles.emptyEvidence}>
        <Text style={styles.emptyEvidenceText}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <View style={styles.gallery}>
      <View style={styles.grid}>
        {evidences.map((evidence, index) => (
          <EvidenceCard
            key={evidence.nombre}
            evidence={evidence}
            headers={headers}
            onPress={() => setActiveIndex(index)}
            taskId={taskId}
          />
        ))}
      </View>
      <EvidenceViewer
        evidences={evidences}
        headers={headers}
        index={activeIndex}
        onChangeIndex={setActiveIndex}
        onClose={() => setActiveIndex(null)}
        taskId={taskId}
      />
    </View>
  );
}

function EvidenceCard({
  taskId,
  evidence,
  headers,
  onPress,
}: {
  taskId: number;
  evidence: TaskEvidence;
  headers: Record<string, string> | undefined;
  onPress: () => void;
}) {
  const [hasPreviewError, setHasPreviewError] = useState(false);
  const [isPreviewLoaded, setPreviewLoaded] = useState(false);
  const [useOriginalPreview, setUseOriginalPreview] = useState(false);
  const { isLoading, uri: previewUri } = useEvidenceSource(
    taskId,
    evidence,
    headers,
    !useOriginalPreview,
  );
  const isImage = evidence.tipo === 'image';
  const showImage = isImage && !hasPreviewError && previewUri !== null;

  return (
    <Pressable
      accessibilityLabel={`Abrir evidencia ${getEvidenceDisplayName(evidence.nombre)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardPreview}>
        {showImage ? (
          <Image
            onError={() => {
              if (!useOriginalPreview) {
                setPreviewLoaded(false);
                setUseOriginalPreview(true);
              } else {
                setHasPreviewError(true);
              }
            }}
            onLoad={() => setPreviewLoaded(true)}
            resizeMode="cover"
            source={{ uri: previewUri, headers }}
            style={styles.cardImage}
          />
        ) : isImage && isLoading ? (
          <View style={styles.cardLoadingState}>
            <ActivityIndicator color={colors.white} />
            <Text style={styles.cardLoadingText}>Cargando...</Text>
          </View>
        ) : (
          <View style={styles.cardPlaceholder}>
            <Text style={styles.cardPlaceholderIcon}>{isImage ? '▧' : '▶'}</Text>
            <Text style={styles.cardPlaceholderLabel}>
              {isImage ? 'IMAGEN' : 'VIDEO'}
            </Text>
          </View>
        )}
        {showImage && !isPreviewLoaded ? (
          <View style={styles.cardLoadingOverlay} pointerEvents="none">
            <ActivityIndicator color={colors.white} />
          </View>
        ) : null}
        {!isImage ? (
          <View style={styles.playBadge}>
            <Text style={styles.playBadgeText}>▶</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.cardName}>
        {getEvidenceDisplayName(evidence.nombre)}
      </Text>
      <Text style={styles.cardMeta}>
        {isImage ? 'Imagen' : 'Video'} · {formatEvidenceDate(evidence.fecha)}
      </Text>
    </Pressable>
  );
}

function EvidenceViewer({
  taskId,
  evidences,
  headers,
  index,
  onChangeIndex,
  onClose,
}: {
  taskId: number;
  evidences: TaskEvidence[];
  headers: Record<string, string> | undefined;
  index: number | null;
  onChangeIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dismissSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          index !== null &&
          gesture.numberActiveTouches === 1 &&
          ((gesture.x0 <= width * 0.18 && gesture.dx > 42 && Math.abs(gesture.dy) < 70) ||
            (gesture.dy > 72 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2)),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx >= 84 || gesture.dy >= 120) onClose();
        },
      }),
    [index, onClose, width],
  );
  const [busyAction, setBusyAction] = useState<EvidenceAction | null>(null);
  const { headers: sourceHeaders, isLoading, uri: sourceUri } = useEvidenceSource(
    taskId,
    index === null ? null : evidences[index],
    headers,
  );

  if (index === null) return null;

  const evidence = evidences[index];
  const isImage = evidence.tipo === 'image';
  const displayName = getEvidenceDisplayName(evidence.nombre);
  const stageHeight = Math.round(height * 0.42);

  const runAction = async (action: EvidenceAction) => {
    setBusyAction(action);
    try {
      if (Platform.OS === 'web') {
        await runWebEvidenceAction(taskId, evidence, action);
      } else {
        const file = await downloadEvidenceFile(taskId, evidence);
        if (action === 'share') {
          await shareEvidenceFile(file, evidence);
        } else {
          await saveEvidenceToDevice(file);
          Alert.alert(
            'Evidencia descargada',
            `"${displayName}" se guardó en la galería de tu dispositivo.`,
          );
        }
      }
    } catch (error) {
      Alert.alert('Acción no completada', getEvidenceActionError(error, action));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.viewerBackdrop} {...dismissSwipe.panHandlers}>
        <StatusBar style="light" />
        <View style={[styles.viewerHeader, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="Cerrar visor de evidencias"
            accessibilityHint="Cierra la evidencia y vuelve a la tarea"
            hitSlop={12}
            accessibilityRole="button"
            onPress={onClose}
            style={styles.viewerClose}
          >
            <Text style={styles.viewerCloseText}>✕</Text>
          </Pressable>
          <Text style={styles.viewerCounter}>
            {index + 1} de {evidences.length}
          </Text>
          <View style={styles.viewerClose} pointerEvents="none" />
        </View>

        <View style={[styles.viewerStage, { height: stageHeight }]}>
          {isImage ? (
            <ResolvedZoomableImage
              headers={sourceHeaders ?? headers}
              height={stageHeight}
              isLoading={isLoading}
              uri={sourceUri}
              width={width}
            />
          ) : (
            <EvidenceVideoPlayer
              headers={sourceHeaders ?? headers}
              height={stageHeight}
              isLoading={isLoading}
              uri={sourceUri}
              width={width}
            />
          )}
        </View>

        <View style={styles.viewerNav}>
          <Pressable
            accessibilityLabel="Evidencia anterior"
            accessibilityRole="button"
            accessibilityState={{ disabled: index === 0 }}
            disabled={index === 0}
            onPress={() => onChangeIndex(index - 1)}
            style={[styles.viewerNavButton, index === 0 && styles.viewerNavButtonDisabled]}
          >
            <Text style={styles.viewerNavText}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Evidencia siguiente"
            accessibilityRole="button"
            accessibilityState={{ disabled: index === evidences.length - 1 }}
            disabled={index === evidences.length - 1}
            onPress={() => onChangeIndex(index + 1)}
            style={[
              styles.viewerNavButton,
              index === evidences.length - 1 && styles.viewerNavButtonDisabled,
            ]}
          >
            <Text style={styles.viewerNavText}>›</Text>
          </Pressable>
        </View>

        <View style={styles.viewerFooter}>
          <Text numberOfLines={1} style={styles.viewerName}>
            {displayName}
          </Text>
          <Text style={styles.viewerMeta}>
            {isImage ? 'Imagen' : 'Video'} · Cargada el{' '}
            {formatEvidenceDate(evidence.fecha)}
          </Text>
          {isImage && Platform.OS !== 'ios' ? (
            <Text style={styles.viewerHint}>
              Doble toque sobre la imagen para ampliar.
            </Text>
          ) : null}

          <View style={styles.viewerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: busyAction === 'download' }}
                disabled={busyAction !== null}
                onPress={() => void runAction('download')}
                style={styles.viewerAction}
              >
                {busyAction === 'download' ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.viewerActionText}>Descargar</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: busyAction === 'share' }}
                disabled={busyAction !== null}
                onPress={() => void runAction('share')}
                style={styles.viewerAction}
              >
                {busyAction === 'share' ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.viewerActionText}>Compartir</Text>
                )}
              </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ResolvedZoomableImage({
  uri,
  headers,
  isLoading,
  width,
  height,
}: {
  uri: string | null;
  headers?: Record<string, string>;
  isLoading: boolean;
  width: number;
  height: number;
}) {
  if (isLoading || !uri) {
    return (
      <View style={[styles.loadingStage, { height, width }]}>
        <ActivityIndicator color={colors.white} />
        <Text style={styles.loadingStageText}>Cargando imagen...</Text>
      </View>
    );
  }

  return <ZoomableImage headers={headers} height={height} uri={uri} width={width} />;
}

function ZoomableImage({
  uri,
  headers,
  width,
  height,
}: {
  uri: string;
  headers?: Record<string, string>;
  width: number;
  height: number;
}) {
  const [scale, setScale] = useState(1);
  const lastTap = useRef(0);

  if (Platform.OS === 'ios') {
    return (
      <ScrollView
        centerContent
        contentContainerStyle={styles.zoomContent}
        maximumZoomScale={6}
        minimumZoomScale={1}
        style={{ height, width }}
      >
        <Image
          resizeMode="contain"
          source={{ uri, headers }}
          style={{ height, width }}
        />
      </ScrollView>
    );
  }

  const toggleZoom = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      lastTap.current = 0;
      setScale((current) => (current > 1 ? 1 : ZOOM_SCALE));
      return;
    }
    lastTap.current = now;
  };

  return (
    <ScrollView contentContainerStyle={styles.zoomContent} style={{ height, width }}>
      <ScrollView contentContainerStyle={styles.zoomContent} horizontal>
        <Pressable accessibilityRole="imagebutton" onPress={toggleZoom}>
          <Image
            resizeMode="contain"
            source={{ uri, headers }}
            style={{ height: height * scale, width: width * scale }}
          />
        </Pressable>
      </ScrollView>
    </ScrollView>
  );
}

function EvidenceVideoPlayer({
  uri,
  headers,
  isLoading,
  width,
  height,
}: {
  uri: string | null;
  headers: Record<string, string> | undefined;
  isLoading: boolean;
  width: number;
  height: number;
}) {
  const player = useVideoPlayer(uri ? { headers, uri } : null, (instance) => {
    instance.loop = false;
  });

  if (isLoading || !uri) {
    return (
      <View style={[styles.loadingStage, { height, width }]}>
        <ActivityIndicator color={colors.white} />
        <Text style={styles.loadingStageText}>Cargando video...</Text>
      </View>
    );
  }

  return (
    <VideoView
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      nativeControls
      player={player}
      style={{ height, width }}
    />
  );
}

function useEvidenceAuthHeaders(): Record<string, string> | undefined {
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(
    undefined,
  );

  useEffect(() => {
    let isMounted = true;
    void tokenStorage.get().then((token) => {
      if (isMounted) {
        setHeaders(token ? { Authorization: `Bearer ${token}` } : undefined);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return headers;
}

function useEvidenceSource(
  taskId: number,
  evidence: TaskEvidence | null,
  headers: Record<string, string> | undefined,
  thumbnail = false,
): {
  uri: string | null;
  headers?: Record<string, string>;
  isLoading: boolean;
} {
  const [uri, setUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | null = null;

    if (!evidence) {
      return () => {
        isMounted = false;
      };
    }

    if (Platform.OS !== 'web') {
      return () => {
        isMounted = false;
      };
    }

    void (async () => {
      setUri(null);
      setIsLoading(true);
      try {
        const response = await httpClient.get<Blob>(
          thumbnail
            ? tareasService.evidenceThumbnailUrl(taskId, evidence.nombre)
            : tareasService.evidenceUrl(taskId, evidence.nombre),
          { responseType: 'blob' },
        );
        objectUrl = URL.createObjectURL(response.data);
        if (isMounted) {
          setUri(objectUrl);
        }
      } catch (error) {
        if (thumbnail) {
          try {
            const fallbackResponse = await httpClient.get<Blob>(
              tareasService.evidenceUrl(taskId, evidence.nombre),
              { responseType: 'blob' },
            );
            objectUrl = URL.createObjectURL(fallbackResponse.data);
            if (isMounted) {
              setUri(objectUrl);
            }
            return;
          } catch {
            // Both the optimized thumbnail and original image failed.
          }
        }
        console.warn(
          `No fue posible preparar la evidencia ${evidence.nombre} para visualización:`,
          error,
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [evidence, headers, taskId, thumbnail]);

  return {
    headers: Platform.OS !== 'web' ? headers : undefined,
    isLoading: Platform.OS === 'web' ? isLoading : false,
    uri: Platform.OS === 'web'
      ? uri
      : evidence
        ? thumbnail && evidence.tipo === 'image'
          ? tareasService.evidenceThumbnailUrl(taskId, evidence.nombre)
          : tareasService.evidenceUrl(taskId, evidence.nombre)
        : null,
  };
}

async function downloadEvidenceFile(
  taskId: number,
  evidence: TaskEvidence,
): Promise<ExpoFile> {
  const token = await tokenStorage.get();
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY);
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }

  const localName = `${taskId}-${evidence.nombre.replace(/[^\w.-]/g, '_')}`;
  const target = new ExpoFile(directory, localName);
  if (target.exists && target.size > 0) return target;
  if (target.exists) target.delete();

  return ExpoFile.downloadFileAsync(
    tareasService.evidenceDownloadUrl(taskId, evidence.nombre),
    target,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    },
  );
}

async function saveEvidenceToDevice(file: ExpoFile): Promise<void> {
  const isAvailable = await MediaLibrary.isAvailableAsync();
  if (!isAvailable) throw new Error('media-library-unavailable');

  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('media-library-permission');

  await MediaLibrary.saveToLibraryAsync(file.uri);
}

async function shareEvidenceFile(
  file: ExpoFile,
  evidence: TaskEvidence,
): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) throw new Error('sharing-unavailable');

  await Sharing.shareAsync(file.uri, {
    dialogTitle: 'Compartir evidencia',
    mimeType: getEvidenceMimeType(evidence.nombre, evidence.tipo),
  });
}

async function runWebEvidenceAction(
  taskId: number,
  evidence: TaskEvidence,
  action: EvidenceAction,
): Promise<void> {
  const response = await httpClient.get<Blob>(
    tareasService.evidenceDownloadUrl(taskId, evidence.nombre),
    { responseType: 'blob' },
  );
  const blob = response.data;
  const objectUrl = URL.createObjectURL(blob);
  const fileName = getEvidenceDisplayName(evidence.nombre);

  try {
    if (action === 'share' && navigator.share && typeof window.File === 'function') {
      const browserFile = new window.File([blob], fileName, {
        type: getEvidenceMimeType(evidence.nombre, evidence.tipo),
      });
      await navigator.share({
        files: [browserFile],
        title: fileName,
      });
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getEvidenceActionError(
  error: unknown,
  action: EvidenceAction,
): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'media-library-permission') {
    return 'Concede permiso de acceso a la galería para guardar la evidencia en tu dispositivo.';
  }
  if (code === 'media-library-unavailable') {
    return 'La galería de este dispositivo no está disponible.';
  }
  if (code === 'sharing-unavailable') {
    return 'Este dispositivo no permite compartir archivos.';
  }
  return action === 'share'
    ? 'No fue posible compartir la evidencia. Inténtalo nuevamente.'
    : 'No fue posible descargar la evidencia. Inténtalo nuevamente.';
}

function getEvidenceDisplayName(nombre: string): string {
  return nombre.replace(STORED_FILENAME_PREFIX, '') || nombre;
}

function getEvidenceMimeType(nombre: string, tipo: TaskEvidenceType): string {
  const extension = nombre.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  return tipo === 'video' ? 'video/mp4' : 'image/jpeg';
}

function formatEvidenceDate(value: string): string {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  gallery: {
    gap: spacing.medium,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.small,
  },
  card: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    overflow: 'hidden',
    width: '48%',
  },
  cardPressed: {
    opacity: 0.82,
  },
  cardPreview: {
    backgroundColor: colors.whiteMuted,
    height: 132,
    overflow: 'hidden',
    width: '100%',
  },
  cardLoadingState: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    gap: spacing.xsmall,
    height: '100%',
    justifyContent: 'center',
  },
  cardLoadingText: {
    color: colors.whiteMuted,
    fontSize: typography.overline,
    fontWeight: '700',
  },
  cardLoadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(28, 25, 25, 0.45)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cardImage: {
    backgroundColor: colors.whiteMuted,
    height: 132,
    width: '100%',
  },
  cardPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    gap: spacing.xsmall,
    height: '100%',
    justifyContent: 'center',
  },
  cardPlaceholderIcon: {
    color: colors.white,
    fontSize: 30,
  },
  cardPlaceholderLabel: {
    color: colors.whiteMuted,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  playBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: radius.pill,
    height: 38,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -19,
    marginTop: -19,
    position: 'absolute',
    top: '50%',
    width: 38,
  },
  playBadgeText: {
    color: colors.white,
    fontSize: 16,
    marginLeft: 3,
  },
  cardName: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: '700',
    paddingHorizontal: spacing.small,
    paddingTop: spacing.small,
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: typography.overline,
    paddingBottom: spacing.small,
    paddingHorizontal: spacing.small,
    paddingTop: 2,
  },
  emptyEvidence: {
    alignItems: 'center',
    backgroundColor: '#FFFAFA',
    borderRadius: radius.medium,
    padding: spacing.medium,
  },
  emptyEvidenceText: {
    color: colors.textMuted,
    fontSize: typography.small,
    textAlign: 'center',
  },
  viewerBackdrop: {
    backgroundColor: 'rgba(12, 10, 10, 0.96)',
    flex: 1,
    paddingBottom: spacing.large,
  },
  viewerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    zIndex: 5,
    paddingHorizontal: spacing.medium,
  },
  viewerClose: {
    alignItems: 'center',
    elevation: 8,
    height: 48,
    justifyContent: 'center',
    minWidth: 48,
    width: 48,
    zIndex: 8,
  },
  viewerCloseText: {
    color: colors.white,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  viewerCounter: {
    color: colors.whiteMuted,
    fontSize: typography.small,
    fontWeight: '700',
  },
  viewerStage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  loadingStage: {
    alignItems: 'center',
    gap: spacing.small,
    justifyContent: 'center',
  },
  loadingStageText: {
    color: colors.whiteMuted,
    fontSize: typography.small,
  },
  zoomContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.large,
  },
  viewerNavButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  viewerNavButtonDisabled: {
    opacity: 0.3,
  },
  viewerNavText: {
    color: colors.white,
    fontSize: 26,
    lineHeight: 30,
  },
  viewerFooter: {
    gap: spacing.xsmall,
    marginTop: 'auto',
    paddingHorizontal: spacing.large,
    paddingTop: spacing.medium,
  },
  viewerName: {
    color: colors.white,
    fontSize: typography.body,
    fontWeight: '800',
  },
  viewerMeta: {
    color: colors.whiteMuted,
    fontSize: typography.small,
  },
  viewerHint: {
    color: colors.textMuted,
    fontSize: typography.overline,
  },
  viewerActions: {
    flexDirection: 'row',
    gap: spacing.small,
    marginTop: spacing.small,
  },
  viewerAction: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.medium,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  viewerActionText: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '800',
  },
});
