// Music catalog. Only metadata and 30s previews come from the third party: the vote,
// playlist and delegation logic is ours. Clients only send track ids; the metadata
// stored in our database always comes from here, never from the client.

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  durationSec: number;
}

export interface TrackCatalog {
  search(query: string, limit: number): Promise<Track[]>;
  get(id: string): Promise<Track | null>;
}

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview?: string;
  artist?: { name: string };
  album?: { title: string; cover_medium?: string };
}

function fromDeezer(t: DeezerTrack): Track {
  return {
    id: `deezer:${t.id}`,
    title: t.title,
    artist: t.artist?.name ?? 'Unknown artist',
    album: t.album?.title ?? null,
    coverUrl: t.album?.cover_medium ?? null,
    previewUrl: t.preview || null,
    durationSec: t.duration ?? 0,
  };
}

export class DeezerCatalog implements TrackCatalog {
  private cache = new Map<string, Track>();

  constructor(private readonly baseUrl = 'https://api.deezer.com') {}

  private async fetchJson(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Deezer responded ${res.status}`);
    return res.json();
  }

  private remember(track: Track): Track {
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(track.id, track);
    return track;
  }

  async search(query: string, limit: number): Promise<Track[]> {
    const data = await this.fetchJson(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return ((data.data ?? []) as DeezerTrack[]).map((t) => this.remember(fromDeezer(t)));
  }

  async get(id: string): Promise<Track | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const match = /^deezer:(\d{1,20})$/.exec(id);
    if (!match) return null;
    const data = await this.fetchJson(`/track/${match[1]}`);
    if (data.error || !data.id) return null;
    return this.remember(fromDeezer(data));
  }
}

/** Deterministic offline catalog, used by the tests and the load tests. */
export class FakeCatalog implements TrackCatalog {
  private readonly tracks: Track[] = Array.from({ length: 200 }, (_, i) => ({
    id: `fake:${i + 1}`,
    title: `Track ${i + 1}`,
    artist: `Artist ${(i % 20) + 1}`,
    album: `Album ${(i % 40) + 1}`,
    coverUrl: null,
    previewUrl: null,
    durationSec: 120 + (i % 120),
  }));

  async search(query: string, limit: number): Promise<Track[]> {
    const q = query.toLowerCase();
    return this.tracks
      .filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
      .slice(0, limit);
  }

  async get(id: string): Promise<Track | null> {
    return this.tracks.find((t) => t.id === id) ?? null;
  }
}
