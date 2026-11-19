import type { CategoriaNovedad, NovedadesResponse, NovedadesResumen } from '../types/novedad';
import { httpClient } from '../api/httpClient';

export const novedadesService = {
  async markViewed(categoria: CategoriaNovedad, idNovedad: number): Promise<void> {
    const response = await httpClient.post<{ registrada: boolean }>(
      '/novedades/vistas',
      { categoria, id_novedad: idNovedad },
    );
    if (!response.data.registrada) {
      throw new Error('No se confirmó la lectura de la novedad.');
    }
  },

  async getAll(codigoOperador: string): Promise<NovedadesResumen> {
    const operatorCode = codigoOperador.trim();
    if (!operatorCode) {
      throw new Error('No se puede consultar novedades sin código de operador.');
    }

    const [ico, inasistencias, danos, isv] = await Promise.all(
      (['ico', 'inasistencias', 'danos', 'isv'] as const).map((categoria) =>
        httpClient.post<NovedadesResponse>(
          '/novedades/consultar',
          { codigo_operador: operatorCode, categoria },
        ),
      ),
    );
    return {
      total: ico.data.total + inasistencias.data.total + danos.data.total + isv.data.total,
      categorias: { ico: ico.data, inasistencias: inasistencias.data, danos: danos.data, isv: isv.data },
    };
  },
};
