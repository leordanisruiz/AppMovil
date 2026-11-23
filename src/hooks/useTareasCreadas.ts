import { useQuery } from '@tanstack/react-query';
import { tareasService } from '../services/tareasService';

export function useTareasCreadas(enabled: boolean) {
  return useQuery({
    queryKey: ['tareas-creadas'],
    queryFn: tareasService.getCreated,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
