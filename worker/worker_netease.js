const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REFERER = "https://music.163.com/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Token",
  "Access-Control-Max-Age": "86400"
};

const QUALITY_ORDER = [
  "jymaster",
  "sky",
  "jyeffect",
  "dolby",
  "hires",
  "lossless",
  "exhigh",
  "standard"
];

const VALID_LEVELS = new Set(QUALITY_ORDER);
const MAX_COLLECTION_SONGS = 1000;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      authorize(request, env);

      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Only POST is supported.");
      }

      const { pathname } = new URL(request.url);

      switch (pathname) {
        case "/search":
          return jsonResponse(await handleSearch(request, env));
        case "/song":
          return jsonResponse(await handleSong(request, env));
        case "/playlist":
          return jsonResponse(await handlePlaylist(request, env));
        case "/album":
          return jsonResponse(await handleAlbum(request, env));
        default:
          throw new HttpError(404, "NOT_FOUND", "Endpoint not found.");
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.code, error.message, error.details);
      }

      return errorResponse(500, "INTERNAL_ERROR", "Unexpected internal error.");
    }
  }
};

function authorize(request, env) {
  const incoming = request.headers.get("X-Access-Token");
  if (!env.ACCESS_TOKEN || incoming !== env.ACCESS_TOKEN) {
    throw new HttpError(401, "UNAUTHORIZED", "Invalid access token.");
  }
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function normalizeBoundedNumber(value, defaultValue, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(Math.max(parsed, min), max);
}

function validateNumericId(value, fieldName) {
  const id = String(value ?? "").trim();
  if (!/^\d+$/.test(id)) {
    throw new HttpError(
      400,
      "INVALID_PARAM",
      `${fieldName} must be a numeric ID string. Example: "123456".`
    );
  }
  return id;
}

function normalizeLevel(level) {
  const requested = String(level ?? "lossless").trim().toLowerCase();
  if (!VALID_LEVELS.has(requested)) {
    throw new HttpError(
      400,
      "INVALID_PARAM",
      `level is invalid. Allowed: ${QUALITY_ORDER.join(", ")}.`
    );
  }
  return requested;
}

function neteaseHeaders(cookie) {
  return {
    "User-Agent": USER_AGENT,
    Referer: REFERER,
    Cookie: withDefaultCookie(cookie),
    "Content-Type": "application/x-www-form-urlencoded"
  };
}

function withDefaultCookie(cookie) {
  const base = "os=pc; appver=; osver=; deviceId=pyncm!";
  return cookie ? `${base}; ${cookie}` : base;
}

async function postForm(url, data, cookie) {
  const body = new URLSearchParams(data);
  const response = await fetch(url, {
    method: "POST",
    headers: neteaseHeaders(cookie),
    body
  });

  if (!response.ok) {
    throw new HttpError(502, "UPSTREAM_ERROR", `Upstream request failed: ${response.status}`);
  }

  const result = await response.json();
  if (typeof result !== "object" || result === null) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Upstream API returned invalid JSON payload.");
  }

  return result;
}

async function getJson(url, cookie) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Referer: REFERER,
      Cookie: withDefaultCookie(cookie)
    }
  });

  if (!response.ok) {
    throw new HttpError(502, "UPSTREAM_ERROR", `Upstream request failed: ${response.status}`);
  }

  const result = await response.json();
  if (typeof result !== "object" || result === null) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Upstream API returned invalid JSON payload.");
  }

  return result;
}

async function handleSearch(request, env) {
  const payload = await parseJson(request);
  const keyword = String(payload?.keyword ?? "").trim();
  const limit = normalizeBoundedNumber(payload?.limit, 20, 1, 60);
  const offset = normalizeBoundedNumber(payload?.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  if (!keyword) {
    throw new HttpError(400, "INVALID_PARAM", "keyword is required.");
  }

  const result = await postForm(
    "https://music.163.com/api/cloudsearch/pc",
    { s: keyword, type: "1", limit: String(limit), offset: String(offset) },
    env.NETEASE_COOKIE
  );

  if (result.code !== 200) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Search upstream returned non-200 code.", result);
  }

  const songs = (result.result?.songs ?? []).map(mapSong);

  return {
    ok: true,
    data: {
      keyword,
      limit,
      offset,
      total: Number(result.result?.songCount ?? songs.length),
      songs
    }
  };
}

async function handleSong(request, env) {
  const payload = await parseJson(request);
  const id = validateNumericId(payload?.id, "id");
  const level = normalizeLevel(payload?.level);

  const [detail, lyric, qualityResult] = await Promise.all([
    fetchSongDetail(id, env.NETEASE_COOKIE),
    fetchLyric(id, env.NETEASE_COOKIE),
    fetchSongUrlWithFallback(id, level, env.NETEASE_COOKIE)
  ]);

  const song = detail.songs?.[0];

  return {
    ok: true,
    data: {
      id: Number(id),
      name: song?.name ?? "",
      artists: joinArtists(song?.ar),
      album: song?.al?.name ?? "",
      picUrl: song?.al?.picUrl ?? "",
      media: {
        level: qualityResult.level,
        url: qualityResult.url,
        size: qualityResult.size,
        bitrate: qualityResult.bitrate,
        type: qualityResult.type
      },
      lyric: {
        lrc: lyric.lrc,
        tlyric: lyric.tlyric
      }
    }
  };
}

async function handlePlaylist(request, env) {
  const payload = await parseJson(request);
  const id = validateNumericId(payload?.id, "id");

  const result = await postForm(
    "https://music.163.com/api/v6/playlist/detail",
    { id },
    env.NETEASE_COOKIE
  );

  if (result.code !== 200) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Playlist upstream returned non-200 code.", result);
  }

  const playlist = result.playlist ?? {};
  const trackIds = (playlist.trackIds ?? [])
    .slice(0, MAX_COLLECTION_SONGS)
    .map((item) => item.id);
  const songs = await fetchSongsByIds(trackIds, env.NETEASE_COOKIE);

  return {
    ok: true,
    data: {
      id: playlist.id,
      name: playlist.name ?? "",
      coverImgUrl: playlist.coverImgUrl ?? "",
      description: playlist.description ?? "",
      creator: playlist.creator?.nickname ?? "",
      trackCount: Number(playlist.trackCount ?? songs.length),
      returnedCount: songs.length,
      songs
    }
  };
}

async function handleAlbum(request, env) {
  const payload = await parseJson(request);
  const id = validateNumericId(payload?.id, "id");

  const result = await getJson(`https://music.163.com/api/v1/album/${id}`, env.NETEASE_COOKIE);
  if (result.code !== 200) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Album upstream returned non-200 code.", result);
  }

  const album = result.album ?? {};
  const coverImgUrl = album.picUrl ?? "";
  const songs = (result.songs ?? [])
    .slice(0, MAX_COLLECTION_SONGS)
    .map((song) => mapSong(song, { picUrl: coverImgUrl }));

  return {
    ok: true,
    data: {
      id: album.id,
      name: album.name ?? "",
      artist: album.artist?.name ?? "",
      coverImgUrl,
      description: album.description ?? "",
      publishTime: album.publishTime ?? 0,
      returnedCount: songs.length,
      songs
    }
  };
}

async function fetchSongDetail(id, cookie) {
  const result = await postForm(
    "https://interface3.music.163.com/api/v3/song/detail",
    { c: JSON.stringify([{ id: Number(id), v: 0 }]) },
    cookie
  );
  if (result.code !== 200) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Song detail upstream returned non-200 code.", result);
  }
  return result;
}

async function fetchLyric(id, cookie) {
  const result = await postForm(
    "https://interface3.music.163.com/api/song/lyric",
    {
      id,
      cp: "false",
      tv: "0",
      lv: "0",
      rv: "0",
      kv: "0",
      yv: "0",
      ytv: "0",
      yrv: "0"
    },
    cookie
  );

  if (result.code !== 200) {
    return { lrc: "", tlyric: "" };
  }

  return {
    lrc: result.lrc?.lyric ?? "",
    tlyric: result.tlyric?.lyric ?? ""
  };
}

async function fetchSongUrlWithFallback(id, requestedLevel, cookie) {
  const levelsToTry =
    requestedLevel === "standard" ? ["standard"] : [requestedLevel, "standard"];

  for (const level of levelsToTry) {
    const songUrl = await fetchSongUrl(id, level, cookie);
    if (songUrl) {
      return songUrl;
    }
  }

  throw new HttpError(
    502,
    "UPSTREAM_ERROR",
    "Unable to obtain a playable song URL for the requested quality or standard quality."
  );
}

async function fetchSongUrl(id, level, cookie) {
  const result = await postForm(
    "https://interface3.music.163.com/api/song/enhance/player/url/v1",
    {
      ids: JSON.stringify([Number(id)]),
      level,
      encodeType: "flac"
    },
    cookie
  );

  const data = result?.data?.[0];
  const url = data?.url ?? "";

  if (result.code !== 200 || !url) {
    return null;
  }

  return {
    level,
    url,
    size: Number(data.size ?? 0),
    bitrate: Number(data.br ?? 0),
    type: String(data.type ?? "")
  };
}

async function fetchSongsByIds(ids, cookie) {
  if (!ids.length) return [];

  const songs = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const result = await postForm(
      "https://interface3.music.163.com/api/v3/song/detail",
      {
        c: JSON.stringify(chunk.map((id) => ({ id, v: 0 })))
      },
      cookie
    );
    if (result.code !== 200) {
      throw new HttpError(502, "UPSTREAM_ERROR", "Song batch detail upstream returned non-200 code.", result);
    }
    songs.push(...(result.songs ?? []).map(mapSong));
  }

  return songs;
}

function mapSong(item, options = {}) {
  const picUrl = options.picUrl ?? (item?.al?.picUrl ?? "");

  return {
    id: item?.id ?? 0,
    name: item?.name ?? "",
    artists: joinArtists(item?.ar),
    album: item?.al?.name ?? "",
    picUrl
  };
}

function joinArtists(artists = []) {
  return artists.map((artist) => artist.name).join("/");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function errorResponse(status, code, message, details) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        details: details ?? null
      }
    },
    status
  );
}
