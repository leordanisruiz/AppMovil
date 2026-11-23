import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { httpClient } from '../api/httpClient';
import { CalendarDateInput } from './CalendarDateInput';
import { downloadEvidenceFile, EvidenceGallery, getEvidenceSelectionKey, runWebEvidenceAction, saveEvidenceToDevice } from './EvidenceGallery';
import { useTareas } from '../hooks/useTareas';
import { useTareasCreadas } from '../hooks/useTareasCreadas';
import { useAuth } from '../store/AuthProvider';
import { colors } from '../theme';
import type { TaskEvidence } from '../types/tarea';
import { tareasService } from '../services/tareasService';

type LibraryEvidence = TaskEvidence & {
  taskId: number;
  operatorCode: string;
  taskLabel: string;
  taskDescription: string;
};

export function EvidenceLibrarySection({ operatorCode }: { operatorCode: string | null }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const { operator } = useAuth();
  const canAssignTasks = operator?.rolId === 1 || operator?.rolId === 2;
  const assigned = useTareas(Boolean(operatorCode) && !canAssignTasks);
  const created = useTareasCreadas(canAssignTasks);
  const query = canAssignTasks ? created : assigned;
  const tasks = query.data;
  const evidenceItems = useMemo(() => (tasks ?? []).flatMap((task) => task.evidencias.map((evidence): LibraryEvidence => ({
    ...evidence,
    taskId: task.id,
    operatorCode: String(task.operador_id),
    taskLabel: `Tarea #${task.id} · ${task.tipo_tarea}`,
    taskDescription: task.descripcion,
  }))).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()), [tasks]);
  const filtered = evidenceItems.filter((item) => {
    const stamp = item.fecha.slice(0, 10);
    const term = search.trim().toLowerCase();
    return (!fromDate || stamp >= fromDate) && (!toDate || stamp <= toDate)
      && (!term || `${item.operatorCode} ${item.taskId} ${item.taskLabel} ${item.taskDescription}`.toLowerCase().includes(term));
  });
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageKey = `${fromDate}\u0000${toDate}\u0000${search}`;
  const currentPage = Math.min(pageState.key === pageKey ? pageState.page : 1, pageCount);
  const pageEvidence = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedEvidence = evidenceItems.filter((item) => selectedKeys.includes(getEvidenceSelectionKey(item, 0)));
  const changePage = (nextPage: number) => setPageState({ key: pageKey, page: nextPage });

  const toggleEvidenceSelection = (key: string) => {
    if (selectedKeys.includes(key)) {
      setSelectedKeys((current) => current.filter((selected) => selected !== key));
    } else if (selectedKeys.length >= 100) {
      Alert.alert('Límite de selección', 'Puedes descargar hasta 100 evidencias por vez.');
    } else {
      setSelectedKeys((current) => [...current, key]);
    }
  };

  const downloadSelected = async () => {
    if (!selectedEvidence.length || isDownloading) return;
    setIsDownloading(true);
    try {
      if (selectedEvidence.length === 1) {
        const [evidence] = selectedEvidence;
        if (Platform.OS === 'web') {
          await runWebEvidenceAction(evidence.taskId, evidence, 'download');
        } else {
          const file = await downloadEvidenceFile(evidence.taskId, evidence);
          await saveEvidenceToDevice(file);
          Alert.alert('Evidencia descargada', 'La evidencia seleccionada se guardó en tu dispositivo.');
        }
      } else {
        const body = { evidencias: selectedEvidence.map(({ taskId, nombre }) => ({ tarea_id: taskId, nombre })) };
        if (Platform.OS === 'web') {
          const response = await httpClient.post<Blob>(tareasService.selectedEvidenceDownloadUrl(), body, { responseType: 'blob', timeout: 120_000 });
          const objectUrl = URL.createObjectURL(response.data);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = 'evidencias-seleccionadas.zip';
          anchor.rel = 'noopener';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(objectUrl);
        } else {
          const response = await httpClient.post<ArrayBuffer>(tareasService.selectedEvidenceDownloadUrl(), body, { responseType: 'arraybuffer', timeout: 120_000 });
          const directory = new Directory(Paths.cache, 'evidencias');
          if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
          const zipFile = new ExpoFile(directory, 'evidencias-seleccionadas.zip');
          if (zipFile.exists) zipFile.delete();
          await zipFile.write(new Uint8Array(response.data));
          if (!(await Sharing.isAvailableAsync())) throw new Error('sharing-unavailable');
          await Sharing.shareAsync(zipFile.uri, { dialogTitle: 'Guardar evidencias seleccionadas', mimeType: 'application/zip' });
        }
      }
      setSelectedKeys([]);
    } catch (error) {
      console.error('No se pudieron descargar las evidencias seleccionadas:', error);
      Alert.alert('Descarga no completada', selectedEvidence.length > 1
        ? 'No fue posible crear o descargar el ZIP de evidencias. Inténtalo nuevamente.'
        : 'No fue posible descargar la evidencia seleccionada. Inténtalo nuevamente.');
    } finally {
      setIsDownloading(false);
    }
  };

  if (query.isLoading) return <ActivityIndicator color={colors.primary} style={{ padding: 40 }} />;
  if (query.isError) return <View style={{ backgroundColor: colors.white, borderRadius: 14, padding: 22 }}><Text style={{ color: colors.text }}>No fue posible cargar las evidencias. Vuelve a intentarlo desde el módulo de tareas.</Text></View>;

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{filtered.length} archivos · Ordenadas por fecha más reciente</Text>
      <View style={filterGrid}>
        <View style={filterDateRow}>
          <CalendarDateInput label="Desde" value={fromDate} onChange={setFromDate} style={filterDateInput} />
          <CalendarDateInput label="Hasta" value={toDate} onChange={setToDate} style={filterDateInput} />
        </View>
        <View style={searchRow}>
          <TextInput accessibilityLabel="Buscar evidencia por tarea, descripción o código de operador" placeholder="Buscar tarea, descripción o código de operador..." value={search} onChangeText={setSearch} style={filterStyle} />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: selectedEvidence.length === 0 || isDownloading }} disabled={selectedEvidence.length === 0 || isDownloading} onPress={() => void downloadSelected()} style={[downloadButton, (selectedEvidence.length === 0 || isDownloading) && downloadButtonDisabled]}>
            {isDownloading ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={downloadIcon}>↓</Text>}
            <Text style={downloadButtonText}>{selectedEvidence.length ? `Descargar (${selectedEvidence.length})` : 'Descargar'}</Text>
          </Pressable>
        </View>
      </View>
      <EvidenceGallery
        emptyMessage="Todavía no hay evidencias cargadas en tus tareas."
        evidences={pageEvidence}
        selectionEnabled
        selectedEvidenceKeys={selectedKeys}
        onToggleEvidence={toggleEvidenceSelection}
        taskId={0}
      />
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.textMuted, fontSize: 12 }}>{filtered.length ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} de ${filtered.length}` : '0 evidencias'}</Text><View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}><Pressable accessibilityRole="button" disabled={currentPage <= 1} onPress={() => changePage(currentPage - 1)}><Text style={{ color: currentPage <= 1 ? colors.textMuted : colors.primary, fontSize: 20 }}>‹</Text></Pressable><Text style={{ color: colors.text }}>{currentPage} / {pageCount}</Text><Pressable accessibilityRole="button" disabled={currentPage >= pageCount} onPress={() => changePage(currentPage + 1)}><Text style={{ color: currentPage >= pageCount ? colors.textMuted : colors.primary, fontSize: 20 }}>›</Text></Pressable></View></View>
    </View>
  );
}

const filterGrid = { gap: 8 } as const;
const filterDateRow = { flexDirection: 'row' as const, gap: 8, width: '100%' as const };
const filterDateInput = { flex: 1, minWidth: 0 } as const;
const filterStyle = { backgroundColor: colors.white, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.text, flex: 1, fontSize: 12, minHeight: 42, minWidth: 0, paddingHorizontal: 10 };
const searchRow = { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 8, width: '100%' as const };
const downloadButton = { alignItems: 'center' as const, backgroundColor: colors.primary, borderRadius: 8, flexDirection: 'row' as const, gap: 6, justifyContent: 'center' as const, minHeight: 42, paddingHorizontal: 12 };
const downloadButtonDisabled = { backgroundColor: colors.textMuted, opacity: 0.65 };
const downloadButtonText = { color: colors.white, fontSize: 12, fontWeight: '800' as const };
const downloadIcon = { color: colors.white, fontSize: 18, fontWeight: '800' as const };
