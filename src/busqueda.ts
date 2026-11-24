export type Fragmento = {
  texto: string;
  fuente: string;
  puntaje: number;
};

type Busqueda = {
  search(entrada: {
    query: string;
    ai_search_options?: {
      retrieval?: {
        retrieval_type?: "vector" | "keyword" | "hybrid";
        match_threshold?: number;
        max_num_results?: number;
        keyword_match_mode?: "and" | "or";
      };
    };
  }): Promise<{
    chunks?: Array<{
      text?: string;
      score?: number;
      item?: { key?: string };
    }>;
  }>;
};

export async function buscarConocimiento(busqueda: Busqueda, consulta: string): Promise<Fragmento[]> {
  const porPalabra = await buscar(busqueda, consulta, "keyword", 0);
  if (porPalabra.length > 0) return porPalabra;
  return buscar(busqueda, consulta, "hybrid", 0.35);
}

async function buscar(
  busqueda: Busqueda,
  consulta: string,
  tipo: "keyword" | "hybrid",
  umbral: number,
): Promise<Fragmento[]> {
  const resultado = await busqueda.search({
    query: consulta.slice(0, 1000),
    ai_search_options: {
      retrieval: {
        retrieval_type: tipo,
        match_threshold: umbral,
        max_num_results: 4,
        keyword_match_mode: "or",
      },
    },
  });

  return (resultado.chunks ?? [])
    .filter((chunk) => typeof chunk.text === "string" && chunk.text.trim().length > 0)
    .map((chunk) => ({
      texto: chunk.text!.trim().slice(0, 1200),
      fuente: chunk.item?.key ?? "documento",
      puntaje: typeof chunk.score === "number" ? chunk.score : 0,
    }));
}

export function contextoDe(fragmentos: Fragmento[]): string {
  return fragmentos
    .map((fragmento, indice) => `[${indice + 1}] ${fragmento.fuente}\n${fragmento.texto}`)
    .join("\n\n");
}
