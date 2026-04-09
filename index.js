import { createPlayerView } from "./player.js";

const KEEPALIVE_AUDIO_URL = new URL("./volume_off.m4a", import.meta.url).href;

const MODULE_KEY = "st_music_player";
const DEFAULT_PLAYLIST_ID = "default";
const MAX_PLAYLISTS = 100;
const MAX_TRACKS_PER_PLAYLIST = 1000;
const SONG_DETAIL_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const SONG_DETAIL_CACHE_REUSE_MAX_AGE_MS = 10 * 60 * 1000;
const PLAY_MODE_SEQUENCE = ["list", "single", "shuffle"];
const AUDIO_SOURCE_OPTIONS = [
  { value: "netease", label: "网易云音乐" },
  { value: "qq", label: "QQ音乐" }
];
const AUDIO_SOURCE_LOGOS = {
  netease: new URL("./icons/logo_Netease.png", import.meta.url).href,
  qq: new URL("./icons/logo_QQ.png", import.meta.url).href
};
const QUALITY_OPTIONS_BY_SOURCE = {
  netease: ["jymaster", "sky", "jyeffect", "dolby", "hires", "lossless", "exhigh", "standard"],
  qq: ["DTS_X", "MASTER", "ATMOS_DB", "ATMOS_2", "FLAC", "MP3_320", "NAC", "MP3_128"]
};
const DEFAULT_QUALITY_BY_SOURCE = {
  netease: "lossless",
  qq: "FLAC"
};
const ACTION_OPTIONS = [
  { value: "search", label: "歌曲搜索" },
  { value: "song", label: "单曲解析" },
  { value: "playlist", label: "歌单解析" },
  { value: "album", label: "专辑解析" }
];

const DEFAULT_SETTINGS = {
  audioSource: "netease",
  sourceSettings: {
    netease: {
      baseUrl: "",
      accessToken: "",
      defaultQuality: DEFAULT_QUALITY_BY_SOURCE.netease
    },
    qq: {
      baseUrl: "",
      accessToken: "",
      defaultQuality: DEFAULT_QUALITY_BY_SOURCE.qq
    }
  },
  floatingLyrics: false,
  playMode: "list",
  volume: {
    value: 0.8,
    muted: false
  },
  selectedPlaylistId: DEFAULT_PLAYLIST_ID,
  playlists: [
    {
      id: DEFAULT_PLAYLIST_ID,
      name: "默认歌单",
      isDefault: true,
      tracks: []
    }
  ]
};

const runtime = {
  initialized: false,
  context: null,
  settings: null,
  saveSettingsDebounced: () => {},
  dom: {},
  playerView: null,
  audio: new Audio(),
  state: {
    queue: [],
    queueKind: "native",
    queueOpen: false,
    currentQueueIndex: -1,
    sourcePlaylistId: null,
    currentTrack: null,
    currentSongData: null,
    parsedLyrics: [],
    parsedTranslationLyrics: [],
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    previewProgressPercent: null,
    volumeVisible: false,
    lastNonZeroVolume: 0.8,
    keepAliveMode: false,
    keepAliveSnapshot: null,
    sourceConfigExpanded: false,
    floatingLyricsPosition: null,
    floatingLyricsDragging: false,
    floatingLyricsLyricKey: ""
  },
  cache: {
    songDetails: new Map()
  },
  volumeHideTimer: null,
  initialMuteSyncHandler: null
};

function isIPhoneDevice() {
  const userAgent = navigator.userAgent || "";
  return /iPhone/i.test(userAgent);
}

function isAbortError(error) {
  const message = String(error?.message ?? "");
  return (
    error?.name === "AbortError" ||
    /aborted/i.test(message) ||
    /interrupted/i.test(message) ||
    /operation was aborted/i.test(message) ||
    /play\(\) request was interrupted/i.test(message)
  );
}

function getSTContext() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toast(kind, message, title = "ST-MusicPlayer") {
  const handler = globalThis.toastr?.[kind];
  if (typeof handler === "function") {
    handler(message, title);
  } else {
    console[kind === "error" ? "error" : "log"](`[${title}] ${message}`);
  }
}

function normalizeTrack(rawTrack) {
  const artists = Array.isArray(rawTrack?.artists)
    ? rawTrack.artists.join(" / ")
    : String(rawTrack?.artists ?? rawTrack?.artist ?? "").trim();
  return {
    id: String(rawTrack?.id ?? "").trim(),
    name: String(rawTrack?.name ?? "").trim() || "未命名歌曲",
    artist: artists || "未知歌手",
    source: rawTrack?.source ? normalizeAudioSource(rawTrack.source) : "",
    album: String(rawTrack?.album ?? "").trim(),
    picUrl: String(rawTrack?.picUrl ?? "").trim()
  };
}

function getPlaylists() {
  return runtime.settings.playlists;
}

function normalizeAudioSource(source) {
  return Object.hasOwn(QUALITY_OPTIONS_BY_SOURCE, source) ? source : "netease";
}

function getQualityOptionsForSource(source) {
  return QUALITY_OPTIONS_BY_SOURCE[normalizeAudioSource(source)];
}

function normalizeDefaultQualityForSource(source, quality) {
  const normalizedSource = normalizeAudioSource(source);
  const qualityOptions = getQualityOptionsForSource(normalizedSource);
  return qualityOptions.includes(quality) ? quality : DEFAULT_QUALITY_BY_SOURCE[normalizedSource];
}

function normalizeSourceSettings(rawSettings = {}) {
  return {
    netease: {
      baseUrl: String(rawSettings?.netease?.baseUrl ?? "").trim(),
      accessToken: String(rawSettings?.netease?.accessToken ?? "").trim(),
      defaultQuality: normalizeDefaultQualityForSource("netease", rawSettings?.netease?.defaultQuality)
    },
    qq: {
      baseUrl: String(rawSettings?.qq?.baseUrl ?? "").trim(),
      accessToken: String(rawSettings?.qq?.accessToken ?? "").trim(),
      defaultQuality: normalizeDefaultQualityForSource("qq", rawSettings?.qq?.defaultQuality)
    }
  };
}

function getSourceSettings(source = runtime.settings.audioSource) {
  const normalizedSource = normalizeAudioSource(source);
  runtime.settings.sourceSettings = normalizeSourceSettings(runtime.settings.sourceSettings);
  return runtime.settings.sourceSettings[normalizedSource];
}

function getTrackCacheKey(track) {
  const sourceKey = track?.source ? normalizeAudioSource(track.source) : "url";
  return `${sourceKey}:${String(track?.id ?? "")}`;
}

function normalizeSongDetailCacheEntry(entry) {
  if (!entry) {
    return null;
  }
  if (entry.songData) {
    return {
      songData: entry.songData,
      cachedAt: Number(entry.cachedAt) || Date.now(),
      pinned: Boolean(entry.pinned)
    };
  }
  return {
    songData: entry,
    cachedAt: 0,
    pinned: false
  };
}

function setSongDetailCache(track, songData, options = {}) {
  runtime.cache.songDetails.set(getTrackCacheKey(track), {
    songData,
    cachedAt: Date.now(),
    pinned: Boolean(options.pinned)
  });
}

function clearPinnedApiSongCache() {
  for (const [cacheKey, rawEntry] of runtime.cache.songDetails.entries()) {
    const entry = normalizeSongDetailCacheEntry(rawEntry);
    if (entry?.pinned) {
      runtime.cache.songDetails.delete(cacheKey);
    }
  }
}

function pruneSongDetailCache() {
  const expireBefore = Date.now() - SONG_DETAIL_CACHE_MAX_AGE_MS;
  for (const [cacheKey, rawEntry] of runtime.cache.songDetails.entries()) {
    const entry = normalizeSongDetailCacheEntry(rawEntry);
    if (!entry) {
      runtime.cache.songDetails.delete(cacheKey);
      continue;
    }
    if (entry.pinned) {
      continue;
    }
    if (entry.cachedAt <= expireBefore) {
      runtime.cache.songDetails.delete(cacheKey);
    }
  }
}

async function refreshSongDetailCache(track) {
  try {
    await getSongDetail(track, true);
  } catch (error) {
    console.warn("[ST-MusicPlayer] Song detail refresh failed", error);
  }
}

function ensureDefaultPlaylist() {
  let defaultPlaylist = getPlaylists().find((playlist) => playlist.isDefault);
  if (!defaultPlaylist) {
    defaultPlaylist = {
      id: DEFAULT_PLAYLIST_ID,
      name: "默认歌单",
      isDefault: true,
      tracks: []
    };
    runtime.settings.playlists.unshift(defaultPlaylist);
  }
  if (!runtime.settings.selectedPlaylistId) {
    runtime.settings.selectedPlaylistId = defaultPlaylist.id;
  }
  return defaultPlaylist;
}

function enforcePlaylistLimits() {
  const playlists = Array.isArray(runtime.settings.playlists) ? runtime.settings.playlists : [];
  const normalizedPlaylists = playlists.map((playlist) => ({
    ...playlist,
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks.slice(0, MAX_TRACKS_PER_PLAYLIST) : []
  }));
  const defaultPlaylist = normalizedPlaylists.find((playlist) => playlist.isDefault) ?? null;
  const otherPlaylists = normalizedPlaylists.filter((playlist) => !playlist.isDefault);
  runtime.settings.playlists = defaultPlaylist
    ? [defaultPlaylist, ...otherPlaylists.slice(0, Math.max(0, MAX_PLAYLISTS - 1))]
    : otherPlaylists.slice(0, MAX_PLAYLISTS);
}

function getSelectedPlaylist() {
  return getPlaylists().find((playlist) => playlist.id === runtime.settings.selectedPlaylistId) ?? ensureDefaultPlaylist();
}

function getPlaylistById(playlistId) {
  return getPlaylists().find((playlist) => playlist.id === playlistId) ?? null;
}

function persistDynamicSettings() {
  runtime.saveSettingsDebounced();
}

function updateSettingsStore() {
  enforcePlaylistLimits();
  runtime.context.extensionSettings[MODULE_KEY] = runtime.settings;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSourceLogoMarkup(source, className = "stmp-source-inline-logo") {
  const normalizedSource = normalizeAudioSource(source);
  if (!source || !AUDIO_SOURCE_LOGOS[normalizedSource]) {
    return "";
  }
  const label = AUDIO_SOURCE_OPTIONS.find((option) => option.value === normalizedSource)?.label || normalizedSource;
  return `<img class="${className}" src="${AUDIO_SOURCE_LOGOS[normalizedSource]}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}" />`;
}

function formatSourceLabel(source) {
  const normalizedSource = normalizeAudioSource(source);
  return normalizedSource === "qq" ? "QQ" : "Netease";
}

function shuffleTracks(tracks) {
  const copied = [...tracks];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function getProgressPercent() {
  if (runtime.state.previewProgressPercent !== null) {
    return runtime.state.previewProgressPercent;
  }
  if (!runtime.state.duration) {
    return 0;
  }
  return (runtime.state.currentTime / runtime.state.duration) * 100;
}

function parseLrc(rawLrc) {
  const text = String(rawLrc ?? "").trim();
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const content = line.replace(/\[[^\]]+]/g, "").trim();
      if (!content) {
        return [];
      }
      const times = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      return times.map((match) => ({
        time: Number(match[1]) * 60 + Number(match[2]),
        text: content
      }));
    })
    .sort((left, right) => left.time - right.time);
}

function mergeTimedLyrics(rawLrc, rawTranslation) {
  const baseLyrics = parseLrc(rawLrc);
  if (!baseLyrics.length) {
    return "";
  }
  const translationMap = new Map(
    parseLrc(rawTranslation).map((item) => [item.time.toFixed(3), item.text])
  );
  return String(rawLrc ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const content = line.replace(/\[[^\]]+]/g, "").trim();
      if (!content) {
        return line;
      }
      const firstMatch = line.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
      if (!firstMatch) {
        return line;
      }
      const time = (Number(firstMatch[1]) * 60 + Number(firstMatch[2])).toFixed(3);
      const translated = translationMap.get(time);
      if (!translated) {
        return line;
      }
      return line.replace(content, `${content}（${translated}）`);
    })
    .join("\n");
}

function getLyricState() {
  if (!runtime.state.parsedLyrics.length) {
    return { current: "", next: "" };
  }
  const currentTime = runtime.state.currentTime;
  let currentIndex = -1;
  for (let index = 0; index < runtime.state.parsedLyrics.length; index += 1) {
    if (runtime.state.parsedLyrics[index].time <= currentTime + 0.15) {
      currentIndex = index;
    } else {
      break;
    }
  }
  if (currentIndex < 0) {
    return {
      current: "",
      next: runtime.state.parsedLyrics[0]?.text ?? ""
    };
  }
  return {
    current: runtime.state.parsedLyrics[currentIndex]?.text ?? "",
    next: runtime.state.parsedLyrics[currentIndex + 1]?.text ?? ""
  };
}

function getFloatingLyricState() {
  const baseState = getLyricState();
  if (!runtime.state.parsedTranslationLyrics.length) {
    return baseState;
  }
  const currentTime = runtime.state.currentTime;
  let currentIndex = -1;
  for (let index = 0; index < runtime.state.parsedTranslationLyrics.length; index += 1) {
    if (runtime.state.parsedTranslationLyrics[index].time <= currentTime + 0.15) {
      currentIndex = index;
    } else {
      break;
    }
  }
  const translation = currentIndex >= 0 ? runtime.state.parsedTranslationLyrics[currentIndex]?.text ?? "" : "";
  if (!translation) {
    return baseState;
  }
  return {
    current: baseState.current,
    next: translation
  };
}

function renderPlayer() {
  const lyrics = getLyricState();
  runtime.playerView?.render({
    isEmpty: !runtime.state.currentTrack,
    isPlaying: runtime.state.isPlaying,
    current: runtime.state.currentSongData ?? runtime.state.currentTrack,
    currentTime: runtime.state.currentTime,
    duration: runtime.state.duration,
    progressPercent: getProgressPercent(),
    lyrics,
    queue: runtime.state.queue,
    queueOpen: runtime.state.queueOpen,
    currentQueueIndex: runtime.state.currentQueueIndex,
    playMode: runtime.state.queueKind === "api" ? "list" : runtime.settings.playMode,
    volumeVisible: runtime.state.volumeVisible,
    volume: runtime.settings.volume.value,
    isMuted: runtime.settings.volume.muted,
    volumeLocked: isIPhoneDevice() || runtime.state.keepAliveMode
  });
  renderFloatingLyrics(getFloatingLyricState());
}

function renderAll() {
  renderConfigInputs();
  renderPlaylistOptions();
  renderPlayer();
}

function renderQualityOptions(source, selectedQuality = "") {
  const qualitySelect = runtime.dom.qualitySelect;
  if (!qualitySelect) {
    return;
  }
  const options = getQualityOptionsForSource(source);
  qualitySelect.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join("");
  qualitySelect.value = normalizeDefaultQualityForSource(source, selectedQuality);
}

function renderConfigInputs() {
  const { audioSource, floatingLyrics } = runtime.settings;
  const activeSource = normalizeAudioSource(audioSource);
  const sourceSettings = getSourceSettings(activeSource);
  const {
    baseUrlInput,
    accessTokenInput,
    actionSelect,
    floatingLyricsToggle,
    sourceTabButtons,
    sourceConfigDrawer
  } = runtime.dom;
  const displayQuality =
    document.activeElement === runtime.dom.qualitySelect
      ? runtime.dom.qualitySelect.value
      : sourceSettings.defaultQuality;

  sourceTabButtons?.forEach((button) => {
    button.classList.toggle("stmp-source-tab-active", button.dataset.sourceTab === activeSource);
  });
  if (sourceConfigDrawer) {
    sourceConfigDrawer.dataset.expanded = String(Boolean(runtime.state.sourceConfigExpanded));
  }

  if (document.activeElement !== baseUrlInput) {
    baseUrlInput.value = sourceSettings.baseUrl;
  }
  if (document.activeElement !== accessTokenInput) {
    accessTokenInput.value = sourceSettings.accessToken;
  }
  renderQualityOptions(activeSource, displayQuality);
  if (floatingLyricsToggle) {
    floatingLyricsToggle.checked = Boolean(floatingLyrics);
  }
  if (!actionSelect.value) {
    actionSelect.value = ACTION_OPTIONS[0].value;
  }
}

function renderPlaylistOptions() {
  const select = runtime.dom.playlistSelect;
  if (!select) {
    return;
  }
  const previousValue = runtime.settings.selectedPlaylistId;
  select.innerHTML = getPlaylists()
    .map(
      (playlist) =>
        `<option value="${playlist.id}">${playlist.name}${playlist.isDefault ? "（默认）" : ""}</option>`
    )
    .join("");
  select.value = previousValue;
  if (select.value !== previousValue) {
    select.value = ensureDefaultPlaylist().id;
    runtime.settings.selectedPlaylistId = select.value;
    persistDynamicSettings();
  }
}

function getApiBaseUrl(source = runtime.settings.audioSource) {
  return String(getSourceSettings(source).baseUrl ?? "").trim().replace(/\/+$/, "");
}

async function apiPost(path, payload, source = runtime.settings.audioSource) {
  const normalizedSource = normalizeAudioSource(source);
  const sourceSettings = getSourceSettings(normalizedSource);
  const baseUrl = getApiBaseUrl(normalizedSource);
  const accessToken = String(sourceSettings.accessToken ?? "").trim();
  if (!baseUrl) {
    throw new Error("请先填写 Base URL。");
  }
  if (!accessToken) {
    throw new Error("请先填写 Access Token。");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Access-Token": accessToken
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const message = result?.error?.message || `请求失败：${response.status}`;
    throw new Error(message);
  }
  return result.data;
}

function resetVolumeHideTimer() {
  clearTimeout(runtime.volumeHideTimer);
  runtime.volumeHideTimer = setTimeout(() => {
    runtime.state.volumeVisible = false;
    renderAll();
  }, 2000);
}

function applyAudioVolume() {
  runtime.audio.muted = false;
  runtime.audio.volume = Math.min(1, Math.max(0, Number(runtime.settings.volume.value) || 0));
}

function reshuffleUpcomingQueue() {
  if (!runtime.state.queue.length) {
    return;
  }
  const currentIndex = runtime.state.currentQueueIndex;
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const playedQueue = runtime.state.queue.slice(0, startIndex);
  const remainingQueue = runtime.state.queue.slice(startIndex);
  if (remainingQueue.length <= 1) {
    return;
  }
  runtime.state.queue = [...playedQueue, ...shuffleTracks(remainingQueue)];
}

async function getSongDetail(track, forceRefresh = false) {
  const source = normalizeAudioSource(track?.source);
  const cacheKey = getTrackCacheKey(track);
  pruneSongDetailCache();
  if (!forceRefresh && runtime.cache.songDetails.has(cacheKey)) {
    const cachedEntry = normalizeSongDetailCacheEntry(runtime.cache.songDetails.get(cacheKey));
    if (cachedEntry) {
      if (cachedEntry.pinned) {
        return cachedEntry.songData;
      }
      const cacheAge = Date.now() - cachedEntry.cachedAt;
      if (cacheAge <= SONG_DETAIL_CACHE_MAX_AGE_MS) {
        if (cacheAge > SONG_DETAIL_CACHE_REUSE_MAX_AGE_MS) {
          runtime.cache.songDetails.delete(cacheKey);
          void refreshSongDetailCache(track);
        }
        return cachedEntry.songData;
      }
      runtime.cache.songDetails.delete(cacheKey);
    }
  }
  const sourceSettings = getSourceSettings(source);
  const data = await apiPost("/song", {
    id: String(track.id),
    level: sourceSettings.defaultQuality
  }, source);
  const normalized = {
    id: String(data.id),
    name: data.name,
    artist: data.artists,
    source,
    album: data.album,
    picUrl: data.picUrl,
    media: data.media,
    lyric: data.lyric
  };
  setSongDetailCache(track, normalized);
  return normalized;
}

function shouldRefreshSongDetailCache(track) {
  const cachedEntry = normalizeSongDetailCacheEntry(runtime.cache.songDetails.get(getTrackCacheKey(track)));
  if (!cachedEntry || cachedEntry.pinned) {
    return false;
  }
  return Date.now() - cachedEntry.cachedAt > SONG_DETAIL_CACHE_REUSE_MAX_AGE_MS;
}

async function prefetchNextTrack() {
  const nextTrack =
    runtime.state.queue[runtime.state.currentQueueIndex + 1] ??
    (runtime.state.queue.length && runtime.settings.playMode !== "single" ? runtime.state.queue[0] : null);
  if (!nextTrack) {
    return;
  }
  try {
    if (shouldRefreshSongDetailCache(nextTrack)) {
      void refreshSongDetailCache(nextTrack);
      return;
    }
    await getSongDetail(nextTrack);
  } catch (error) {
    console.warn("[ST-MusicPlayer] Prefetch failed", error);
  }
}

function clearPlaybackState() {
  clearPinnedApiSongCache();
  runtime.audio.pause();
  runtime.audio.loop = false;
  runtime.audio.removeAttribute("src");
  runtime.audio.load();
  runtime.state.queue = [];
  runtime.state.queueKind = "native";
  runtime.state.currentQueueIndex = -1;
  runtime.state.sourcePlaylistId = null;
  runtime.state.currentTrack = null;
  runtime.state.currentSongData = null;
  runtime.state.parsedLyrics = [];
  runtime.state.parsedTranslationLyrics = [];
  runtime.state.currentTime = 0;
  runtime.state.duration = 0;
  runtime.state.isPlaying = false;
  runtime.state.previewProgressPercent = null;
  runtime.state.keepAliveMode = false;
  runtime.state.keepAliveSnapshot = null;
  renderAll();
}

function getFloatingLyricsHost() {
  return document.body;
}

function getFloatingLyricsTopOffset() {
  const topBar = document.querySelector("#top-bar");
  if (!topBar) {
    return 20;
  }
  const rect = topBar.getBoundingClientRect();
  return Math.max(20, Math.round((rect.bottom || 0) + 12));
}

function ensureFloatingLyricsDefaultPosition() {
  if (runtime.state.floatingLyricsPosition) {
    return;
  }
  runtime.state.floatingLyricsPosition = {
    left: "50%",
    top: `${getFloatingLyricsTopOffset()}px`,
    transform: "translateX(-50%)"
  };
}

function applyFloatingLyricsPosition() {
  const container = runtime.dom.floatingLyrics;
  if (!container) {
    return;
  }
  ensureFloatingLyricsDefaultPosition();
  const position = runtime.state.floatingLyricsPosition;
  container.style.left = position.left;
  container.style.top = position.top;
  container.style.transform = position.transform;
}

function renderFloatingLyrics(lyrics = getFloatingLyricState()) {
  const container = runtime.dom.floatingLyrics;
  if (!container) {
    return;
  }
  const current = lyrics?.current || "";
  const next = lyrics?.next || "";
  const lyricKey = `${current}__${next}`;
  const hasLyrics = Boolean(current || next);
  const shouldShow = Boolean(runtime.settings.floatingLyrics);

  container.hidden = !shouldShow;
  container.dataset.hasLyrics = String(hasLyrics);
  container.style.pointerEvents = hasLyrics ? "auto" : "none";

  if (!shouldShow) {
    return;
  }

  applyFloatingLyricsPosition();

  if (runtime.state.floatingLyricsLyricKey !== lyricKey) {
    runtime.dom.floatingLyricCurrent.textContent = current;
    runtime.dom.floatingLyricNext.textContent = next;
    runtime.dom.floatingLyricsTrack.classList.remove("stmp-floating-lyrics-animate");
    if (hasLyrics) {
      requestAnimationFrame(() => {
        if (runtime.dom.floatingLyricsTrack) {
          runtime.dom.floatingLyricsTrack.classList.add("stmp-floating-lyrics-animate");
        }
      });
    }
    runtime.state.floatingLyricsLyricKey = lyricKey;
  }
}

function bindFloatingLyricsDrag() {
  const container = runtime.dom.floatingLyrics;
  if (!container) {
    return;
  }

  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onPointerMove = (event) => {
    if (!runtime.state.floatingLyricsDragging) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const nextLeft = Math.min(
      Math.max(0, originLeft + (event.clientX - startX)),
      Math.max(0, window.innerWidth - containerRect.width)
    );
    const nextTop = Math.min(
      Math.max(0, originTop + (event.clientY - startY)),
      Math.max(0, window.innerHeight - containerRect.height)
    );
    runtime.state.floatingLyricsPosition = {
      left: `${nextLeft}px`,
      top: `${nextTop}px`,
      transform: "none"
    };
    applyFloatingLyricsPosition();
  };

  const stopDrag = () => {
    runtime.state.floatingLyricsDragging = false;
    container.classList.remove("dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
  };

  container.addEventListener("pointerdown", (event) => {
    if (container.dataset.hasLyrics !== "true") {
      return;
    }
    event.preventDefault();
    const containerRect = container.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originLeft = containerRect.left;
    originTop = containerRect.top;
    runtime.state.floatingLyricsDragging = true;
    container.classList.add("dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  });
}

function createPlaybackSnapshot() {
  const currentTime = runtime.audio.currentTime || runtime.state.currentTime || 0;
  const currentDuration = runtime.state.duration || 0;
  return {
    queue: runtime.state.queue.map((track) => ({ ...track })),
    queueKind: runtime.state.queueKind,
    currentQueueIndex: runtime.state.currentQueueIndex,
    sourcePlaylistId: runtime.state.sourcePlaylistId,
    currentTrack: runtime.state.currentTrack ? { ...runtime.state.currentTrack } : null,
    currentSongData: runtime.state.currentSongData ? deepClone(runtime.state.currentSongData) : null,
    parsedLyrics: deepClone(runtime.state.parsedLyrics),
    parsedTranslationLyrics: deepClone(runtime.state.parsedTranslationLyrics),
    currentTime,
    duration: currentDuration,
    wasPlaying: !runtime.audio.paused || runtime.state.isPlaying
  };
}

function detachInitialMuteSyncHandler() {
  if (!runtime.initialMuteSyncHandler) {
    return;
  }
  document.removeEventListener("click", runtime.initialMuteSyncHandler, true);
  runtime.initialMuteSyncHandler = null;
}

function ensureInitialMuteSyncHandler() {
  if (runtime.initialMuteSyncHandler) {
    return;
  }
  runtime.initialMuteSyncHandler = () => {
    detachInitialMuteSyncHandler();
    if (runtime.state.keepAliveMode || !runtime.settings.volume.muted) {
      return;
    }
    void enterKeepAliveMode();
  };
  document.addEventListener("click", runtime.initialMuteSyncHandler, { capture: true, once: true });
}

function createKeepAliveTrack() {
  return {
    id: "__stmp_keepalive__",
    name: "静音中",
    artist: "未知",
    album: "",
    picUrl: ""
  };
}

async function enterKeepAliveMode() {
  if (runtime.state.keepAliveMode) {
    return;
  }
  const keepAliveTrack = createKeepAliveTrack();
  const snapshot = runtime.state.queueKind === "api" ? createEmptyPlaybackSnapshot() : createPlaybackSnapshot();

  runtime.state.keepAliveMode = true;
  runtime.state.keepAliveSnapshot = snapshot;
  runtime.settings.volume.muted = true;
  runtime.state.queueOpen = false;
  runtime.state.queue = [keepAliveTrack];
  runtime.state.queueKind = "native";
  runtime.state.currentQueueIndex = 0;
  runtime.state.sourcePlaylistId = null;
  runtime.state.currentTrack = keepAliveTrack;
  runtime.state.currentSongData = {
    ...keepAliveTrack,
    media: { url: KEEPALIVE_AUDIO_URL, level: "" },
    lyric: { lrc: "" }
  };
  runtime.state.parsedLyrics = [];
  runtime.state.parsedTranslationLyrics = [];
  runtime.state.currentTime = 0;
  runtime.state.duration = 0;
  runtime.state.previewProgressPercent = null;

  try {
    runtime.audio.pause();
    runtime.audio.loop = true;
    runtime.audio.src = KEEPALIVE_AUDIO_URL;
    runtime.audio.currentTime = 0;
    applyAudioVolume();
    await runtime.audio.play();
    runtime.state.isPlaying = true;
  } catch (error) {
    runtime.state.keepAliveMode = false;
    runtime.state.keepAliveSnapshot = null;
    runtime.audio.loop = false;
    runtime.state.isPlaying = false;
    runtime.settings.volume.muted = false;
    if (!isAbortError(error)) {
      toast("error", error.message || "无法进入静音模式。");
    }
  }

  persistDynamicSettings();
  renderAll();
}

async function exitKeepAliveMode() {
  if (!runtime.state.keepAliveMode) {
    return;
  }
  const snapshot = runtime.state.keepAliveSnapshot;
  const resumeTrack = snapshot?.currentTrack;
  const resumeTime = snapshot?.currentTime ?? 0;
  const resumeDuration = snapshot?.duration ?? 0;
  const resumePlayback = snapshot?.wasPlaying ?? false;

  runtime.state.keepAliveMode = false;
  runtime.state.keepAliveSnapshot = null;
  runtime.settings.volume.muted = false;
  runtime.audio.loop = false;
  runtime.state.queue = snapshot?.queue?.map((track) => ({ ...track })) ?? [];
  runtime.state.queueKind = snapshot?.queueKind ?? "native";
  runtime.state.currentQueueIndex = snapshot?.currentQueueIndex ?? -1;
  runtime.state.sourcePlaylistId = snapshot?.sourcePlaylistId ?? null;
  runtime.state.currentTrack = resumeTrack ? { ...resumeTrack } : null;
  runtime.state.currentSongData = snapshot?.currentSongData ? deepClone(snapshot.currentSongData) : null;
  runtime.state.parsedLyrics = deepClone(snapshot?.parsedLyrics ?? []);
  runtime.state.parsedTranslationLyrics = deepClone(snapshot?.parsedTranslationLyrics ?? []);
  runtime.state.currentTime = resumeTime;
  runtime.state.duration = resumeDuration;
  runtime.state.previewProgressPercent = null;
  runtime.state.isPlaying = resumePlayback;

  try {
    runtime.audio.pause();
    if (!runtime.state.currentSongData?.media?.url && runtime.state.currentTrack?.id) {
      runtime.state.currentSongData = await getSongDetail(runtime.state.currentTrack, true);
      runtime.state.parsedLyrics = parseLrc(runtime.state.currentSongData?.lyric?.lrc);
      runtime.state.parsedTranslationLyrics = parseLrc(runtime.state.currentSongData?.lyric?.tlyric);
    }
    if (runtime.state.currentSongData?.media?.url) {
      runtime.audio.src = runtime.state.currentSongData.media.url;
      runtime.audio.currentTime = 0;
      applyAudioVolume();
      runtime.audio.currentTime = resumeTime;
      if (resumePlayback) {
        await runtime.audio.play();
        runtime.state.isPlaying = true;
      } else {
        runtime.state.isPlaying = false;
      }
    } else {
      runtime.state.isPlaying = false;
    }
  } catch (error) {
    if (!isAbortError(error)) {
      runtime.state.isPlaying = false;
      toast("error", error.message || "无法恢复原曲播放。");
    }
  }

  persistDynamicSettings();
  renderAll();
}

function buildQueueFromPlaylist(playlist, startTrackId = null) {
  const normalizedTracks = playlist.tracks.map(normalizeTrack);
  let queue =
    runtime.settings.playMode === "shuffle" ? shuffleTracks(normalizedTracks) : [...normalizedTracks];

  if (startTrackId) {
    const index = queue.findIndex((track) => track.id === startTrackId);
    if (index > 0) {
      queue = [queue[index], ...queue.slice(0, index), ...queue.slice(index + 1)];
    }
  }

  runtime.state.queue = queue;
  runtime.state.queueKind = "native";
  runtime.state.currentQueueIndex = queue.length ? 0 : -1;
  runtime.state.sourcePlaylistId = playlist.id;
}

function createEmptyPlaybackSnapshot() {
  return {
    queue: [],
    queueKind: "native",
    currentQueueIndex: -1,
    sourcePlaylistId: null,
    currentTrack: null,
    currentSongData: null,
    parsedLyrics: [],
    parsedTranslationLyrics: [],
    currentTime: 0,
    duration: 0,
    wasPlaying: false
  };
}

function discardApiQueueState() {
  if (runtime.state.queueKind !== "api") {
    return;
  }
  clearPlaybackState();
}

async function playQueueIndex(index) {
  if (runtime.state.keepAliveMode) {
    await exitKeepAliveMode();
  }
  const track = runtime.state.queue[index];
  if (!track) {
    return;
  }
  runtime.state.currentQueueIndex = index;
  runtime.state.currentTrack = track;
  runtime.state.currentTime = 0;
  runtime.state.duration = 0;
  runtime.state.previewProgressPercent = null;
  renderAll();

  try {
    const songData = await getSongDetail(track);
    if (!songData.media?.url) {
      throw new Error("当前歌曲无可用音源。");
    }
    runtime.state.currentSongData = songData;
    runtime.state.parsedLyrics = parseLrc(songData.lyric?.lrc);
    runtime.state.parsedTranslationLyrics = parseLrc(songData.lyric?.tlyric);
    runtime.audio.loop = false;
    runtime.audio.src = songData.media.url;
    runtime.audio.currentTime = 0;
    applyAudioVolume();
    await runtime.audio.play();
    runtime.state.isPlaying = true;
    renderAll();
    void prefetchNextTrack();
  } catch (error) {
    runtime.state.isPlaying = false;
    renderAll();
    if (!isAbortError(error)) {
      await advanceAfterPlaybackFailure();
    }
  }
}

async function startPlaylistPlayback(playlist, startTrackId = null) {
  if (!playlist?.tracks?.length) {
    toast("warning", "这里是空的呢！");
    return;
  }
  discardApiQueueState();
  buildQueueFromPlaylist(playlist, startTrackId);
  await playQueueIndex(0);
}

function findFirstPlayablePlaylist() {
  const playlists = getPlaylists();
  const defaultPlaylist = ensureDefaultPlaylist();
  const orderedIds = [runtime.settings.selectedPlaylistId, defaultPlaylist.id, ...playlists.map((item) => item.id)];
  const visited = new Set();
  for (const playlistId of orderedIds) {
    if (!playlistId || visited.has(playlistId)) {
      continue;
    }
    visited.add(playlistId);
    const playlist = getPlaylistById(playlistId);
    if (playlist?.tracks?.length) {
      return playlist;
    }
  }
  return null;
}

async function playFromEmptyState() {
  const selected = getSelectedPlaylist();
  if (selected?.tracks?.length) {
    await startPlaylistPlayback(selected);
    return;
  }
  const fallback = findFirstPlayablePlaylist();
  if (!fallback) {
    toast("info", "这里是空的呢！");
    return;
  }
  runtime.settings.selectedPlaylistId = fallback.id;
  persistDynamicSettings();
  toast("info", "当前歌单不存在或没有内容，已为您切换到其他歌单。");
  await startPlaylistPlayback(fallback);
}

async function advanceQueue() {
  if (runtime.state.queueKind === "api") {
    const nextIndex = runtime.state.currentQueueIndex + 1;
    if (nextIndex < runtime.state.queue.length) {
      await playQueueIndex(nextIndex);
      return;
    }
    if (runtime.state.queue.length) {
      await playQueueIndex(0);
      return;
    }
    clearPlaybackState();
    return;
  }

  if (runtime.settings.playMode === "single" && runtime.state.currentQueueIndex >= 0) {
    await playQueueIndex(runtime.state.currentQueueIndex);
    return;
  }

  const nextIndex = runtime.state.currentQueueIndex + 1;
  if (nextIndex < runtime.state.queue.length) {
    await playQueueIndex(nextIndex);
    return;
  }

  const playlist = getPlaylistById(runtime.state.sourcePlaylistId) ?? getSelectedPlaylist();
  if (!playlist?.tracks?.length) {
    clearPlaybackState();
    toast("info", "这里是空的呢！");
    return;
  }
  buildQueueFromPlaylist(playlist);
  await playQueueIndex(0);
}

async function advanceAfterPlaybackFailure() {
  const nextIndex = runtime.state.currentQueueIndex + 1;
  if (nextIndex >= 0 && nextIndex < runtime.state.queue.length) {
    await playQueueIndex(nextIndex);
    return;
  }
  clearPlaybackState();
}

async function skipToPrevious() {
  if (runtime.audio.currentTime > 3) {
    runtime.audio.currentTime = 0;
    return;
  }
  if (runtime.state.currentQueueIndex > 0) {
    await playQueueIndex(runtime.state.currentQueueIndex - 1);
    return;
  }
  const playlist = getPlaylistById(runtime.state.sourcePlaylistId);
  if (playlist?.tracks?.length) {
    buildQueueFromPlaylist(playlist);
    runtime.state.currentQueueIndex = runtime.state.queue.length - 1;
    await playQueueIndex(runtime.state.currentQueueIndex);
  }
}

async function skipToNext() {
  if (!runtime.state.queue.length) {
    await playFromEmptyState();
    return;
  }
  await advanceQueue();
}

async function togglePlay() {
  if (runtime.state.keepAliveMode) {
    toast("info", "请先解除静音");
    return;
  }
  if (!runtime.state.currentTrack) {
    await playFromEmptyState();
    return;
  }

  if (runtime.audio.paused) {
    try {
      await runtime.audio.play();
      runtime.state.isPlaying = true;
    } catch (error) {
      if (!isAbortError(error)) {
        toast("error", error.message || "无法继续播放。");
      }
    }
  } else {
    runtime.audio.pause();
    runtime.state.isPlaying = false;
  }
  renderAll();
}

function cyclePlayMode() {
  if (runtime.state.queueKind === "api") {
    toast("info", "当前播放队列不可变更播放模式");
    return;
  }
  const currentIndex = PLAY_MODE_SEQUENCE.indexOf(runtime.settings.playMode);
  const nextMode = PLAY_MODE_SEQUENCE[(currentIndex + 1) % PLAY_MODE_SEQUENCE.length];
  runtime.settings.playMode = nextMode;
  if (nextMode === "shuffle" && runtime.state.queue.length) {
    reshuffleUpcomingQueue();
  }
  persistDynamicSettings();
  renderAll();
}

function handleVolumeButton() {
  if (!runtime.state.volumeVisible) {
    runtime.state.volumeVisible = true;
    resetVolumeHideTimer();
    renderAll();
    return;
  }

  if (!runtime.settings.volume.muted) {
    discardApiQueueState();
    void enterKeepAliveMode();
  } else {
    void exitKeepAliveMode();
  }
  resetVolumeHideTimer();
}

function setVolume(value) {
  if (runtime.state.keepAliveMode) {
    toast("info", "请先解除静音");
    return;
  }
  const normalized = Math.min(1, Math.max(0, Number(value) || 0));
  runtime.settings.volume.value = normalized;
  if (normalized > 0) {
    runtime.state.lastNonZeroVolume = normalized;
    runtime.settings.volume.muted = false;
  } else {
    runtime.settings.volume.muted = true;
  }
  applyAudioVolume();
  persistDynamicSettings();
  resetVolumeHideTimer();
  renderAll();
}

function createPlaylist(name) {
  if (getPlaylists().length >= MAX_PLAYLISTS) {
    toast("warning", "歌单数量已满，无法再创建新歌单");
    return null;
  }
  const baseName = String(name ?? "").trim() || "新歌单";
  const siblings = getPlaylists().map((playlist) => playlist.name);
  let finalName = baseName;
  let suffix = 2;
  while (siblings.includes(finalName)) {
    finalName = `${baseName} (${suffix})`;
    suffix += 1;
  }
  const playlist = {
    id: makeId("playlist"),
    name: finalName,
    isDefault: false,
    tracks: []
  };
  getPlaylists().push(playlist);
  runtime.settings.selectedPlaylistId = playlist.id;
  updateSettingsStore();
  persistDynamicSettings();
  renderAll();
  return getPlaylistById(playlist.id);
}

function addTracksToPlaylist(playlist, tracks) {
  const remainingCapacity = MAX_TRACKS_PER_PLAYLIST - playlist.tracks.length;
  if (remainingCapacity <= 0) {
    throw new Error("当前歌单容量已满，无法再添加歌曲");
  }
  const existingIds = new Set(
    playlist.tracks.map((track) => `${normalizeAudioSource(track.source)}:${String(track.id)}`)
  );
  const dedupedTracks = [];
  let skipped = 0;
  for (const track of tracks.map(normalizeTrack)) {
    const uniqueKey = `${track.source}:${track.id}`;
    if (existingIds.has(uniqueKey)) {
      skipped += 1;
      continue;
    }
    existingIds.add(uniqueKey);
    dedupedTracks.push({
      id: track.id,
      name: track.name,
      artist: track.artist,
      source: track.source || "netease"
    });
  }
  if (!dedupedTracks.length) {
    throw new Error(skipped ? "目标歌单中已存在相同歌曲。" : "没有可导入的歌曲。");
  }
  const acceptedTracks = dedupedTracks.slice(0, remainingCapacity);
  playlist.tracks.push(...acceptedTracks);
  updateSettingsStore();
  persistDynamicSettings();
  renderAll();
  if (skipped) {
    toast("warning", "部分歌曲重复，已自动跳过。");
  }
  if (acceptedTracks.length < dedupedTracks.length) {
    toast("warning", "当前歌单容量已满，无法再添加歌曲");
  }
}

function renamePlaylist(playlist, name) {
  const baseName = String(name ?? "").trim() || "未命名歌单";
  const others = getPlaylists()
    .filter((item) => item.id !== playlist.id)
    .map((item) => item.name);
  let finalName = baseName;
  let suffix = 2;
  while (others.includes(finalName)) {
    finalName = `${baseName} (${suffix})`;
    suffix += 1;
  }
  playlist.name = finalName;
  updateSettingsStore();
  persistDynamicSettings();
  renderAll();
}

function deletePlaylist(playlistId) {
  const playlist = getPlaylistById(playlistId);
  if (!playlist) {
    return;
  }
  if (playlist.isDefault) {
    toast("warning", "默认歌单不可删除。");
    return;
  }

  runtime.settings.playlists = runtime.settings.playlists.filter((item) => item.id !== playlistId);

  if (runtime.state.sourcePlaylistId === playlistId) {
    clearPlaybackState();
    runtime.settings.selectedPlaylistId = ensureDefaultPlaylist().id;
  } else if (runtime.settings.selectedPlaylistId === playlistId) {
    runtime.settings.selectedPlaylistId = ensureDefaultPlaylist().id;
  }

  updateSettingsStore();
  persistDynamicSettings();
  renderAll();
}

function getPopupApi() {
  const { Popup, POPUP_TYPE, POPUP_RESULT } = runtime.context;
  if (!Popup) {
    throw new Error("未找到 SillyTavern Popup API。");
  }
  return { Popup, POPUP_TYPE, POPUP_RESULT };
}

function closePopupByContentId(contentId) {
  const content = document.getElementById(contentId);
  const popup = content?.closest(".popup");
  const closeButton = popup?.querySelector(".dialogue_popup_close, .popup-close, .fa-circle-xmark, .fa-xmark");
  if (closeButton instanceof HTMLElement) {
    closeButton.click();
  } else {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
}

function mountPopupContent(contentId, bind) {
  window.setTimeout(() => {
    const content = document.getElementById(contentId);
    if (content) {
      bind(content);
    }
  }, 0);
}

async function showCustomPopup({ title, html, options = {}, bind }) {
  const { Popup, POPUP_TYPE } = getPopupApi();
  const contentId = `stmp_popup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const popup = new Popup(
    `<div id="${contentId}" class="stmp-popup-content">${html}</div>`,
    options.type ?? POPUP_TYPE.TEXT,
    title,
    {
      wide: true,
      allowVerticalScrolling: true,
      ...options
    }
  );
  mountPopupContent(contentId, (content) => bind?.(content, popup, contentId));
  const result = await popup.show();
  return { result, popup, contentId };
}

function promptConfirm(title, message) {
  const { Popup, POPUP_RESULT } = getPopupApi();
  return Popup.show.confirm(title, message).then((result) => result === POPUP_RESULT.AFFIRMATIVE);
}

function promptTextInput(title, defaultValue) {
  const { Popup } = getPopupApi();
  return Popup.show.input(title, "", String(defaultValue ?? ""));
}

async function promptPlaylistSelect() {
  const { Popup, POPUP_TYPE, POPUP_RESULT } = getPopupApi();
  const playlists = getPlaylists();
  let selectedPlaylistId = playlists[0]?.id ?? "";
  const popupId = `stmp_playlist_select_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const html = `
    <div id="${popupId}">
      <select class="text_pole stmp-text" data-playlist-select>
        ${playlists.map((playlist) => `<option value="${playlist.id}">${escapeHtml(playlist.name)}</option>`).join("")}
      </select>
    </div>
  `;
  const popup = new Popup(html, POPUP_TYPE.TEXT, "请选择歌单", {
    okButton: "确认",
    cancelButton: "取消"
  });
  window.setTimeout(() => {
    const select = document.querySelector(`#${popupId} [data-playlist-select]`);
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    selectedPlaylistId = select.value || selectedPlaylistId;
    select.addEventListener("change", () => {
      selectedPlaylistId = select.value || selectedPlaylistId;
    });
  }, 0);
  const result = await popup.show();
  if (result !== POPUP_RESULT.AFFIRMATIVE) {
    return null;
  }
  return getPlaylistById(selectedPlaylistId) ?? null;
}

async function showSongDetailModal(songDetail, defaultName) {
  const { POPUP_RESULT, POPUP_TYPE } = getPopupApi();
  const track = normalizeTrack(songDetail);
  const lyric = mergeTimedLyrics(songDetail.lyric?.lrc, songDetail.lyric?.tlyric);
  const sourceInfo = `${formatSourceLabel(track.source || runtime.settings.audioSource)} - ${track.id}`;
  const { result } = await showCustomPopup({
    title: "单曲解析结果",
    html: `
      <div class="stmp-song-detail">
        <img src="${escapeHtml(track.picUrl)}" alt="${escapeHtml(track.name)}" />
        <div class="stmp-detail-field"><strong>曲目</strong><div>${escapeHtml(track.name)}</div></div>
        <div class="stmp-detail-field"><strong>歌手</strong><div>${escapeHtml(track.artist)}</div></div>
        <div class="stmp-detail-field"><strong>专辑</strong><div>${escapeHtml(songDetail.album || "")}</div></div>
        <div class="stmp-detail-field"><strong>音质</strong><div>${escapeHtml(songDetail.media?.level || "")}</div></div>
        <div class="stmp-detail-field">
          <div class="stmp-detail-label-row"><strong>音源 - 歌曲ID</strong><button type="button" class="menu_button stmp-action-button stmp-copy-button" data-copy-url><i class="fa-solid fa-copy"></i></button></div>
          <div class="stmp-detail-value">${escapeHtml(sourceInfo)}</div>
        </div>
        <div class="stmp-detail-field">
          <strong>歌词</strong>
          <div class="stmp-detail-lyrics-box">${lyric ? escapeHtml(lyric).replaceAll("\n", "<br>") : ""}</div>
        </div>
      </div>
    `,
    options: {
      type: POPUP_TYPE.TEXT,
      okButton: "取消",
      customButtons: [
        { text: "导入歌单", result: POPUP_RESULT.CUSTOM1 },
        { text: "创建歌单", result: POPUP_RESULT.CUSTOM2 }
      ]
    },
    bind: (content, popup, contentId) => {
      content.querySelector("[data-copy-url]")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(sourceInfo);
        toast("success", "已复制音源与歌曲ID。");
      });
      void popup;
      void contentId;
    }
  });
  if (result === POPUP_RESULT.CUSTOM1) {
    const playlist = await promptPlaylistSelect();
    if (!playlist) {
      return showSongDetailModal(songDetail, defaultName);
    }
    addTracksToPlaylist(playlist, [track]);
    toast("success", "已导入歌单。");
    return showSongDetailModal(songDetail, defaultName);
  }
  if (result === POPUP_RESULT.CUSTOM2) {
    const name = await promptTextInput("创建歌单", defaultName);
    if (name === null) {
      return showSongDetailModal(songDetail, defaultName);
    }
    const playlist = createPlaylist(name);
    if (!playlist) {
      return showSongDetailModal(songDetail, defaultName);
    }
    addTracksToPlaylist(playlist, [track]);
    toast("success", "已创建并导入歌单。");
    return showSongDetailModal(songDetail, defaultName);
  }
}

async function insertTrackAsNext(track) {
  if (runtime.state.keepAliveMode) {
    toast("info", "请先解除静音");
    return;
  }
  if (runtime.state.queueKind === "api") {
    clearPlaybackState();
  }
  const normalized = normalizeTrack(track);
  if (!runtime.state.queue.length) {
    runtime.state.queue = [normalized];
    runtime.state.queueKind = "native";
    runtime.state.currentQueueIndex = 0;
    runtime.state.sourcePlaylistId = null;
  } else {
    const insertIndex = Math.max(runtime.state.currentQueueIndex, 0) + 1;
    runtime.state.queue.splice(insertIndex, 0, normalized);
    runtime.state.queueKind = "native";
    runtime.state.currentQueueIndex = insertIndex;
  }
  await playQueueIndex(runtime.state.currentQueueIndex);
}

function createApiTrack(entry) {
  return {
    id: entry.id || makeId("api_track"),
    name: String(entry.name ?? "").trim() || "未命名歌曲",
    artist: String(entry.artist ?? "").trim() || "未知歌手",
    source: entry.source ? normalizeAudioSource(entry.source) : "",
    album: String(entry.album ?? "").trim(),
    picUrl: String(entry.picUrl ?? "").trim()
  };
}

function buildApiSongData(entry) {
  const track = createApiTrack(entry);
  return {
    ...track,
    media: { url: String(entry.url ?? "").trim(), level: "" },
    lyric: { lrc: String(entry.lyric ?? "").trim() }
  };
}

function parseSourceTrackRef(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(qq|netease)\s*-\s*(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    source: normalizeAudioSource(match[1].toLowerCase()),
    id: String(match[2] ?? "").trim()
  };
}

async function replaceWithApiQueue(songItems, options = {}) {
  if (runtime.state.keepAliveMode) {
    await exitKeepAliveMode();
  }
  clearPlaybackState();
  runtime.state.queue = songItems.map((item) => normalizeTrack(item));
  runtime.state.queueKind = "api";
  runtime.state.currentQueueIndex = 0;
  runtime.state.sourcePlaylistId = null;
  runtime.state.queueOpen = false;
  for (const item of songItems) {
    if (item?.media?.url) {
      setSongDetailCache(item, deepClone(item), { pinned: Boolean(options.pinnedCache) });
    }
  }
  await playQueueIndex(0);
}

async function playApiKeywordQueue(payload = {}) {
  const source = normalizeAudioSource(runtime.settings.audioSource);
  const entries = Array.isArray(payload.tracks) ? payload.tracks : [];
  if (!entries.length) {
    toast("warning", "请提供要播放的关键词。");
    return false;
  }
  const resolvedItems = [];
  for (const entry of entries) {
    const keyword = String(entry?.keyword ?? "").trim();
    if (!keyword) {
      toast("warning", "存在空关键词，已跳过。");
      continue;
    }
    try {
      const data = await apiPost("/search", { keyword, limit: 1 }, source);
      const song = data?.songs?.[0];
      if (!song) {
        toast("warning", `未找到歌曲：${keyword}`);
        continue;
      }
      resolvedItems.push(
        normalizeTrack({
          id: song.id,
          name: song.name,
          artist: song.artists,
          source,
          album: song.album,
          picUrl: song.picUrl
        })
      );
    } catch (error) {
      toast("error", error.message || `搜索失败：${keyword}`);
    }
  }
  if (!resolvedItems.length) {
    toast("warning", "没有可播放的搜索结果。");
    return false;
  }
  await replaceWithApiQueue(resolvedItems);
  toast("success", "已更新播放队列。");
  return true;
}

async function playApiUrlQueue(payload = {}) {
  const entries = Array.isArray(payload.tracks) ? payload.tracks : [];
  if (!entries.length) {
    toast("warning", "请提供要播放的歌曲。");
    return false;
  }
  const resolvedItems = [];
  for (const entry of entries) {
    const url = String(entry?.url ?? "").trim();
    if (!url) {
      toast("warning", "存在缺少 URL 的歌曲，已跳过。");
      continue;
    }
    resolvedItems.push(buildApiSongData(entry));
  }
  if (!resolvedItems.length) {
    toast("warning", "没有可播放的直链歌曲。");
    return false;
  }
  await replaceWithApiQueue(resolvedItems, { pinnedCache: true });
  toast("success", "已更新播放队列。");
  return true;
}

async function playApiSourceIdQueue(payload = {}) {
  const entries = Array.isArray(payload.tracks) ? payload.tracks : [];
  if (!entries.length) {
    toast("warning", "请提供要播放的音源与歌曲ID。");
    return false;
  }
  const resolvedItems = [];
  for (const entry of entries) {
    const parsed = parseSourceTrackRef(entry);
    if (!parsed?.id) {
      toast("warning", "存在无效的音源与歌曲ID，已跳过。");
      continue;
    }
    try {
      const data = await apiPost(
        "/song",
        { id: parsed.id, level: getSourceSettings(parsed.source).defaultQuality },
        parsed.source
      );
      resolvedItems.push({
        id: String(data.id),
        name: data.name,
        artist: data.artists,
        source: parsed.source,
        album: data.album,
        picUrl: data.picUrl,
        media: data.media,
        lyric: data.lyric
      });
    } catch (error) {
      toast("error", error.message || `解析失败：${entry}`);
    }
  }
  if (!resolvedItems.length) {
    toast("warning", "没有可播放的音源与歌曲ID。");
    return false;
  }
  await replaceWithApiQueue(resolvedItems);
  toast("success", "已更新播放队列。");
  return true;
}

function registerGlobalApi() {
  globalThis.STMusicPlayer = {
    playByKeyword: (payload) => playApiKeywordQueue(payload),
    playByUrl: (payload) => playApiUrlQueue(payload),
    playBySourceId: (payload) => playApiSourceIdQueue(payload)
  };
}

function getDefaultResultPlaylistName(result) {
  if (result.kind === "search") {
    return result.keyword || "搜索结果";
  }
  if (result.kind === "song") {
    return result.track?.name || "单曲";
  }
  return result.name || "新歌单";
}

function renderResultRow(track, kind) {
  const deleteButton =
    kind === "playlist" || kind === "album"
      ? `<button type="button" class="menu_button stmp-action-button" data-row-action="remove"><i class="fa-solid fa-trash"></i></button>`
      : "";
  return `
    <div class="stmp-result-row" data-track-id="${track.id}">
      <img class="stmp-result-cover" src="${escapeHtml(track.picUrl || "")}" alt="${escapeHtml(track.name)}" />
      <div class="stmp-result-meta">
        <div class="stmp-result-title">${escapeHtml(track.name)} - ${escapeHtml(track.artist)}</div>
        <div class="stmp-result-subtitle">${track.album ? escapeHtml(track.album) : ""}</div>
      </div>
      <div class="stmp-inline-actions">
        <button type="button" class="menu_button stmp-action-button" data-row-action="inspect"><i class="fa-solid fa-magnifying-glass"></i></button>
        <button type="button" class="menu_button stmp-action-button" data-row-action="play"><i class="fa-solid fa-play"></i></button>
        <button type="button" class="menu_button stmp-action-button" data-row-action="add"><i class="fa-solid fa-plus"></i></button>
        ${deleteButton}
      </div>
    </div>
  `;
}

function showResultModal(result) {
  const state = {
    ...result,
    tracks: result.tracks.map(normalizeTrack)
  };
  void showResultsPopup(state);
}

async function showResultsPopup(state) {
  const { POPUP_TYPE, POPUP_RESULT } = getPopupApi();
  const heading =
    state.kind === "playlist" || state.kind === "album"
      ? `<div class="stmp-result-heading">${escapeHtml(state.name || "")}</div>`
      : "";
  const { result } = await showCustomPopup({
    title: state.title,
    html: `
      ${heading}
      <div class="stmp-result-list">${state.tracks.map((track) => renderResultRow(track, state.kind)).join("")}</div>
    `,
    options: {
      type: POPUP_TYPE.TEXT,
      okButton: "取消",
      customButtons: [
        { text: "导入歌单", result: POPUP_RESULT.CUSTOM1 },
        { text: "创建歌单", result: POPUP_RESULT.CUSTOM2 }
      ]
    },
    bind: (content, popup, contentId) => {
      void popup;
      content.querySelector(".stmp-result-list")?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-row-action]");
        if (!button) {
          return;
        }
        const row = button.closest("[data-track-id]");
        const track = state.tracks.find((item) => item.id === row.dataset.trackId);
        if (!track) {
          return;
        }
        try {
          if (button.dataset.rowAction === "inspect") {
            closePopupByContentId(contentId);
            const detail = await getSongDetail(track, true);
            await showSongDetailModal(detail, track.name);
          }
          if (button.dataset.rowAction === "play") {
            closePopupByContentId(contentId);
            await insertTrackAsNext(track);
          }
          if (button.dataset.rowAction === "add") {
            const playlist = await promptPlaylistSelect();
            if (!playlist) {
              return;
            }
            addTracksToPlaylist(playlist, [track]);
            toast("success", "已添加至歌单。");
          }
          if (button.dataset.rowAction === "remove") {
            state.tracks = state.tracks.filter((item) => item.id !== track.id);
            closePopupByContentId(contentId);
            await showResultsPopup(state);
          }
        } catch (error) {
          toast("error", error.message || "操作失败。");
        }
      });
    }
  });
  if (result === POPUP_RESULT.CUSTOM1) {
    const playlist = await promptPlaylistSelect();
    if (!playlist) {
      return showResultsPopup(state);
    }
    addTracksToPlaylist(playlist, state.tracks);
    toast("success", "已导入歌单。");
    return showResultsPopup(state);
  }
  if (result === POPUP_RESULT.CUSTOM2) {
    const name = await promptTextInput("创建歌单", getDefaultResultPlaylistName(state));
    if (name === null) {
      return showResultsPopup(state);
    }
    const playlist = createPlaylist(name);
    if (!playlist) {
      return showResultsPopup(state);
    }
    addTracksToPlaylist(playlist, state.tracks);
    toast("success", "已创建并导入歌单。");
    return showResultsPopup(state);
  }
}

async function runResolverAction() {
  const action = runtime.dom.actionSelect.value;
  const input = runtime.dom.actionInput.value.trim();
  const audioSource = normalizeAudioSource(runtime.settings.audioSource);
  if (!input) {
    toast("warning", action === "search" ? "请输入关键词。" : "请输入有效的ID或MID。");
    return;
  }

  try {
    if (action === "search") {
      const data = await apiPost("/search", { keyword: input, limit: 20 }, audioSource);
      showResultModal({
        kind: "search",
        title: `搜索结果：${data.keyword}`,
        keyword: data.keyword,
        tracks: (data.songs ?? []).map((song) => ({
          id: song.id,
          name: song.name,
          artist: song.artists,
          source: audioSource,
          album: song.album,
          picUrl: song.picUrl
        }))
      });
      return;
    }

    if (action === "song") {
      const data = await apiPost(
        "/song",
        { id: input, level: getSourceSettings(audioSource).defaultQuality },
        audioSource
      );
      data.source = audioSource;
      await showSongDetailModal(data, data.name);
      return;
    }

    if (action === "playlist") {
      const data = await apiPost("/playlist", { id: input }, audioSource);
      showResultModal({
        kind: "playlist",
        title: `歌单解析：${data.name}`,
        name: data.name,
        tracks: (data.songs ?? []).map((song) => ({
          id: song.id,
          name: song.name,
          artist: song.artists,
          source: audioSource,
          album: song.album,
          picUrl: song.picUrl
        }))
      });
      return;
    }

    const data = await apiPost("/album", { id: input }, audioSource);
    showResultModal({
      kind: "album",
      title: `专辑解析：${data.name}`,
      name: data.name,
      tracks: (data.songs ?? []).map((song) => ({
        id: song.id,
        name: song.name,
        artist: song.artists,
        source: audioSource,
        album: song.album,
        picUrl: song.picUrl
      }))
    });
  } catch (error) {
    toast("error", error.message || "解析失败。");
  }
}

async function openPlaylistEditor() {
  const playlist = getSelectedPlaylist();
  if (!playlist) {
    return;
  }
  const draft = {
    name: playlist.name,
    tracks: playlist.tracks.map((track) => ({ ...track }))
  };
  await showPlaylistEditorPopup(playlist.id, draft);
}

async function showPlaylistEditorPopup(playlistId, draft) {
  const { POPUP_RESULT, POPUP_TYPE } = getPopupApi();
  const renderEditRows = () =>
    draft.tracks
      .map(
        (track, index) => `
          <div class="stmp-edit-row" data-index="${index}" draggable="true">
            <button type="button" class="stmp-drag-handle" data-drag-handle aria-label="拖拽排序">
              <span></span><span></span><span></span>
            </button>
            <div class="stmp-edit-name">${renderSourceLogoMarkup(track.source)}<span>${escapeHtml(track.name)} - ${escapeHtml(track.artist)}</span></div>
            <div class="stmp-inline-actions">
              <button type="button" class="menu_button stmp-action-button" data-edit-action="remove"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `
      )
      .join("");
  const { result } = await showCustomPopup({
    title: "歌单编辑",
    html: `
      <div class="stmp-edit-header">
        <div class="stmp-edit-header-row">
          <label class="stmp-edit-header-label" for="stmp-edit-name-input">歌单</label>
          <input id="stmp-edit-name-input" class="text_pole stmp-text" data-edit-name-input type="text" value="${escapeHtml(draft.name)}" />
        </div>
      </div>
      <div class="stmp-edit-list">${renderEditRows()}</div>
    `,
    options: {
      type: POPUP_TYPE.TEXT,
      okButton: "保存",
      cancelButton: "取消"
    },
    bind: (content, popup, contentId) => {
      let dragIndex = -1;
      const list = content.querySelector(".stmp-edit-list");

      content.querySelector("[data-edit-name-input]")?.addEventListener("input", (event) => {
        draft.name = String(event.target.value ?? "").trim() || "未命名歌单";
      });
      void popup;
      list?.addEventListener("dragstart", (event) => {
        const row = event.target.closest(".stmp-edit-row");
        if (!row) {
          return;
        }
        dragIndex = Number(row.dataset.index);
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(dragIndex));
      });
      list?.addEventListener("dragend", (event) => {
        event.target.closest(".stmp-edit-row")?.classList.remove("dragging");
      });
      list?.addEventListener("dragover", (event) => {
        const row = event.target.closest(".stmp-edit-row");
        if (!row) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      list?.addEventListener("drop", (event) => {
        const row = event.target.closest(".stmp-edit-row");
        if (!row || dragIndex < 0) {
          return;
        }
        event.preventDefault();
        const dropIndex = Number(row.dataset.index);
        if (dropIndex === dragIndex) {
          dragIndex = -1;
          return;
        }
        const moved = draft.tracks.splice(dragIndex, 1)[0];
        draft.tracks.splice(dropIndex, 0, moved);
        dragIndex = -1;
        list.innerHTML = renderEditRows();
      });
      list?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-edit-action]");
        if (!button) {
          return;
        }
        const nameInput = content.querySelector("[data-edit-name-input]");
        draft.name = String(nameInput?.value ?? draft.name).trim() || "未命名歌单";
        const row = button.closest("[data-index]");
        const index = Number(row.dataset.index);
        const action = button.dataset.editAction;
        if (action === "remove") {
          draft.tracks.splice(index, 1);
        }
        closePopupByContentId(contentId);
        await showPlaylistEditorPopup(playlistId, draft);
      });
    }
  });
  if (result === POPUP_RESULT.AFFIRMATIVE || result === POPUP_RESULT.POSITIVE) {
    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return;
    }
    playlist.tracks = draft.tracks.map((track) => ({ ...track }));
    renamePlaylist(playlist, draft.name);
    updateSettingsStore();
    persistDynamicSettings();
    toast("success", "歌单已保存。");
  }
}

function buildSettingsMarkup() {
  return `
    <div class="stmp-panel">
      <div class="stmp-player-host" id="stmp-player-host"></div>
      <div class="stmp-config-panel">
        <div class="stmp-row">
          <div class="stmp-source-tabs" role="tablist" aria-label="音源选择">
            ${AUDIO_SOURCE_OPTIONS.map(
              (option) => `
                <button
                  type="button"
                  class="stmp-source-tab"
                  data-source-tab="${option.value}"
                  role="tab"
                  aria-label="${option.label}"
                  title="${option.label}"
                >
                  <img src="${AUDIO_SOURCE_LOGOS[option.value]}" alt="${option.label}" />
                </button>
              `
            ).join("")}
          </div>
          <div class="stmp-grow-end"></div>
          <label class="stmp-toggle-label" for="stmp-floating-lyrics">
            悬浮歌词
            <input id="stmp-floating-lyrics" type="checkbox" />
          </label>
        </div>
        <div class="stmp-source-config-drawer" data-role="source-config-drawer" data-expanded="false">
          <div class="stmp-source-config-inner">
            <div class="stmp-row">
              <label class="stmp-inline-label" for="stmp-base-url">Base URL</label>
              <input id="stmp-base-url" class="text_pole stmp-text stmp-grow" type="text" placeholder="https://example.workers.dev" />
            </div>
            <div class="stmp-row">
              <label class="stmp-inline-label" for="stmp-access-token">Access Token</label>
              <input id="stmp-access-token" class="text_pole stmp-text stmp-grow" type="text" placeholder="UUID" />
            </div>
            <div class="stmp-row">
              <div class="stmp-quality-wrap">
                <label class="stmp-inline-label" for="stmp-quality">默认音质</label>
                <select id="stmp-quality" class="text_pole stmp-grow"></select>
              </div>
              <button type="button" id="stmp-save-config" class="menu_button stmp-save-button stmp-shrink" title="保存配置"><i class="fa-solid fa-floppy-disk"></i></button>
            </div>
            <div class="stmp-row">
              <select id="stmp-action" class="text_pole stmp-shrink"></select>
              <input id="stmp-action-input" class="text_pole stmp-text stmp-grow" type="text" />
              <button type="button" id="stmp-run-action" class="menu_button stmp-action-button stmp-shrink"><i class="fa-solid fa-magnifying-glass"></i></button>
            </div>
            <div class="stmp-row-label">我的歌单</div>
            <div class="stmp-row">
              <select id="stmp-playlist-select" class="text_pole stmp-grow"></select>
              <div class="stmp-icon-row">
                <button type="button" id="stmp-play-playlist" class="menu_button stmp-action-button"><i class="fa-solid fa-play"></i></button>
                <button type="button" id="stmp-edit-playlist" class="menu_button stmp-action-button"><i class="fa-solid fa-pen"></i></button>
                <button type="button" id="stmp-create-playlist" class="menu_button stmp-action-button"><i class="fa-solid fa-plus"></i></button>
                <button type="button" id="stmp-delete-playlist" class="menu_button stmp-action-button"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function findDrawerContainer() {
  const selectors = [
    "#extensions_settings2",
    "#extensions_settings",
    "#extensions_settings_container",
    "#extensionsMenu"
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function wireConfigEvents() {
  runtime.dom.playlistSelect.addEventListener("change", (event) => {
    runtime.settings.selectedPlaylistId = event.target.value;
    persistDynamicSettings();
  });

  runtime.dom.sourceTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextSource = normalizeAudioSource(button.dataset.sourceTab);
      if (nextSource === runtime.settings.audioSource) {
        runtime.state.sourceConfigExpanded = !runtime.state.sourceConfigExpanded;
        renderConfigInputs();
        return;
      }

      if (!runtime.state.sourceConfigExpanded) {
        runtime.settings.audioSource = nextSource;
        updateSettingsStore();
        persistDynamicSettings();
        runtime.state.sourceConfigExpanded = true;
        renderConfigInputs();
        return;
      }

      runtime.settings.audioSource = nextSource;
      updateSettingsStore();
      persistDynamicSettings();
      runtime.state.sourceConfigExpanded = true;
      renderConfigInputs();
    });
  });

  runtime.dom.saveConfigButton.addEventListener("click", () => {
    const nextSource = normalizeAudioSource(runtime.settings.audioSource);
    runtime.settings.audioSource = nextSource;
    runtime.settings.sourceSettings[nextSource] = {
      baseUrl: runtime.dom.baseUrlInput.value.trim(),
      accessToken: runtime.dom.accessTokenInput.value.trim(),
      defaultQuality: normalizeDefaultQualityForSource(nextSource, runtime.dom.qualitySelect.value)
    };
    updateSettingsStore();
    persistDynamicSettings();
    toast("success", "配置已保存。");
  });

  runtime.dom.floatingLyricsToggle?.addEventListener("change", (event) => {
    runtime.settings.floatingLyrics = Boolean(event.target.checked);
    persistDynamicSettings();
    renderFloatingLyrics();
  });

  runtime.dom.runActionButton.addEventListener("click", () => void runResolverAction());
  runtime.dom.actionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runResolverAction();
    }
  });

  runtime.dom.playPlaylistButton.addEventListener("click", async () => {
    if (runtime.state.keepAliveMode) {
      toast("info", "请先解除静音");
      return;
    }
    const playlist = getSelectedPlaylist();
    await startPlaylistPlayback(playlist);
  });

  runtime.dom.createPlaylistButton.addEventListener("click", async () => {
    const name = await promptTextInput("创建歌单", "");
    if (name === null) {
      return;
    }
    const playlist = createPlaylist(name);
    if (!playlist) {
      return;
    }
    toast("success", "歌单已创建。");
  });

  runtime.dom.editPlaylistButton.addEventListener("click", () => void openPlaylistEditor());

  runtime.dom.deletePlaylistButton.addEventListener("click", async () => {
    const playlist = getSelectedPlaylist();
    if (!playlist || playlist.isDefault) {
      toast("warning", "默认歌单不可删除。");
      return;
    }
    const confirmed = await promptConfirm(
      "删除歌单",
      `确定要删除歌单「${playlist.name}」吗？（此操作无法恢复）`
    );
    if (!confirmed) {
      return;
    }
    deletePlaylist(playlist.id);
    toast("success", "歌单已删除。");
  });
}

function bindAudioEvents() {
  runtime.audio.preload = "metadata";
  runtime.audio.addEventListener("timeupdate", () => {
    runtime.state.currentTime = runtime.audio.currentTime || 0;
    renderPlayer();
  });
  runtime.audio.addEventListener("loadedmetadata", () => {
    runtime.state.duration = Number.isFinite(runtime.audio.duration) ? runtime.audio.duration : 0;
    renderPlayer();
  });
  runtime.audio.addEventListener("play", () => {
    runtime.state.isPlaying = true;
    renderPlayer();
  });
  runtime.audio.addEventListener("pause", () => {
    runtime.state.isPlaying = false;
    renderPlayer();
  });
  runtime.audio.addEventListener("ended", () => {
    if (runtime.state.keepAliveMode) {
      runtime.audio.currentTime = 0;
      void runtime.audio.play().catch(() => {});
      return;
    }
    void advanceQueue();
  });
  runtime.audio.addEventListener("error", () => {
    if (runtime.state.keepAliveMode) {
      runtime.state.isPlaying = false;
      renderPlayer();
      return;
    }
    void advanceAfterPlaybackFailure();
  });
}

async function mountUI() {
  const drawerHost = findDrawerContainer();
  if (!drawerHost) {
    throw new Error("未找到 SillyTavern 扩展抽屉容器。");
  }

  const drawer = document.createElement("div");
  drawer.className = "stmp-drawer inline-drawer";
  drawer.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>ST Music Player</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">${buildSettingsMarkup()}</div>
  `;
  drawerHost.append(drawer);

  const root = drawer.querySelector(".inline-drawer-content");
  runtime.dom = {
    drawer,
    root,
    playerHost: root.querySelector("#stmp-player-host"),
    sourceTabButtons: [...root.querySelectorAll("[data-source-tab]")],
    sourceConfigDrawer: root.querySelector('[data-role="source-config-drawer"]'),
    baseUrlInput: root.querySelector("#stmp-base-url"),
    accessTokenInput: root.querySelector("#stmp-access-token"),
    qualitySelect: root.querySelector("#stmp-quality"),
    floatingLyricsToggle: root.querySelector("#stmp-floating-lyrics"),
    saveConfigButton: root.querySelector("#stmp-save-config"),
    actionSelect: root.querySelector("#stmp-action"),
    actionInput: root.querySelector("#stmp-action-input"),
    runActionButton: root.querySelector("#stmp-run-action"),
    playlistSelect: root.querySelector("#stmp-playlist-select"),
    playPlaylistButton: root.querySelector("#stmp-play-playlist"),
    editPlaylistButton: root.querySelector("#stmp-edit-playlist"),
    createPlaylistButton: root.querySelector("#stmp-create-playlist"),
    deletePlaylistButton: root.querySelector("#stmp-delete-playlist")
  };

  runtime.dom.actionSelect.innerHTML = ACTION_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join("");

  const floatingLyricsHost = getFloatingLyricsHost();
  if (floatingLyricsHost) {
    const floatingLyrics = document.createElement("div");
    floatingLyrics.className = "stmp-floating-lyrics";
    floatingLyrics.hidden = true;
    floatingLyrics.innerHTML = `
      <div class="stmp-floating-lyrics-track">
        <div class="stmp-floating-lyric-line current"></div>
        <div class="stmp-floating-lyric-line next"></div>
      </div>
    `;
    floatingLyricsHost.append(floatingLyrics);
    runtime.dom.floatingLyricsHost = floatingLyricsHost;
    runtime.dom.floatingLyrics = floatingLyrics;
    runtime.dom.floatingLyricsTrack = floatingLyrics.querySelector(".stmp-floating-lyrics-track");
    runtime.dom.floatingLyricCurrent = floatingLyrics.querySelector(".stmp-floating-lyric-line.current");
    runtime.dom.floatingLyricNext = floatingLyrics.querySelector(".stmp-floating-lyric-line.next");
    bindFloatingLyricsDrag();
  }

  runtime.playerView = await createPlayerView(runtime.dom.playerHost, {
    onPrev: () => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      void skipToPrevious();
    },
    onPlayToggle: () => void togglePlay(),
    onNext: () => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      void skipToNext();
    },
    onToggleQueue: () => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      runtime.state.queueOpen = !runtime.state.queueOpen;
      renderAll();
    },
    onCycleMode: () => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      cyclePlayMode();
    },
    onVolumeToggle: () => handleVolumeButton(),
    onVolumeInput: (value) => setVolume(value),
    onSeekPreview: (percent) => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      runtime.state.previewProgressPercent = percent;
      renderAll();
    },
    onSeekCommit: (percent) => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      runtime.state.previewProgressPercent = null;
      if (runtime.state.duration > 0) {
        const targetTime = (percent / 100) * runtime.state.duration;
        runtime.audio.currentTime = targetTime;
      }
      renderAll();
    },
    onQueueSelect: (index) => {
      if (runtime.state.keepAliveMode) {
        toast("info", "请先解除静音");
        return;
      }
      void playQueueIndex(index);
    }
  });

  wireConfigEvents();
  renderAll();
}

function loadSettings() {
  const settingsRoot = runtime.context.extensionSettings;
  settingsRoot[MODULE_KEY] = SillyTavern.libs.lodash.merge(
    deepClone(DEFAULT_SETTINGS),
    settingsRoot[MODULE_KEY]
  );
  runtime.settings = settingsRoot[MODULE_KEY];
  runtime.settings.sourceSettings = normalizeSourceSettings({
    ...runtime.settings.sourceSettings,
    netease: {
      ...runtime.settings.sourceSettings?.netease,
      baseUrl: runtime.settings.sourceSettings?.netease?.baseUrl ?? runtime.settings.baseUrl,
      accessToken: runtime.settings.sourceSettings?.netease?.accessToken ?? runtime.settings.accessToken,
      defaultQuality: runtime.settings.sourceSettings?.netease?.defaultQuality ?? runtime.settings.defaultQuality
    }
  });
  runtime.settings.audioSource = normalizeAudioSource(runtime.settings.audioSource);
  ensureDefaultPlaylist();
  enforcePlaylistLimits();
  ensureDefaultPlaylist();
  runtime.settings.playlists = runtime.settings.playlists.map((playlist) => ({
    ...playlist,
    tracks: (playlist.tracks ?? []).map((track) => ({
      ...track,
      source: normalizeAudioSource(track?.source || "netease")
    }))
  }));
  runtime.state.lastNonZeroVolume = runtime.settings.volume.value || 0.8;
  applyAudioVolume();
}

function restoreKeepAliveModeFromSettings() {
  ensureInitialMuteSyncHandler();
}

async function initializeExtension() {
  if (runtime.initialized) {
    return;
  }

  runtime.context = getSTContext();
  if (!runtime.context?.extensionSettings) {
    console.warn("[ST-MusicPlayer] SillyTavern context unavailable.");
    return;
  }

  runtime.saveSettingsDebounced = runtime.context.saveSettingsDebounced?.bind(runtime.context) ?? (() => {});
  loadSettings();
  bindAudioEvents();

  try {
    await mountUI();
    runtime.initialized = true;
    updateSettingsStore();
    registerGlobalApi();
    restoreKeepAliveModeFromSettings();
    renderAll();
  } catch (error) {
    console.error("[ST-MusicPlayer] init failed", error);
    toast("error", error.message || "扩展初始化失败。");
  }
}

jQuery(() => {
  const context = getSTContext();
  const { eventSource, event_types } = context ?? {};
  if (eventSource && event_types?.APP_READY) {
    eventSource.on(event_types.APP_READY, () => {
      window.setTimeout(() => {
        void initializeExtension();
      }, 0);
    });
  } else {
    void initializeExtension();
  }
});
