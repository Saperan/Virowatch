# CF Worker — ViroWatch Streaming Proxy

Build a Cloudflare Worker that proxies movie/TV/anime streaming from 3 sources, strips ads, and returns clean JSON matching ViroWatch's data architecture.

---

## Data Model

Match ViroWatch's `window.mediaData` format:

```json
{
  "movies": {
    "VDM_{tmdbId}": {
      "title": "...",
      "image": "...",
      "video": ["streamUrl"],
      "episodeTitles": ["Full Movie"]
    }
  },
  "shows": {
    "VDT_{tmdbId}": {
      "title": "...",
      "image": "...",
      "S1": {
        "chapter": "Season 1",
        "video": ["ep1Url", "ep2Url"],
        "episodeTitles": ["Ep 1", "Ep 2"]
      }
    }
  },
  "anime": {
    "ANI_{id}": {
      "title": "...",
      "image": "...",
      "ANI_S1": {
        "chapter": "Episodes",
        "video": [...],
        "episodeTitles": [...]
      }
    }
  }
}
```

---

## Sources

### 1. Vidnest (Movies + TV Shows)

- **TMDB metadata**: `https://api.themoviedb.org/3/{search|movie|tv|trending}?api_key=...`
- **Stream resolver**: `https://new.vidnest.fun/moviebox/{mediaType}/{tmdbId}/{season?}/{ep?}`
  - Response is "encrypted" — custom base64 alphabet: `RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=`
  - Decode: replace alphabet → base64 decode → JSON parse → `{url: [{link, resolution}]}`
- **Holly fallback**: `https://new.vidnest.fun/hollymoviehd/{path}` → `{streams: [{url, type, language}]}`
- **Subtitles**: `https://sub.vdrk.site/v2/{movie|tv}/{tmdbId}/{season?}/{ep?}`
- Proxy all, strip any ads/tracking.

### 2. Consumet (Movies + TV + Anime)

- **Base**: `https://api.consumet.org/meta/tmdb`
- **Search**: `GET /{query}?page={page}`
- **Info**: `GET /info/{tmdbId}?type=movie|tv`
- **Watch**: `GET /watch/{episodeId}?id={showId}`
- Returns `{sources: [{url, quality, isM3U8}], subtitles: [{url, lang}]}`

### 3. Anikoto (Anime only)

- **API**: `https://anikotoapi.site`
- **Recent anime**: `/recent-anime?page=N&per_page=24`
- **Series detail**: `/series/{id}` → `{data: {anime: {title, poster}, episodes: [{title, number, embed_url: {sub, dub}}]}}`
- **MegaPlay embeds**: `https://megaplay.buzz/stream/s-3/{embedId}/{type}`
- Proxy all through Worker to avoid CORS issues.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sources?id={id}&type=movie\|tv\|anime` | List which sources have this title (for source buttons) |
| GET | `/search?q={title}` | Search all sources, deduplicate by ID, ranked results |
| GET | `/metadata?id={id}&type=movie\|tv\|anime&source={source}` | Full mediaData-compatible JSON |
| GET | `/watch?id={id}&type=movie\|tv\|anime&source={source}&season={s}&episode={e}` | Playable stream URL, ads stripped |
| GET | `/trending?type=movie\|tv\|anime&source={source}&page={n}` | Browse trending |

---

## Requirements

1. **Source button endpoint**: `/sources` lists available providers for a title so frontend renders a source picker (like ViroWatch's `anime-api.js`)
2. **Ad stripping**: Intercept & strip popups, trackers, overlay ads, age-gate pages. Return only clean video URL + subtitles
3. **Vidnest decryption**: Implement custom base64 decode for `new.vidnest.fun` responses
4. **Proxied playback**: For HLS streams (Consumet, Anikoto/MegaPlay), proxy through Worker to handle Referer-gated CDNs
5. **Uniform output**: All sources return same shape consumable by ViroWatch's `vidnestDirectPlayer`
6. **Cache**: CF Cache API — 1hr for metadata/search, 10min for stream URLs
7. **CORS**: Allow any origin

Deploy as `wrangler.toml` + `src/index.ts` with Hono.
