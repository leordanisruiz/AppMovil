import type { NovedadesResponse } from '../types/novedad';
import { httpClient } from '../api/httpClient';

export const novedadesService = {
  async getAll(codigoOperador: string): Promise<NovedadesResponse> {
    const operatorCode = codigoOperador.trim();
    if (!operatorCode) {
      throw new Error('No se puede consultar novedades sin código de operador.');
    }

    const response = await httpClient.post<NovedadesResponse>(
      '/novedades/consultar',
      { codigo_operador: operatorCode },
    );

    return response.data;
  },
};
