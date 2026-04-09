const ICONS = {
  play: new URL("./icons/play_arrow_40dp_1F1F1F_FILL1_wght300_GRAD0_opsz40.svg", import.meta.url).href,
  pause: new URL("./icons/pause_40dp_1F1F1F_FILL1_wght300_GRAD0_opsz40.svg", import.meta.url).href,
  "skip-back": new URL("./icons/skip_previous_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  "skip-forward": new URL("./icons/skip_next_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  repeat: new URL("./icons/repeat_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  "repeat-1": new URL("./icons/repeat_one_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  shuffle: new URL("./icons/shuffle_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  "volume-2": new URL("./icons/volume_up_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  "volume-off": new URL("./icons/volume_off_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href,
  "list-video": new URL("./icons/playlist_play_24dp_1F1F1F_FILL1_wght300_GRAD0_opsz24.svg", import.meta.url).href
};
const SOURCE_LOGOS = {
  netease: new URL("./icons/logo_Netease.png", import.meta.url).href,
  qq: new URL("./icons/logo_QQ.png", import.meta.url).href
};

let iconsPreloaded = false;

function preloadIcons() {
  if (iconsPreloaded) {
    return;
  }
  iconsPreloaded = true;
  Object.values(ICONS).forEach((src) => {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  });
}

const PLAYER_TEMPLATE = `
<section class="stmp-player-shell" data-stmp-player>
  <div class="stmp-player-card" data-empty="true">
    <div class="stmp-player-main">
      <div class="stmp-cover-wrap">
        <img class="stmp-cover" data-role="cover" alt="cover" />
        <div class="stmp-cover-empty" data-role="cover-empty"></div>
      </div>
      <div class="stmp-info">
        <div class="stmp-meta">
          <div class="stmp-title" data-role="title">未播放</div>
          <div class="stmp-artist" data-role="artist">请选择歌单开始播放</div>
        </div>
        <div class="stmp-lyrics-mask" data-role="lyrics">
          <div class="stmp-lyrics-track" data-role="lyrics-track">
            <div class="stmp-lyric-line current" data-role="lyric-current"></div>
            <div class="stmp-lyric-line next" data-role="lyric-next"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="stmp-bottom">
      <div class="stmp-progress-block">
        <div class="stmp-time-progress-row">
          <span class="stmp-time stmp-time-current" data-role="time-current">00:00</span>
          <div class="stmp-progress" data-role="progress">
            <div class="stmp-progress-track" data-role="progress-track">
              <div class="stmp-progress-fill" data-role="progress-fill"></div>
              <div class="stmp-progress-thumb" data-role="progress-thumb"></div>
            </div>
          </div>
          <span class="stmp-time stmp-time-total" data-role="time-total">00:00</span>
        </div>
      </div>
      <div class="stmp-controls">
        <div class="stmp-control-group stmp-control-group-left">
          <button type="button" class="stmp-icon-button" data-action="toggle-queue" aria-label="Playlist"></button>
          <button type="button" class="stmp-icon-button" data-action="cycle-mode" aria-label="Mode"></button>
        </div>
        <div class="stmp-control-group stmp-control-group-center">
          <button type="button" class="stmp-icon-button" data-action="prev" aria-label="Previous"></button>
          <button type="button" class="stmp-icon-button stmp-primary-button" data-action="play-toggle" aria-label="Play"></button>
          <button type="button" class="stmp-icon-button" data-action="next" aria-label="Next"></button>
        </div>
        <div class="stmp-control-group stmp-control-group-right">
          <div class="stmp-volume-box">
            <button type="button" class="stmp-icon-button" data-action="volume-toggle" aria-label="Volume"></button>
            <div class="stmp-volume-pop" data-role="volume-pop">
              <div class="stmp-volume-slider" data-role="volume-slider">
                <div class="stmp-volume-track" data-role="volume-track">
                  <div class="stmp-volume-fill" data-role="volume-fill"></div>
                  <div class="stmp-volume-thumb" data-role="volume-thumb"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="stmp-queue-panel" data-role="queue-panel" hidden>
      <div class="stmp-queue-list" data-role="queue-list"></div>
    </div>
  </div>
</section>
`;

function setIcon(element, name) {
  if (!element) {
    return;
  }
  if (element.dataset.iconName === name) {
    return;
  }
  const src = ICONS[name];
  element.innerHTML = src ? `<img class="stmp-icon-image" src="${src}" alt="" aria-hidden="true" />` : "";
  element.dataset.iconName = name || "";
}

function formatTime(seconds) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function createPlayerView(root, callbacks) {
  preloadIcons();
  root.innerHTML = PLAYER_TEMPLATE;

  const shell = root.querySelector("[data-stmp-player]");
  const elements = {
    shell,
    card: shell.querySelector(".stmp-player-card"),
    cover: shell.querySelector('[data-role="cover"]'),
    coverEmpty: shell.querySelector('[data-role="cover-empty"]'),
    title: shell.querySelector('[data-role="title"]'),
    artist: shell.querySelector('[data-role="artist"]'),
    lyrics: shell.querySelector('[data-role="lyrics"]'),
    lyricsTrack: shell.querySelector('[data-role="lyrics-track"]'),
    lyricCurrent: shell.querySelector('[data-role="lyric-current"]'),
    lyricNext: shell.querySelector('[data-role="lyric-next"]'),
    progress: shell.querySelector('[data-role="progress"]'),
    progressFill: shell.querySelector('[data-role="progress-fill"]'),
    progressThumb: shell.querySelector('[data-role="progress-thumb"]'),
    timeCurrent: shell.querySelector('[data-role="time-current"]'),
    timeTotal: shell.querySelector('[data-role="time-total"]'),
    queuePanel: shell.querySelector('[data-role="queue-panel"]'),
    queueList: shell.querySelector('[data-role="queue-list"]'),
    volumePop: shell.querySelector('[data-role="volume-pop"]'),
    volumeSlider: shell.querySelector('[data-role="volume-slider"]'),
    volumeFill: shell.querySelector('[data-role="volume-fill"]'),
    volumeThumb: shell.querySelector('[data-role="volume-thumb"]'),
    prevButton: shell.querySelector('[data-action="prev"]'),
    playButton: shell.querySelector('[data-action="play-toggle"]'),
    nextButton: shell.querySelector('[data-action="next"]'),
    queueButton: shell.querySelector('[data-action="toggle-queue"]'),
    modeButton: shell.querySelector('[data-action="cycle-mode"]'),
    volumeButton: shell.querySelector('[data-action="volume-toggle"]')
  };

  elements.queuePanel.hidden = false;

  setIcon(elements.prevButton, "skip-back");
  setIcon(elements.playButton, "play");
  setIcon(elements.nextButton, "skip-forward");
  setIcon(elements.queueButton, "list-video");
  setIcon(elements.modeButton, "repeat");
  setIcon(elements.volumeButton, "volume-2");

  elements.prevButton.addEventListener("click", () => callbacks.onPrev());
  elements.playButton.addEventListener("click", () => callbacks.onPlayToggle());
  elements.nextButton.addEventListener("click", () => callbacks.onNext());
  elements.queueButton.addEventListener("click", () => callbacks.onToggleQueue());
  elements.modeButton.addEventListener("click", () => callbacks.onCycleMode());
  elements.volumeButton.addEventListener("click", () => callbacks.onVolumeToggle());
  elements.queueList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-queue-index]");
    if (!row) {
      return;
    }
    callbacks.onQueueSelect(Number(row.dataset.queueIndex));
  });

  bindPointerBar({
    element: elements.progress,
    axis: "x",
    onPreview: (percent) => callbacks.onSeekPreview(percent * 100),
    onCommit: (percent) => callbacks.onSeekCommit(percent * 100)
  });

  bindPointerBar({
    element: elements.volumeSlider,
    axis: "y",
    isDisabled: () => elements.volumeSlider.dataset.locked === "true",
    onPreview: (percent) => callbacks.onVolumeInput(percent),
    onCommit: (percent) => callbacks.onVolumeInput(percent)
  });

  const previous = {
    empty: null,
    title: null,
    artist: null,
    cover: null,
    lyricKey: null,
    queueSignature: null,
    playIcon: null,
    modeIcon: null,
    volumeIcon: null,
    volumeVisible: null
  };

  return {
    render(viewState) {
      const {
        isEmpty,
        isPlaying,
        current,
        currentTime,
        duration,
        progressPercent,
        lyrics,
        queue,
        queueOpen,
        currentQueueIndex,
        playMode,
        volumeVisible,
        volume,
        isMuted,
        volumeLocked
      } = viewState;
      const lyricKey = `${lyrics?.current || ""}__${lyrics?.next || ""}`;
      const titleText = isEmpty ? "未播放" : (current?.name || "未知歌曲");
      const artistText = isEmpty ? "请选择歌单开始播放" : (current?.artist || "未知歌手");
      const coverUrl = current?.picUrl || "";

      if (previous.empty !== isEmpty) {
        elements.card.dataset.empty = String(Boolean(isEmpty));
        previous.empty = isEmpty;
      }
      if (previous.title !== titleText) {
        elements.title.textContent = titleText;
        previous.title = titleText;
      }
      if (previous.artist !== artistText) {
        elements.artist.textContent = artistText;
        previous.artist = artistText;
      }

      if (previous.cover !== coverUrl) {
        if (coverUrl) {
          elements.cover.src = coverUrl;
          elements.cover.hidden = false;
          elements.coverEmpty.hidden = true;
        } else {
          elements.cover.removeAttribute("src");
          elements.cover.hidden = true;
          elements.coverEmpty.hidden = false;
        }
        previous.cover = coverUrl;
      }

      if (previous.lyricKey !== lyricKey) {
        elements.lyricCurrent.textContent = lyrics?.current || "";
        elements.lyricNext.textContent = lyrics?.next || "";
        elements.lyrics.hidden = !lyrics?.current && !lyrics?.next;
        elements.lyricsTrack.dataset.lyricKey = lyricKey;
        elements.lyricsTrack.classList.remove("stmp-lyrics-animate");
        requestAnimationFrame(() => {
          if (elements.lyricsTrack.dataset.lyricKey === lyricKey) {
            elements.lyricsTrack.classList.add("stmp-lyrics-animate");
          }
        });
        previous.lyricKey = lyricKey;
      }

      const normalizedProgress = Math.max(0, Math.min(100, Number.isFinite(progressPercent) ? progressPercent : 0));
      const normalizedVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
      elements.progressFill.style.width = `${normalizedProgress}%`;
      elements.progressThumb.style.left = `${normalizedProgress}%`;
      elements.timeCurrent.textContent = formatTime(currentTime);
      elements.timeTotal.textContent = formatTime(duration);
      elements.volumeFill.style.height = `${normalizedVolume * 100}%`;
      elements.volumeThumb.style.bottom = `${normalizedVolume * 100}%`;
      elements.volumeSlider.dataset.locked = String(Boolean(volumeLocked));
      elements.volumeSlider.setAttribute("aria-disabled", String(Boolean(volumeLocked)));
      if (previous.volumeVisible !== Boolean(volumeVisible)) {
        elements.volumePop.classList.toggle("visible", Boolean(volumeVisible));
        previous.volumeVisible = Boolean(volumeVisible);
      }

      const queueSignature = JSON.stringify(queue.map((track) => [track.source || "", track.id, track.name, track.artist]));
      const currentSignature = `${queueOpen}_${currentQueueIndex}_${queueSignature}`;
      if (previous.queueSignature !== currentSignature) {
        const previousScroll = elements.queueList.scrollTop;
        elements.queueList.innerHTML = queue
          .map((track, index) => {
            const active = index === currentQueueIndex ? " active" : "";
            const sourceLogo =
              track?.source && SOURCE_LOGOS[track.source]
                ? `<img class="stmp-queue-source-logo" src="${SOURCE_LOGOS[track.source]}" alt="" aria-hidden="true" />`
                : "";
            return `<button type="button" class="stmp-queue-item${active}" data-queue-index="${index}">
              <span class="stmp-queue-name-row">
                <span class="stmp-queue-name">${escapeHtml(track.name || "未知歌曲")}</span>
                ${sourceLogo}
              </span>
              <span class="stmp-queue-artist">${escapeHtml(track.artist || "未知歌手")}</span>
            </button>`;
          })
          .join("");
        elements.queueList.scrollTop = previousScroll;
        previous.queueSignature = currentSignature;
      }
      elements.queuePanel.dataset.open = String(Boolean(queueOpen));
      elements.queuePanel.setAttribute("aria-hidden", String(!queueOpen));

      const playIcon = isPlaying ? "pause" : "play";
      const modeIcon = playMode === "shuffle" ? "shuffle" : playMode === "single" ? "repeat-1" : "repeat";
      const volumeIcon = isMuted || volume <= 0 ? "volume-off" : "volume-2";

      if (previous.playIcon !== playIcon) {
        setIcon(elements.playButton, playIcon);
        previous.playIcon = playIcon;
      }
      if (previous.modeIcon !== modeIcon) {
        setIcon(elements.modeButton, modeIcon);
        previous.modeIcon = modeIcon;
      }
      if (previous.volumeIcon !== volumeIcon) {
        setIcon(elements.volumeButton, volumeIcon);
        previous.volumeIcon = volumeIcon;
      }
    }
  };
}

function bindPointerBar({ element, axis, isDisabled = () => false, onPreview, onCommit }) {
  const getPercent = (event) => {
    const rect = element.getBoundingClientRect();
    if (axis === "y") {
      const offset = rect.bottom - event.clientY;
      return Math.max(0, Math.min(1, offset / rect.height));
    }
    const offset = event.clientX - rect.left;
    return Math.max(0, Math.min(1, offset / rect.width));
  };

  let dragging = false;

  const handleMove = (event) => {
    if (!dragging) {
      return;
    }
    onPreview(getPercent(event));
  };

  const handleUp = (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    onCommit(getPercent(event));
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
  };

  const handleCancel = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
  };

  element.addEventListener("pointerdown", (event) => {
    if (isDisabled()) {
      return;
    }
    dragging = true;
    element.setPointerCapture?.(event.pointerId);
    onPreview(getPercent(event));
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
  });
}
