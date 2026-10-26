import { useQuery } from '@tanstack/react-query';
import { tareasService } from '../services/tareasService';

export function useTareasResumen(enabled: boolean) {
  return useQuery({
    queryKey: ['tareas', 'resumen', 'activas'],
    queryFn: tareasService.getNotClosedCount,
    enabled,
    staleTime: 30_000,
  });
}
