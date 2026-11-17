import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];

export function CalendarDateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [month, setMonth] = useState(() => value ? new Date(`${value}T12:00:00`) : new Date());
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const cells = useMemo(() => [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ], [daysInMonth, firstWeekday]);
  const selectedDay = value ? Number(value.slice(8, 10)) : null;
  const displayValue = value ? new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : label;

  const chooseDay = (day: number) => {
    onChange(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    setVisible(false);
  };

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${displayValue}. Abrir calendario`} onPress={() => { if (value) setMonth(new Date(`${value}T12:00:00`)); setVisible(true); }} style={styles.input}>
        <Text style={[styles.inputText, !value && styles.placeholder]}>{displayValue}</Text>
        <Text style={styles.calendarIcon}>▦</Text>
      </Pressable>
      <Modal animationType="fade" transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <Pressable accessibilityLabel="Cerrar calendario" accessibilityRole="button" onPress={() => setVisible(false)} style={styles.dismissArea} />
          <View style={styles.calendar}>
            <View style={styles.header}>
              <Pressable accessibilityLabel="Mes anterior" accessibilityRole="button" onPress={() => setMonth(new Date(year, monthIndex - 1, 1))} style={styles.monthButton}><Text style={styles.monthButtonText}>‹</Text></Pressable>
              <Text style={styles.monthTitle}>{new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(month)}</Text>
              <Pressable accessibilityLabel="Mes siguiente" accessibilityRole="button" onPress={() => setMonth(new Date(year, monthIndex + 1, 1))} style={styles.monthButton}><Text style={styles.monthButtonText}>›</Text></Pressable>
            </View>
            <View style={styles.grid}>
              {WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
              {cells.map((day, index) => day === null
                ? <View key={`empty-${index}`} style={styles.dayCell} />
                : <Pressable key={day} accessibilityRole="button" accessibilityLabel={`${day} ${monthIndex + 1} ${year}`} onPress={() => chooseDay(day)} style={[styles.dayCell, selectedDay === day && value.slice(0, 7) === `${year}-${String(monthIndex + 1).padStart(2, '0')}` && styles.daySelected]}><Text style={[styles.dayText, selectedDay === day && value.slice(0, 7) === `${year}-${String(monthIndex + 1).padStart(2, '0')}` && styles.daySelectedText]}>{day}</Text></Pressable>)}
            </View>
            <View style={styles.footer}>
              <Pressable accessibilityRole="button" onPress={() => { onChange(''); setVisible(false); }}><Text style={styles.clearText}>Limpiar</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => setVisible(false)}><Text style={styles.closeText}>Cerrar</Text></Pressable>
            </View>
          </View>
          <Pressable accessibilityLabel="Cerrar calendario" accessibilityRole="button" onPress={() => setVisible(false)} style={styles.dismissArea} />
        </View>
      </Modal>
    </>
  );
}

const styles = {
  input: { alignItems: 'center' as const, backgroundColor: colors.white, borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: 'row' as const, height: 40, justifyContent: 'space-between' as const, paddingHorizontal: 10, width: 190 },
  inputText: { color: colors.text, fontSize: 12 },
  placeholder: { color: colors.textMuted },
  calendarIcon: { color: colors.primary, fontSize: 17 },
  backdrop: { alignItems: 'center' as const, backgroundColor: 'rgba(20, 18, 18, 0.42)', flex: 1, justifyContent: 'center' as const, padding: spacing.medium },
  dismissArea: { ...({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const) },
  calendar: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.large, borderWidth: 1, maxWidth: 360, padding: spacing.medium, width: '100%' as const, zIndex: 1 },
  header: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginBottom: spacing.medium },
  monthTitle: { color: colors.text, fontSize: 16, fontWeight: '800' as const, textTransform: 'capitalize' as const },
  monthButton: { alignItems: 'center' as const, backgroundColor: '#FFF0F0', borderRadius: 20, height: 36, justifyContent: 'center' as const, width: 36 },
  monthButtonText: { color: colors.primary, fontSize: 24, lineHeight: 28 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  weekday: { color: colors.textMuted, fontSize: 11, fontWeight: '700' as const, paddingVertical: 8, textAlign: 'center' as const, width: `${100 / 7}%` as const },
  dayCell: { alignItems: 'center' as const, borderRadius: 20, height: 40, justifyContent: 'center' as const, width: `${100 / 7}%` as const },
  daySelected: { backgroundColor: colors.primary },
  dayText: { color: colors.text, fontSize: 13 },
  daySelectedText: { color: colors.white, fontWeight: '800' as const },
  footer: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginTop: spacing.medium },
  clearText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' as const },
  closeText: { color: colors.primary, fontSize: 13, fontWeight: '800' as const },
};
