export type IsvSeverity = 'lesionado' | 'fatalidad';

export function getIsvSeverity(subgrupo: string | null | undefined): IsvSeverity | null {
  const normalized = subgrupo?.toUpperCase() ?? '';
  if (normalized.includes('FATALIDAD')) return 'fatalidad';
  if (normalized.includes('LESIONADO')) return 'lesionado';
  return null;
}

export function getHighestIsvSeverity(
  novedades: readonly { Subgrupo: string | null }[],
): IsvSeverity | null {
  let severity: IsvSeverity | null = null;
  for (const novedad of novedades) {
    const current = getIsvSeverity(novedad.Subgrupo);
    if (current === 'fatalidad') return current;
    if (current === 'lesionado') severity = current;
  }
  return severity;
}
