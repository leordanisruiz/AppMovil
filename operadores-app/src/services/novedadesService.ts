import type { NovedadesResponse, NovedadesResumen } from '../types/novedad';
import { httpClient } from '../api/httpClient';

export const novedadesService = {
  async getAll(codigoOperador: string): Promise<NovedadesResumen> {
    const operatorCode = codigoOperador.trim();
    if (!operatorCode) {
      throw new Error('No se puede consultar novedades sin código de operador.');
    }

    const [ico, inasistencias] = await Promise.all(
      (['ico', 'inasistencias'] as const).map((categoria) =>
        httpClient.post<NovedadesResponse>(
          '/novedades/consultar',
          { codigo_operador: operatorCode, categoria },
        ),
      ),
    );
    return {
      total: ico.data.total + inasistencias.data.total,
      categorias: { ico: ico.data, inasistencias: inasistencias.data },
    };
  },
};
