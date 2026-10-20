import { useQuery } from '@tanstack/react-query';
import { novedadesService } from '../services/novedadesService';

export function useNovedades(codigoOperador: string | null) {
  return useQuery({
    queryKey: ['novedades', codigoOperador],
    queryFn: () => {
      if (!codigoOperador) {
        throw new Error('El perfil del operador no tiene un código válido.');
      }

      return novedadesService.getAll(codigoOperador);
    },
    enabled: Boolean(codigoOperador),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
