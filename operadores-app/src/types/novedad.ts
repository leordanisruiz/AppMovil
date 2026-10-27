export type Novedad = {
  IdNovedad: number;
  FechaNovedad: string | null;
  Codigo: number | string | null;
  TipoNovedad: string | null;
  Grupo: string | null;
  Subgrupo: string | null;
  Descripcion: string | null;
  Estado: string | null;
};

export type NovedadesResponse = {
  total: number;
  novedades: Novedad[];
};
