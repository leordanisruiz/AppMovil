import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import type { OperatorTask, TaskStatus } from '../types/tarea';

export type TaskStatusFilter = 'TODAS' | TaskStatus;

export function DesktopTasksTable({
  tasks,
  initialStatus = 'TODAS',
  onOpen,
}: {
  tasks: OperatorTask[];
  initialStatus?: TaskStatusFilter;
  onOpen: (task: OperatorTask) => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>(initialStatus);
  const [newestFirst, setNewestFirst] = useState(true);

  const filtered = useMemo(() => tasks
    .filter((task) => statusFilter === 'TODAS' || task.estado === statusFilter)
    .filter((task) => `${task.id} ${task.tipo_tarea} ${task.descripcion}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (new Date(a.fecha_creacion).getTime() - new Date(b.fecha_creacion).getTime()) * (newestFirst ? -1 : 1)), [newestFirst, query, statusFilter, tasks]);
  const filters: TaskStatusFilter[] = ['TODAS', 'PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CERRADO'];

  return (
    <View style={styles.layout}>
      <View style={styles.filterPanel}>
        <Text style={styles.filterTitle}>Filtros</Text>
        <Text style={styles.filterCaption}>ESTADO DE LA TAREA</Text>
        {filters.map((filter) => <Pressable key={filter} onPress={() => setStatusFilter(filter)} style={[styles.filterOption, statusFilter === filter && styles.filterOptionActive]}><Text style={[styles.filterOptionText, statusFilter === filter && styles.filterOptionTextActive]}>{statusLabel(filter)}</Text><Text style={styles.filterCount}>{filter === 'TODAS' ? tasks.length : tasks.filter((task) => task.estado === filter).length}</Text></Pressable>)}
      </View>
      <View style={styles.main}>
        <View style={styles.toolbar}><View><Text style={styles.heading}>Tareas</Text><Text style={styles.subheading}>{filtered.length} resultados</Text></View><View style={styles.controls}><TextInput accessibilityLabel="Buscar tareas" onChangeText={setQuery} placeholder="Buscar por tarea o descripción…" placeholderTextColor="#929AA4" style={styles.search} value={query}/><Pressable accessibilityRole="button" onPress={() => setNewestFirst((current) => !current)} style={styles.sortButton}><Text style={styles.sortText}>↕  Fecha {newestFirst ? 'más reciente' : 'más antigua'}</Text></Pressable></View></View>
        <View style={styles.table}>
          <View style={styles.tableHeader}><Text style={[styles.tableHeaderText, styles.taskColumn]}>TAREA</Text><Text style={[styles.tableHeaderText, styles.descriptionColumn]}>DESCRIPCIÓN</Text><Text style={[styles.tableHeaderText, styles.dateColumn]}>FECHA</Text><Text style={[styles.tableHeaderText, styles.evidenceColumn]}>EVIDENCIAS</Text><Text style={[styles.tableHeaderText, styles.statusColumn]}>ESTADO</Text><Text style={styles.arrowColumn}/></View>
          {filtered.map((task) => <Pressable key={task.id} onPress={() => onOpen(task)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}><View style={styles.taskColumn}><Text style={styles.taskId}>#{task.id}</Text><Text numberOfLines={1} style={styles.taskType}>{task.tipo_tarea}</Text></View><Text numberOfLines={2} style={[styles.cell, styles.descriptionColumn]}>{task.descripcion}</Text><Text style={[styles.cell, styles.dateColumn]}>{formatDate(task.fecha_creacion)}</Text><Text style={[styles.cell, styles.evidenceColumn]}>{task.evidencias.length} archivo{task.evidencias.length === 1 ? '' : 's'}</Text><View style={styles.statusColumn}><Text style={[styles.status, { backgroundColor: statusTone(task.estado).background, color: statusTone(task.estado).text }]}>● {statusLabel(task.estado)}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}
          {!filtered.length ? <View style={styles.noResults}><Text style={styles.cell}>No encontramos tareas con estos filtros.</Text></View> : null}
        </View>
      </View>
    </View>
  );
}

function statusLabel(status: TaskStatusFilter): string {
  if (status === 'TODAS') return 'Todos los estados';
  if (status === 'EN_PROCESO') return 'En proceso';
  if (status === 'COMPLETADA') return 'Completada';
  if (status === 'CERRADO') return 'Cerrada';
  return 'Pendiente';
}

function statusTone(status: TaskStatus) {
  if (status === 'CERRADO') return { background: '#EEF1F4', text: '#52606D' };
  if (status === 'COMPLETADA') return { background: '#E8F5EC', text: '#20845A' };
  if (status === 'EN_PROCESO') return { background: '#FFF4D8', text: '#A86A00' };
  return { background: '#FFF0F0', text: colors.danger };
}

function formatDate(value: string): string {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  layout: { alignItems: 'flex-start', flexDirection: 'row', gap: 20 },
  filterPanel: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.large, borderWidth: 1, gap: 7, padding: 16, width: 220 },
  filterTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  filterCaption: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  filterOption: { alignItems: 'center', borderRadius: 7, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 9, paddingVertical: 9 },
  filterOptionActive: { backgroundColor: '#FFF0F0' },
  filterOptionText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  filterOptionTextActive: { color: colors.primary, fontWeight: '800' },
  filterCount: { color: colors.textMuted, fontSize: 10 },
  main: { flex: 1, gap: 12, minWidth: 0 },
  toolbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  heading: { color: colors.text, fontSize: 16, fontWeight: '800' },
  subheading: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  controls: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  search: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.text, fontSize: 11, height: 38, paddingHorizontal: 12, width: 245 },
  sortButton: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.border, borderRadius: 8, borderWidth: 1, height: 38, justifyContent: 'center', paddingHorizontal: 12 },
  sortText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  table: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.medium, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { alignItems: 'center', backgroundColor: '#F7F8FA', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 43, paddingHorizontal: 15 },
  tableHeaderText: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  row: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 68, paddingHorizontal: 15, paddingVertical: 10 },
  rowPressed: { backgroundColor: '#FFF9F9' },
  taskColumn: { flex: 0.8, minWidth: 110 },
  descriptionColumn: { flex: 1.5, minWidth: 120 },
  dateColumn: { flex: 0.65, minWidth: 70 },
  evidenceColumn: { flex: 0.6, minWidth: 70 },
  statusColumn: { flex: 0.8, minWidth: 95 },
  taskId: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
  taskType: { color: colors.text, fontSize: 11, fontWeight: '800', marginTop: 4 },
  cell: { color: colors.textSecondary, fontSize: 10, lineHeight: 15 },
  status: { borderRadius: radius.pill, fontSize: 10, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 6 },
  arrowColumn: { width: 20 },
  arrow: { color: colors.primary, fontSize: 22, textAlign: 'right', width: 20 },
  noResults: { alignItems: 'center', padding: spacing.large },
});
