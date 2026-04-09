const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REFERER = "https://y.qq.com/";
const MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const PLAYLIST_FETCH_SIZE = 100;
const ALBUM_FETCH_SIZE = 100;
const MAX_TRACKS_PER_COLLECTION = 1000;
const ANDROID_CONFIG = {
  qimei: "6c9d3cd110abca9b16311cee10001e717614",
  qimei36: "6c9d3cd110abca9b16311cee10001e717614",
  version: 14090008,
  ct: 11,
  cv: 14090008,
  chid: "10003505",
  device: {
    model: "MI 6",
    release: "10",
    sdk: "29",
    androidId: "6b3e6a9c5d4f2a1b",
    fingerprint: "xiaomi/iarim/sagit:10/eomam.200122.001/6649382:user/release-keys"
  }
};
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Token",
  "Access-Control-Max-Age": "86400"
};

const QUALITY_ORDER = [
  "DTS_X",
  "MASTER",
  "ATMOS_DB",
  "ATMOS_2",
  "FLAC",
  "MP3_320",
  "NAC",
  "MP3_128"
];

const VALID_LEVELS = new Set(QUALITY_ORDER);

const QQ_FILE_TYPES = {
  dtsx: { prefix: "DT03", ext: ".mp4", type: "mp4", bitrate: 1536000, sizeKey: "size_new", sizeIndex: 9 },
  master: { prefix: "AI00", ext: ".flac", type: "flac", bitrate: 2304000, sizeKey: "size_new", sizeIndex: 0 },
  atmos2: { prefix: "Q000", ext: ".flac", type: "flac", bitrate: 1536000, sizeKey: "size_new", sizeIndex: 1 },
  atmos51: { prefix: "Q001", ext: ".flac", type: "flac", bitrate: 1536000, sizeKey: "size_new", sizeIndex: 2 },
  dolby: { prefix: "D004", ext: ".mp4", type: "mp4", bitrate: 768000, sizeKey: "size_dolby" },
  nac: { prefix: "TL01", ext: ".nac", type: "nac", bitrate: 960000, sizeKey: "size_new", sizeIndex: 7 },
  flac: { prefix: "F000", ext: ".flac", type: "flac", bitrate: 999000, sizeKey: "size_flac" },
  ogg320: { prefix: "O800", ext: ".ogg", type: "ogg", bitrate: 320000, sizeKey: "size_new", sizeIndex: 3 },
  ogg640: { prefix: "O801", ext: ".ogg", type: "ogg", bitrate: 640000, sizeKey: "size_new", sizeIndex: 5 },
  mp3320: { prefix: "M800", ext: ".mp3", type: "mp3", bitrate: 320000, sizeKey: "size_320mp3" },
  mp3128: { prefix: "M500", ext: ".mp3", type: "mp3", bitrate: 128000, sizeKey: "size_128mp3" },
  aac192: { prefix: "C600", ext: ".m4a", type: "m4a", bitrate: 192000, sizeKey: "size_192aac" },
  aac96: { prefix: "C400", ext: ".m4a", type: "m4a", bitrate: 96000, sizeKey: "size_96aac" },
  aac48: { prefix: "C200", ext: ".m4a", type: "m4a", bitrate: 48000, sizeKey: "size_48aac" }
};

const LEVEL_TO_TYPES = {
  DTS_X: ["dtsx", "flac", "mp3320", "mp3128"],
  MASTER: ["master", "flac", "mp3320", "mp3128"],
  ATMOS_DB: ["dolby", "flac", "mp3320", "mp3128"],
  ATMOS_2: ["atmos2", "flac", "mp3320", "mp3128"],
  FLAC: ["flac", "mp3320", "mp3128"],
  MP3_320: ["mp3320", "mp3128"],
  NAC: ["nac", "mp3320", "mp3128"],
  MP3_128: ["mp3128"]
};

const FILE_KEY_TO_LEVEL = {
  dtsx: "DTS_X",
  master: "MASTER",
  dolby: "ATMOS_DB",
  atmos2: "ATMOS_2",
  flac: "FLAC",
  mp3320: "MP3_320",
  nac: "NAC",
  mp3128: "MP3_128"
};

const CDN_FALLBACK = "https://isure.stream.qqmusic.qq.com/";

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

function validateNonEmptyString(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new HttpError(400, "INVALID_PARAM", `${fieldName} is required.`);
  }
  return normalized;
}

function validateSongIdentifier(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new HttpError(400, "INVALID_PARAM", "id is required.");
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  if (/^[A-Za-z0-9]+$/.test(normalized)) {
    return normalized;
  }

  throw new HttpError(400, "INVALID_PARAM", 'id must be a numeric ID or song MID string.');
}

function validateAlbumIdentifier(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new HttpError(400, "INVALID_PARAM", "id is required.");
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  if (/^[A-Za-z0-9]+$/.test(normalized)) {
    return normalized;
  }

  throw new HttpError(400, "INVALID_PARAM", 'id must be a numeric ID or album MID string.');
}

function normalizeLevel(level) {
  const requested = String(level ?? "FLAC").trim().toUpperCase();
  if (!VALID_LEVELS.has(requested)) {
    throw new HttpError(
      400,
      "INVALID_PARAM",
        `level is invalid. Allowed: ${QUALITY_ORDER.join(", ")}.`
    );
  }
  return requested;
}

function qqHeaders(env, extraHeaders = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Referer: REFERER,
    Origin: "https://y.qq.com"
  };

  if (env.QQ_COOKIE) {
    headers.Cookie = env.QQ_COOKIE;
  }

  return {
    ...headers,
    ...extraHeaders
  };
}

function buildUserAgent(platform) {
  if (platform === "android") {
    return `QQMusic ${ANDROID_CONFIG.version}(android ${ANDROID_CONFIG.device.release})`;
  }
  return USER_AGENT;
}

function parseCookieFields(cookie = "") {
  const out = { musicid: 0, musickey: "" };
  if (!cookie) return out;

  for (const part of cookie.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey || rest.length === 0) continue;
    const value = rest.join("=").trim();
    if (!out.musickey && (rawKey === "qm_keyst" || rawKey === "qqmusic_key")) {
      out.musickey = value;
    }
    if (!out.musicid && (rawKey === "uin" || rawKey === "qqmusic_uin")) {
      const normalized = value.replace(/^o0*/, "").replace(/^0+/, "");
      const numeric = Number(normalized || value);
      if (Number.isFinite(numeric) && numeric > 0) {
        out.musicid = numeric;
      }
    }
  }

  return out;
}

function hash33(str, seed = 5381) {
  let h = seed;
  for (const ch of String(str ?? "")) {
    h = (h << 5) + h + ch.charCodeAt(0);
  }
  return 2147483647 & h;
}

function randomHex(length = 32) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function getGuid() {
  return randomHex(32);
}

function getSearchId() {
  const e = randomInt(1, 20);
  const t = e * 18014398509481984;
  const n = randomInt(0, 4194304) * 4294967296;
  const r = Date.now() % (24 * 60 * 60 * 1000);
  return String(t + n + r);
}

function randomInt(min, maxExclusive) {
  return Math.floor(Math.random() * (maxExclusive - min)) + min;
}

function normalizeBoundedInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(numeric), min), max);
}

function boolToInt(data) {
  if (typeof data === "boolean") return data ? 1 : 0;
  if (Array.isArray(data)) return data.map(boolToInt);
  if (data && typeof data === "object") {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, boolToInt(v)]));
  }
  return data;
}

async function signRequest(payload) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(JSON.stringify(payload)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  const part1Indexes = [23, 14, 6, 36, 16, 40, 7, 19].filter((index) => index < 40);
  const part2Indexes = [16, 1, 32, 12, 19, 27, 8, 5];
  const scrambleValues = [
    89, 39, 179, 150, 218, 82, 58, 252, 177, 52,
    186, 123, 120, 64, 242, 133, 143, 161, 121, 179
  ];

  const part1 = part1Indexes.map((index) => hex[index]).join("");
  const part2 = part2Indexes.map((index) => hex[index]).join("");
  const part3 = new Uint8Array(20);
  for (let i = 0; i < scrambleValues.length; i += 1) {
    part3[i] = scrambleValues[i] ^ parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  const rawB64 = btoa(String.fromCharCode(...part3)).replace(/[\/+=]/g, "");
  return `zzc${part1}${rawB64}${part2}`.toLowerCase();
}

function buildComm(platform, env, guid, overrides = {}) {
  const { musicid, musickey } = parseCookieFields(env.QQ_COOKIE);
  const gTk = musickey ? hash33(musickey, 5381) : 5381;
  const qimei = normalizeOptionalString(env.QQ_QIMEI) || ANDROID_CONFIG.qimei;
  const qimei36 = normalizeOptionalString(env.QQ_QIMEI36) || ANDROID_CONFIG.qimei36;

  if (platform === "android") {
    return {
      ct: ANDROID_CONFIG.ct,
      cv: ANDROID_CONFIG.cv,
      v: ANDROID_CONFIG.version,
      chid: ANDROID_CONFIG.chid,
      tmeAppID: "qqmusic",
      tmeLoginType: 2,
      qq: musicid ? String(musicid) : "",
      authst: musickey || "",
      QIMEI: qimei,
      QIMEI36: qimei36,
      uid: "",
      gray: "0",
      nettype: "2",
      patch: "2",
      sid: "",
      OpenUDID: guid,
      OpenUDID2: guid,
      udid: guid,
      aid: ANDROID_CONFIG.device.androidId,
      os_ver: ANDROID_CONFIG.device.release,
      phonetype: ANDROID_CONFIG.device.model,
      devicelevel: ANDROID_CONFIG.device.sdk,
      newdevicelevel: ANDROID_CONFIG.device.sdk,
      rom: ANDROID_CONFIG.device.fingerprint,
      ...overrides
    };
  }

  return {
    ct: 24,
    cv: 4747474,
    platform: "yqq.json",
    format: "json",
    inCharset: "utf-8",
    outCharset: "utf-8",
    notice: 0,
    needNewCode: 1,
    uin: musicid || 0,
    g_tk: gTk,
    g_tk_new_20200303: gTk,
    chid: "0",
    guid: guid.toUpperCase(),
    ...overrides
  };
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

async function requestMusicu(env, items, options = {}) {
  const requests = Array.isArray(items) ? items : [items];
  const platform = options.platform || "web";
  const guid = options.guid || getGuid();
  const payload = {
    comm: buildComm(platform, env, guid, options.comm)
  };

  requests.forEach((item, index) => {
    payload[`req_${index}`] = {
      module: item.module,
      method: item.method,
      param: options.preserveBool ? item.param : boolToInt(item.param)
    };
  });

  const url = new URL(options.url || MUSICU_URL);
  if (options.sign) {
    url.searchParams.set("sign", await signRequest(payload));
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: qqHeaders(env, {
      "Content-Type": "application/json",
      "User-Agent": buildUserAgent(platform)
    }),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new HttpError(502, "UPSTREAM_ERROR", `Upstream request failed: ${response.status}`);
  }

  const result = await response.json();
  if (!result || typeof result !== "object") {
    throw new HttpError(502, "UPSTREAM_ERROR", "Upstream API returned invalid JSON payload.");
  }

  return result;
}

async function handleSearch(request, env) {
  const payload = await parseJson(request);
  const keyword = String(payload?.keyword ?? "").trim();
  const num = normalizeBoundedInteger(payload?.limit, 20, 1, 60);
  const page = normalizeBoundedInteger(payload?.page, 1, 1, 6);

  if (!keyword) {
    throw new HttpError(400, "INVALID_PARAM", "keyword is required.");
  }
  const result = await requestMusicu(
    env,
    {
      module: "music.search.SearchCgiService",
      method: "DoSearchForQQMusicMobile",
      param: {
        searchid: getSearchId(),
        query: keyword,
        search_type: 0,
        num_per_page: num,
        page_num: page,
        highlight: 1,
        grp: 1
      }
    },
    {
      platform: "android",
      sign: false
    }
  );

  const data = result.req_0?.data ?? {};
  const list = data?.body?.item_song;
  const total = Number(data?.meta?.sum ?? data?.meta?.estimate_sum ?? 0);

  if (!Array.isArray(list)) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Search upstream returned an unexpected payload.", result);
  }

  return {
    ok: true,
    data: {
      keyword,
      limit: num,
      page,
      total: total || list.length,
      songs: list.map(mapSearchSong)
    }
  };
}

async function handleSong(request, env) {
  const payload = await parseJson(request);
  const id = validateSongIdentifier(payload?.id);
  const level = normalizeLevel(payload?.level);

  const detail = await fetchSongDetail(id, env);
  const track = detail?.track_info;
  if (!track?.mid) {
    throw new HttpError(502, "UPSTREAM_ERROR", "Song detail upstream returned an unexpected payload.", detail);
  }

  const [lyric, media] = await Promise.all([
    fetchSongLyric(track.id, env),
    fetchSongUrlWithFallback(track, level, env)
  ]);

  return {
    ok: true,
    data: {
      id: Number(track.id ?? id),
      name: track.name ?? "",
      artists: joinArtists(track.singer),
      album: track.album?.name ?? "",
      picUrl: buildTrackCover(track),
      media,
      lyric
    }
  };
}

async function handlePlaylist(request, env) {
  const payload = await parseJson(request);
  const id = validateNumericId(payload?.id, "id");

  const firstPage = await fetchPlaylistPage(id, PLAYLIST_FETCH_SIZE, 0, env);
  const total = Number(firstPage?.total_song_num ?? firstPage?.songlist?.length ?? 0);
  const cappedTotal = Math.min(total, MAX_TRACKS_PER_COLLECTION);
  const songs = Array.isArray(firstPage?.songlist) ? [...firstPage.songlist] : [];

  for (let begin = songs.length; begin < cappedTotal; begin += PLAYLIST_FETCH_SIZE) {
    const page = await fetchPlaylistPage(id, PLAYLIST_FETCH_SIZE, begin, env);
    if (Array.isArray(page?.songlist)) {
      songs.push(...page.songlist);
    }
  }

  const info = firstPage?.dirinfo ?? {};
  const returnedSongs = songs.slice(0, MAX_TRACKS_PER_COLLECTION).map(mapSongSummary);
  return {
    ok: true,
    data: {
      id: Number(info.id ?? id),
      name: info.title ?? "",
      coverImgUrl: info.picurl ?? info.cover ?? "",
      description: info.desc ?? "",
      creator: info.creator?.nick ?? "",
      trackCount: cappedTotal || songs.length,
      returnedCount: returnedSongs.length,
      songs: returnedSongs
    }
  };
}

async function handleAlbum(request, env) {
  const payload = await parseJson(request);
  const id = validateAlbumIdentifier(payload?.id);

  const [detail, firstPage] = await Promise.all([
    fetchAlbumDetail(id, env),
    fetchAlbumSongs(id, ALBUM_FETCH_SIZE, 1, env)
  ]);

  const total = Number(firstPage?.totalNum ?? firstPage?.songList?.length ?? 0);
  const cappedTotal = Math.min(total, MAX_TRACKS_PER_COLLECTION);
  const songs = extractAlbumSongs(firstPage);
  const totalPages = Math.ceil(cappedTotal / ALBUM_FETCH_SIZE);

  for (let page = 2; page <= totalPages; page += 1) {
    const current = await fetchAlbumSongs(id, ALBUM_FETCH_SIZE, page, env);
    songs.push(...extractAlbumSongs(current));
  }

  const basicInfo = detail?.basicInfo ?? {};
  const singerList = detail?.singer?.singerList ?? [];
  const returnedSongs = songs.slice(0, MAX_TRACKS_PER_COLLECTION).map(mapSongSummary);

  return {
    ok: true,
    data: {
      id: basicInfo.albumMid,
      name: basicInfo.albumName,
      artist: joinArtists(singerList),
      coverImgUrl: buildAlbumCover(basicInfo),
      description: basicInfo.desc ?? "",
      publishTime: normalizePublishTime(basicInfo.publishDate),
      returnedCount: returnedSongs.length,
      songs: returnedSongs
    }
  };
}

async function fetchSongDetail(id, env) {
  const param = typeof id === "number" ? { song_id: id } : { song_mid: String(id) };
  const result = await requestMusicu(
    env,
    {
      module: "music.pf_song_detail_svr",
      method: "get_song_detail_yqq",
      param
    },
    {
      platform: "web",
      sign: false
    }
  );

  return result.req_0?.data ?? result.songinfo?.data ?? result.req_0 ?? result;
}

async function fetchSongLyric(songId, env) {
  const result = await requestMusicu(
    env,
    {
      module: "music.musichallSong.PlayLyricInfo",
      method: "GetPlayLyricInfo",
      param: {
        trans_t: 0,
        roma_t: 0,
        crypt: 0,
        lrc_t: 0,
        interval: 208,
        trans: 1,
        ct: 6,
        singerName: "",
        type: 0,
        qrc_t: 0,
        cv: 80600,
        roma: 0,
        songID: Number(songId),
        qrc: 0,
        albumName: "",
        songName: ""
      }
    },
    {
      platform: "android",
      sign: false,
      comm: {
        ct: 6,
        cv: 80600,
        tmeAppID: "qqmusic"
      }
    }
  );

  const data = result.req_0?.data ?? result["music.musichallSong.PlayLyricInfo.GetPlayLyricInfo"]?.data ?? {};
  return {
    lrc: decodeLyricText(data.lyric),
    tlyric: decodeLyricText(data.trans)
  };
}

function decodeLyricText(value) {
  const text = String(value ?? "");
  if (!text) return "";

  try {
    return decodeBase64Utf8(text);
  } catch {
    return text;
  }
}

function decodeBase64Utf8(base64) {
  const normalized = String(base64).replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchSongUrlWithFallback(track, requestedLevel, env) {
  const levelsToTry =
    requestedLevel === "MP3_128" ? ["MP3_128"] : [requestedLevel, "MP3_128"];

  for (const level of levelsToTry) {
    const media = await fetchSongUrl(track, level, env);
    if (media) {
      return media;
    }
  }

  throw new HttpError(
    502,
    "UPSTREAM_ERROR",
    "Unable to obtain a playable song URL for the requested quality or standard quality."
  );
}

async function fetchSongUrl(track, level, env) {
  const candidates = LEVEL_TO_TYPES[level] ?? LEVEL_TO_TYPES.standard;
  for (const key of candidates) {
    const fileType = QQ_FILE_TYPES[key];
    if (!fileType) continue;

    const mediaMid = getMediaMid(track, key);
    const filename = buildFilename(track.mid, mediaMid, fileType);
    const result = await requestMusicu(
      env,
      {
        module: "music.vkey.GetVkey",
        method: "UrlGetVkey",
        param: {
          uin: String(parseCookieFields(env.QQ_COOKIE).musicid || 0),
          filename: [filename],
          guid: getGuid(),
          songmid: [track.mid],
          songtype: [0],
          ctx: 0
        }
      },
      {
        platform: "android",
        sign: false
      }
    );

    const data = result.req_0?.data ?? {};
    const item = Array.isArray(data.midurlinfo) ? data.midurlinfo[0] : null;
    const purl = item?.purl ?? "";
    if (!purl) continue;

    const domain =
      (Array.isArray(data.sip) ? data.sip.find((value) => String(value).startsWith("https://")) : "") ||
      (Array.isArray(data.sip) ? data.sip[0] : "") ||
      CDN_FALLBACK;

    return {
      level: FILE_KEY_TO_LEVEL[key] ?? level,
      url: String(new URL(purl, domain).toString()),
      size: estimateSongSize(track.file, fileType),
      bitrate: fileType.bitrate,
      type: fileType.type
    };
  }

  return null;
}

function getMediaMid(track, key) {
  const versions = Array.isArray(track?.vs) ? track.vs : [];
  if (key === "master" && versions[3]) return versions[3];
  if (key === "atmos2" && versions[4]) return versions[4];
  if (key === "dolby" && versions[7]) return versions[7];
  if (key === "nac" && versions[28]) return versions[28];
  if (key === "dtsx" && versions[30]) return versions[30];
  if (key === "atmos51" && versions[24]) return versions[24];
  if (track?.file?.media_mid) {
    return track.file.media_mid;
  }
  return track?.mid ?? "";
}

function buildFilename(songMid, mediaMid, fileType) {
  if (mediaMid && mediaMid !== songMid) {
    return `${fileType.prefix}${mediaMid}${fileType.ext}`;
  }
  return `${fileType.prefix}${songMid}${songMid}${fileType.ext}`;
}

function estimateSongSize(file, fileType) {
  if (!file || !fileType) return 0;
  if (fileType.sizeKey === "size_new") {
    const values = Array.isArray(file.size_new) ? file.size_new : [];
    return Number(values[fileType.sizeIndex] ?? 0);
  }
  return Number(file[fileType.sizeKey] ?? 0);
}

async function fetchPlaylistPage(id, num, songBegin, env) {
  const result = await requestMusicu(
    env,
    {
      module: "music.srfDissInfo.DissInfo",
      method: "CgiGetDiss",
      param: {
        disstid: Number(id),
        dirid: 0,
        tag: 1,
        song_begin: songBegin,
        song_num: num,
        userinfo: 1,
        orderlist: 1,
        onlysonglist: 0
      }
    },
    {
      platform: "android",
      sign: false
    }
  );

  return result.req_0?.data ?? result;
}

async function fetchAlbumDetail(id, env) {
  const param = typeof id === "number" ? { albumId: id } : { albumMId: String(id) };
  const result = await requestMusicu(
    env,
    {
      module: "music.musichallAlbum.AlbumInfoServer",
      method: "GetAlbumDetail",
      param
    },
    {
      platform: "android",
      sign: false
    }
  );

  return result.req_0?.data ?? result;
}

async function fetchAlbumSongs(id, num, page, env) {
  const param = {
    begin: num * (page - 1),
    num
  };

  if (typeof id === "number") {
    param.albumId = id;
  } else {
    param.albumMid = String(id);
  }

  const result = await requestMusicu(
    env,
    {
      module: "music.musichallAlbum.AlbumSongList",
      method: "GetAlbumSongList",
      param
    },
    {
      platform: "android",
      sign: false
    }
  );

  return result.req_0?.data ?? result;
}

function extractAlbumSongs(payload) {
  const list = payload?.songList;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => item?.songInfo ?? item)
    .filter(Boolean);
}

function mapSearchSong(item) {
  const singers = Array.isArray(item?.singer)
    ? item.singer
    : String(item?.singer ?? "")
        .split(/[\/、]/)
        .map((name) => ({ name: name.trim() }))
        .filter((artist) => artist.name);
  return {
    id: Number(item?.id ?? 0),
    name: item?.name ?? item?.title ?? "",
    artists: joinArtists(singers),
    album: item?.album?.name ?? item?.albumName ?? "",
    picUrl: buildTrackCover({ album: item?.album, singer: singers })
  };
}

function mapSongSummary(item) {
  return {
    id: Number(item?.id ?? 0),
    name: item?.name ?? item?.title ?? "",
    artists: joinArtists(item?.singer),
    album: item?.album?.name ?? "",
    picUrl: buildTrackCover(item)
  };
}

function joinArtists(artists = []) {
  if (!Array.isArray(artists)) return "";
  return artists.map((artist) => artist?.name).filter(Boolean).join("/");
}

function buildAlbumCover(album) {
  const mid = String(album?.mid ?? album?.pmid ?? "").trim();
  if (!mid) return undefined;
  return `https://y.gtimg.cn/music/photo_new/T002R800x800M000${mid}.jpg`;
}

function buildSingerCover(singers = []) {
  if (!Array.isArray(singers)) return undefined;
  const first = singers.find((singer) => {
    const mid = String(singer?.mid ?? singer?.pmid ?? "").trim();
    return Boolean(mid);
  });

  const mid = String(first?.mid ?? first?.pmid ?? "").trim();
  if (!mid) return undefined;
  return `https://y.gtimg.cn/music/photo_new/T001R800x800M000${mid}.jpg`;
}

function buildTrackCover(track) {
  return buildAlbumCover(track?.album) ?? buildSingerCover(track?.singer);
}

function normalizePublishTime(value) {
  if (!value) return 0;
  const timestamp = Date.parse(String(value));
  return Number.isNaN(timestamp) ? String(value) : timestamp;
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
