import { useQuery } from '@tanstack/react-query';
import { tareasService } from '../services/tareasService';

export function useTareas(enabled: boolean) {
  return useQuery({
    queryKey: ['tareas'],
    queryFn: tareasService.getAll,
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}
