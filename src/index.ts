interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * iNaturalist MCP — citizen-science species observations (free, no auth for read-only)
 *
 * API: https://api.inaturalist.org/v1/docs
 * Tools:
 * - search_observations: filter observations by taxon, place, date, threatened status
 * - search_taxa:         search for taxa by name
 * - top_species:         most-observed species in a place (auto-resolves place name)
 */


const BASE_URL = 'https://api.inaturalist.org/v1';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_observations',
    description:
      'Search citizen-science observations on iNaturalist. Filter by taxon name (e.g., "Pandion haliaetus" or "osprey"), place name ("California"), year, threatened status, or quality grade. Returns photographed sightings with coordinates, dates, and observer info. Pairs well with GBIF for cross-validation.',
    inputSchema: {
      type: 'object',
      properties: {
        taxon_name: { type: 'string', description: 'Scientific or common species/taxon name' },
        place: { type: 'string', description: 'Place name (country, state, park). Auto-resolved to place_id.' },
        year: { type: 'number', description: 'Filter to a specific year' },
        threatened: {
          type: 'boolean',
          description: 'Restrict to IUCN-threatened taxa',
        },
        quality_grade: {
          type: 'string',
          description: 'casual | needs_id | research (default: research)',
          enum: ['casual', 'needs_id', 'research'],
        },
        per_page: { type: 'number', description: 'Results per page (1-200, default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'search_taxa',
    description:
      'Search iNaturalist taxa by name (common or scientific). Returns taxon ID, rank, ancestry, conservation status, and photo URL. Use the taxon ID for downstream filters or to disambiguate look-alike species.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Common or scientific name' },
        rank: {
          type: 'string',
          description: 'Restrict to a rank (kingdom, phylum, class, order, family, genus, species)',
        },
        per_page: { type: 'number', description: 'Results per page (1-30, default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'top_species',
    description:
      'Most-frequently-observed species in a place over a date range. Auto-resolves place name to place_id. Returns ranked species with observation counts and taxonomic info. Great for "what wildlife lives here?" questions.',
    inputSchema: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Place name (country, state, park, etc.)' },
        year: { type: 'number', description: 'Restrict to a specific year (optional)' },
        per_page: { type: 'number', description: 'Top-N species (1-50, default 20)' },
      },
      required: ['place'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_observations':
      return searchObservations(args);
    case 'search_taxa':
      return searchTaxa(
        args.query as string,
        args.rank as string | undefined,
        (args.per_page as number) ?? 10,
      );
    case 'top_species':
      return topSpecies(
        args.place as string,
        args.year as number | undefined,
        (args.per_page as number) ?? 20,
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function resolvePlaceId(place: string): Promise<{ id: number; name: string } | null> {
  const params = new URLSearchParams({ q: place, per_page: '1' });
  const res = await fetch(`${BASE_URL}/places/autocomplete?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { id: number; display_name?: string; name?: string }[] };
  const first = data.results?.[0];
  if (!first) return null;
  return { id: first.id, name: first.display_name ?? first.name ?? place };
}

async function resolveTaxonId(name: string): Promise<{ id: number; name: string } | null> {
  const params = new URLSearchParams({ q: name, per_page: '1' });
  const res = await fetch(`${BASE_URL}/taxa/autocomplete?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { id: number; name?: string; preferred_common_name?: string }[] };
  const first = data.results?.[0];
  if (!first) return null;
  return { id: first.id, name: first.preferred_common_name ?? first.name ?? name };
}

async function searchObservations(args: Record<string, unknown>) {
  const params = new URLSearchParams({
    per_page: String(Math.min(200, Math.max(1, (args.per_page as number) ?? 20))),
    order_by: 'observed_on',
    quality_grade: (args.quality_grade as string) ?? 'research',
  });

  const resolved: { taxon?: { id: number; name: string }; place?: { id: number; name: string } } = {};

  if (args.taxon_name) {
    const t = await resolveTaxonId(args.taxon_name as string);
    if (t) {
      params.set('taxon_id', String(t.id));
      resolved.taxon = t;
    }
  }
  if (args.place) {
    const p = await resolvePlaceId(args.place as string);
    if (p) {
      params.set('place_id', String(p.id));
      resolved.place = p;
    }
  }
  if (args.year) params.set('year', String(args.year));
  if (args.threatened) params.set('threatened', 'true');

  const res = await fetch(`${BASE_URL}/observations?${params}`);
  if (!res.ok) throw new Error(`iNaturalist error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    total_results?: number;
    results?: {
      id: number;
      uri?: string;
      observed_on?: string;
      created_at?: string;
      place_guess?: string;
      latitude?: string | number;
      longitude?: string | number;
      geojson?: { coordinates?: [number, number] };
      taxon?: { id: number; name?: string; preferred_common_name?: string; rank?: string };
      user?: { login?: string };
      photos?: { url?: string }[];
      quality_grade?: string;
    }[];
  };

  return {
    resolved,
    total_results: data.total_results ?? 0,
    observations: (data.results ?? []).map((o) => ({
      id: o.id,
      url: o.uri ?? `https://www.inaturalist.org/observations/${o.id}`,
      observed_on: o.observed_on ?? null,
      place: o.place_guess ?? null,
      latitude: o.geojson?.coordinates?.[1] ?? (o.latitude != null ? Number(o.latitude) : null),
      longitude: o.geojson?.coordinates?.[0] ?? (o.longitude != null ? Number(o.longitude) : null),
      taxon: o.taxon
        ? {
            id: o.taxon.id,
            scientific_name: o.taxon.name ?? null,
            common_name: o.taxon.preferred_common_name ?? null,
            rank: o.taxon.rank ?? null,
          }
        : null,
      observer: o.user?.login ?? null,
      photo: o.photos?.[0]?.url ?? null,
      quality_grade: o.quality_grade ?? null,
    })),
  };
}

async function searchTaxa(query: string, rank: string | undefined, perPage: number) {
  const params = new URLSearchParams({
    q: query,
    per_page: String(Math.min(30, Math.max(1, perPage))),
  });
  if (rank) params.set('rank', rank);

  const res = await fetch(`${BASE_URL}/taxa?${params}`);
  if (!res.ok) throw new Error(`iNaturalist error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    total_results?: number;
    results?: {
      id: number;
      name?: string;
      rank?: string;
      preferred_common_name?: string;
      observations_count?: number;
      conservation_status?: { status_name?: string };
      ancestors?: { name?: string; rank?: string }[];
      default_photo?: { medium_url?: string };
    }[];
  };

  return {
    total_results: data.total_results ?? 0,
    results: (data.results ?? []).map((t) => ({
      id: t.id,
      scientific_name: t.name ?? null,
      common_name: t.preferred_common_name ?? null,
      rank: t.rank ?? null,
      observations_count: t.observations_count ?? null,
      conservation_status: t.conservation_status?.status_name ?? null,
      ancestry: (t.ancestors ?? []).map((a) => `${a.rank ?? ''}:${a.name ?? ''}`).filter(Boolean),
      photo: t.default_photo?.medium_url ?? null,
    })),
  };
}

async function topSpecies(place: string, year: number | undefined, perPage: number) {
  const resolved = await resolvePlaceId(place);
  if (!resolved) {
    return { resolved: null, top_species: [], note: `No iNaturalist place matched "${place}"` };
  }

  const params = new URLSearchParams({
    place_id: String(resolved.id),
    per_page: String(Math.min(50, Math.max(1, perPage))),
  });
  if (year) params.set('year', String(year));

  const res = await fetch(`${BASE_URL}/observations/species_counts?${params}`);
  if (!res.ok) throw new Error(`iNaturalist error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    total_results?: number;
    results?: {
      count: number;
      taxon: {
        id: number;
        name?: string;
        rank?: string;
        preferred_common_name?: string;
        default_photo?: { medium_url?: string };
      };
    }[];
  };

  return {
    resolved: { place: resolved },
    total_unique_species: data.total_results ?? 0,
    top_species: (data.results ?? []).map((r) => ({
      observation_count: r.count,
      taxon_id: r.taxon.id,
      scientific_name: r.taxon.name ?? null,
      common_name: r.taxon.preferred_common_name ?? null,
      rank: r.taxon.rank ?? null,
      photo: r.taxon.default_photo?.medium_url ?? null,
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
