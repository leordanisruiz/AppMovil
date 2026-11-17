import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { CalendarDateInput } from './CalendarDateInput';
import { EvidenceGallery } from './EvidenceGallery';
import { useTareas } from '../hooks/useTareas';
import { useTareasCreadas } from '../hooks/useTareasCreadas';
import { useAuth } from '../store/AuthProvider';
import { colors } from '../theme';
import type { TaskEvidence } from '../types/tarea';

type LibraryEvidence = TaskEvidence & {
  taskId: number;
  operatorCode: string;
  taskLabel: string;
  taskDescription: string;
};

export function EvidenceLibrarySection({ operatorCode }: { operatorCode: string | null }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [pageState, setPageState] = useState({ key: '', page: 1 });
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
    return (!fromDate || stamp >= fromDate) && (!toDate || stamp <= toDate)
      && (!codeFilter.trim() || item.operatorCode.includes(codeFilter.trim()))
      && (!taskFilter.trim() || `${item.taskId} ${item.taskLabel} ${item.taskDescription}`.toLowerCase().includes(taskFilter.trim().toLowerCase()));
  });
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageKey = `${fromDate}\u0000${toDate}\u0000${codeFilter}\u0000${taskFilter}`;
  const currentPage = Math.min(pageState.key === pageKey ? pageState.page : 1, pageCount);
  const pageEvidence = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const changePage = (nextPage: number) => setPageState({ key: pageKey, page: nextPage });

  if (query.isLoading) return <ActivityIndicator color={colors.primary} style={{ padding: 40 }} />;
  if (query.isError) return <View style={{ backgroundColor: colors.white, borderRadius: 14, padding: 22 }}><Text style={{ color: colors.text }}>No fue posible cargar las evidencias. Vuelve a intentarlo desde el módulo de tareas.</Text></View>;

  return (
    <View style={{ gap: 12 }}>
      <View><Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>Todas las evidencias</Text><Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{filtered.length} archivos · Ordenadas por fecha más reciente</Text></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <CalendarDateInput label="Desde" value={fromDate} onChange={setFromDate} />
        <CalendarDateInput label="Hasta" value={toDate} onChange={setToDate} />
        <TextInput accessibilityLabel="Código del operador" placeholder="Código operador" value={codeFilter} onChangeText={setCodeFilter} keyboardType="numeric" style={filterStyle} />
        <TextInput accessibilityLabel="Filtrar por tarea" placeholder="Tarea o descripción" value={taskFilter} onChangeText={setTaskFilter} style={filterStyle} />
      </View>
      <EvidenceGallery
        emptyMessage="Todavía no hay evidencias cargadas en tus tareas."
        evidences={pageEvidence}
        taskId={0}
      />
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.textMuted, fontSize: 12 }}>{filtered.length ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} de ${filtered.length}` : '0 evidencias'}</Text><View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}><Pressable accessibilityRole="button" disabled={currentPage <= 1} onPress={() => changePage(currentPage - 1)}><Text style={{ color: currentPage <= 1 ? colors.textMuted : colors.primary, fontSize: 20 }}>‹</Text></Pressable><Text style={{ color: colors.text }}>{currentPage} / {pageCount}</Text><Pressable accessibilityRole="button" disabled={currentPage >= pageCount} onPress={() => changePage(currentPage + 1)}><Text style={{ color: currentPage >= pageCount ? colors.textMuted : colors.primary, fontSize: 20 }}>›</Text></Pressable></View></View>
    </View>
  );
}

const filterStyle = { backgroundColor: colors.white, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.text, fontSize: 12, minHeight: 40, paddingHorizontal: 10, width: 190 } as const;
