export type Novedad = {
  IdNovedad: number;
  FechaNovedad: string | null;
  Codigo: number | string | null;
  TipoNovedad: string | null;
  Grupo: string | null;
  Subgrupo: string | null;
  Descripcion: string | null;
  Estado: string | null;
  Vehiculo?: string | null;
  Ruta?: string | null;
  Vista: boolean;
};

export type NovedadesResponse = {
  total: number;
  novedades: Novedad[];
};

export type CategoriaNovedad = 'ico' | 'inasistencias' | 'isv' | 'danos';

export type NovedadesResumen = {
  total: number;
  categorias: Record<CategoriaNovedad, NovedadesResponse>;
};
