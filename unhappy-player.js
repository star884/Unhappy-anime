(() => {
  'use strict';

  const HLS_URL =
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

  const SOURCE_TIMEOUT = 9000;
  const STORAGE_KEY = 'unhappy:player:v1';

  const state = {
    iframe: null,
    originalSrc: '',
    video: null,
    hls: null,
    token: 0,
    hlsPromise: null,
    customRoot: null,
    status: null,
    quality: null,
    speed: null,
    time: null,
    progress: null,
    volume: null,
    play: null,
    seekBack: null,
    seekForward: null,
    mute: null,
    fullscreen: null,
    pip: null,
    fallback: null,
    resizeObserver: null
  };

  const $ = (root, selector) =>
    root.querySelector(selector);

  function safeText(value) {
    return String(value ?? '').trim();
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value, location.href);

      return (
        url.protocol === 'http:' ||
        url.protocol === 'https:'
      );
    } catch (_) {
      return false;
    }
  }

  function isM3u8(value) {
    return /\.m3u8(?:[?#]|$)/i.test(value || '');
  }

  function loadSettings() {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_KEY) || '{}'
      );
    } catch (_) {
      return {};
    }
  }

  function saveSettings(patch) {
    try {
      const current = loadSettings();

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...current,
          ...patch
        })
      );
    } catch (_) {}
  }

  function formatTime(seconds) {
    if (
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return '00:00';
    }

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(
      (total % 3600) / 60
    );
    const secs = total % 60;

    if (hours) {
      return (
        `${hours}:` +
        `${String(minutes).padStart(2, '0')}:` +
        `${String(secs).padStart(2, '0')}`
      );
    }

    return (
      `${String(minutes).padStart(2, '0')}:` +
      `${String(secs).padStart(2, '0')}`
    );
  }

  function setStatus(message, busy = false) {
    if (!state.status) return;

    state.status.textContent = message;

    state.status.classList.toggle(
      'is-busy',
      busy
    );
  }

  function destroyHls() {
    if (state.hls) {
      try {
        state.hls.destroy();
      } catch (_) {}
    }

    state.hls = null;
  }

  function restoreIframe() {
    destroyHls();

    if (state.resizeObserver) {
      try {
        state.resizeObserver.disconnect();
      } catch (_) {}

      state.resizeObserver = null;
    }

    if (state.customRoot) {
      state.customRoot.remove();
    }

    state.customRoot = null;

    if (state.iframe) {
      state.iframe.hidden = false;
      state.iframe.style.display = '';
    }

    state.video = null;
  }

  function findIframe() {
    return (
      document.getElementById('playerFrame') ||
      document.querySelector('.player iframe') ||
      document.querySelector('#playerModal iframe')
    );
  }

  function getEmbedUrl(iframe) {
    return safeText(
      iframe?.getAttribute('src') ||
      iframe?.src
    );
  }

  async function fetchText(url) {
    const controller =
      new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      SOURCE_TIMEOUT
    );

    try {
      const response = await fetch(
        url,
        {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            Accept:
              'text/html,*/*;q=0.8'
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  function decodeJsString(value) {
    let output = safeText(value);

    try {
      output = output.replace(
        /\\x([0-9a-f]{2})/gi,
        (_, hex) =>
          String.fromCharCode(
            parseInt(hex, 16)
          )
      );

      output = output.replace(
        /\\u([0-9a-f]{4})/gi,
        (_, hex) =>
          String.fromCharCode(
            parseInt(hex, 16)
          )
      );

      output = output.replace(
        /\\\//g,
        '/'
      );
    } catch (_) {}

    return output;
  }

  function absoluteUrl(candidate, base) {
    const value = decodeJsString(candidate)
      .replace(/&amp;/g, '&');

    if (!value) return '';

    try {
      return new URL(
        value,
        base
      ).href;
    } catch (_) {
      return '';
    }
  }

  function extractM3u8(html, base) {
    const patterns = [
      /(?:file|src|source|hls|playlist)\s*[:=]\s*["']([^"']+\.m3u8(?:\?[^"']*)?)["']/ig,

      /["']([^"']+\.m3u8(?:\?[^"']*)?)["']/ig,

      /https?:\\?\/\\?\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/ig
    ];

    for (const pattern of patterns) {
      const matches = [
        ...html.matchAll(pattern)
      ];

      for (const match of matches) {
        const candidate =
          match[1] || match[0];

        const url = absoluteUrl(
          candidate,
          base
        );

        if (isM3u8(url)) {
          return url;
        }
      }
    }

    return '';
  }

  function createUi(iframe) {
    const parent =
      iframe.parentElement;

    if (!parent) return null;

    const root =
      document.createElement('div');

    root.className =
      'unhappy-player-root';

    root.innerHTML = `
      <div class="unhappy-video-shell">

        <video
          class="unhappy-video"
          playsinline
          preload="metadata"
        ></video>

        <div
          class="unhappy-center-status"
          aria-live="polite"
        ></div>

        <div class="unhappy-controls">

          <button
            type="button"
            data-action="play"
            title="Play / Pause"
          >▶</button>

          <button
            type="button"
            data-action="back"
            title="Back 10 seconds"
          >↶10</button>

          <button
            type="button"
            data-action="forward"
            title="Forward 10 seconds"
          >10↷</button>

          <input
            data-action="progress"
            type="range"
            min="0"
            max="1000"
            value="0"
            step="1"
            aria-label="Seek"
          >

          <span class="unhappy-time">
            00:00 / 00:00
          </span>

          <button
            type="button"
            data-action="mute"
            title="Mute"
          >🔊</button>

          <input
            data-action="volume"
            type="range"
            min="0"
            max="1"
            value="1"
            step="0.01"
            aria-label="Volume"
          >

          <select
            data-action="speed"
            title="Playback speed"
            aria-label="Playback speed"
          >
            <option value="0.5">0.5×</option>
            <option value="0.75">0.75×</option>
            <option value="1" selected>1×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
            <option value="1.75">1.75×</option>
            <option value="2">2×</option>
          </select>

          <select
            data-action="quality"
            title="Quality"
            aria-label="Quality"
          >
            <option value="auto">Auto</option>
          </select>

          <button
            type="button"
            data-action="pip"
            title="Picture in Picture"
          >PiP</button>

          <button
            type="button"
            data-action="fullscreen"
            title="Fullscreen"
          >⛶</button>

        </div>

        <div class="unhappy-statusbar">

          <span data-action="status">
            Preparing player…
          </span>

          <button
            type="button"
            data-action="fallback"
          >
            Use original player
          </button>

        </div>

      </div>
    `;

    parent.insertBefore(
      root,
      iframe
    );

    iframe.hidden = true;
    iframe.style.display = 'none';

    const video =
      $(root, 'video');

    state.customRoot = root;
    state.video = video;

    state.status =
      $(root, '[data-action="status"]');

    state.play =
      $(root, '[data-action="play"]');

    state.seekBack =
      $(root, '[data-action="back"]');

    state.seekForward =
      $(root, '[data-action="forward"]');

    state.progress =
      $(root, '[data-action="progress"]');

    state.time =
      $(root, '.unhappy-time');

    state.volume =
      $(root, '[data-action="volume"]');

    state.mute =
      $(root, '[data-action="mute"]');

    state.speed =
      $(root, '[data-action="speed"]');

    state.quality =
      $(root, '[data-action="quality"]');

    state.pip =
      $(root, '[data-action="pip"]');

    state.fullscreen =
      $(root, '[data-action="fullscreen"]');

    state.fallback =
      $(root, '[data-action="fallback"]');

    bindVideoEvents();

    return root;
  }

  function bindVideoEvents() {
    const video = state.video;

    if (!video) return;

    state.play.onclick = () => {
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    state.seekBack.onclick = () => {
      video.currentTime =
        Math.max(
          0,
          video.currentTime - 10
        );
    };

    state.seekForward.onclick = () => {
      if (
        Number.isFinite(
          video.duration
        )
      ) {
        video.currentTime =
          Math.min(
            video.duration,
            video.currentTime + 10
          );
      }
    };

    state.progress.oninput = () => {
      if (
        Number.isFinite(video.duration) &&
        video.duration > 0
      ) {
        video.currentTime =
          (
            Number(
              state.progress.value
            ) / 1000
          ) * video.duration;
      }
    };

    state.volume.oninput = () => {
      video.volume =
        Number(state.volume.value);

      video.muted =
        video.volume === 0;

      saveSettings({
        volume: video.volume,
        muted: video.muted
      });
    };

    state.mute.onclick = () => {
      video.muted =
        !video.muted;

      state.mute.textContent =
        video.muted
          ? '🔇'
          : '🔊';

      saveSettings({
        muted: video.muted
      });
    };

    state.speed.onchange = () => {
      video.playbackRate =
        Number(
          state.speed.value
        );

      saveSettings({
        speed: video.playbackRate
      });
    };

    state.quality.onchange = () => {
      if (!state.hls) return;

      const value =
        state.quality.value;

      state.hls.currentLevel =
        value === 'auto'
          ? -1
          : Number(value);
    };

    state.fullscreen.onclick =
      async () => {
        const shell =
          $(state.customRoot,
            '.unhappy-video-shell');

        try {
          if (
            document.fullscreenElement
          ) {
            await document.exitFullscreen();
          } else if (
            shell.requestFullscreen
          ) {
            await shell.requestFullscreen();
          } else if (
            video.webkitEnterFullscreen
          ) {
            video.webkitEnterFullscreen();
          }
        } catch (_) {}
      };

    state.pip.onclick =
      async () => {
        try {
          if (
            document.pictureInPictureElement
          ) {
            await document.exitPictureInPicture();
          } else if (
            document.pictureInPictureEnabled &&
            video.requestPictureInPicture
          ) {
            await video.requestPictureInPicture();
          }
        } catch (_) {}
      };

    state.fallback.onclick =
      restoreIframe;

    video.addEventListener(
      'loadedmetadata',
      () => {
        const saved =
          loadSettings();

        const savedVolume =
          Number(saved.volume);

        const volume =
          Number.isFinite(savedVolume)
            ? savedVolume
            : 1;

        const savedSpeed =
          Number(saved.speed);

        video.volume =
          Math.max(
            0,
            Math.min(1, volume)
          );

        video.muted =
          Boolean(saved.muted);

        video.playbackRate =
          Number.isFinite(savedSpeed)
            ? savedSpeed
            : 1;

        state.volume.value =
          String(video.volume);

        state.speed.value =
          String(video.playbackRate);

        state.mute.textContent =
          video.muted
            ? '🔇'
            : '🔊';

        updateTime();
      }
    );

    video.addEventListener(
      'timeupdate',
      updateTime
    );

    video.addEventListener(
      'durationchange',
      updateTime
    );

    video.addEventListener(
      'play',
      () => {
        state.play.textContent = '❚❚';
      }
    );

    video.addEventListener(
      'pause',
      () => {
        state.play.textContent = '▶';
      }
    );

    video.addEventListener(
      'waiting',
      () => {
        setStatus(
          'Buffering…',
          true
        );
      }
    );

    video.addEventListener(
      'playing',
      () => {
        setStatus(
          'Direct playback'
        );
      }
    );

    video.addEventListener(
      'error',
      () => {
        setStatus(
          'Direct playback failed — use original player.'
        );
      }
    );
  }

  function updateTime() {
    const video =
      state.video;

    if (
      !video ||
      !state.progress
    ) {
      return;
    }

    const duration =
      Number.isFinite(video.duration)
        ? video.duration
        : 0;

    const current =
      Number.isFinite(video.currentTime)
        ? video.currentTime
        : 0;

    state.progress.value =
      duration > 0
        ? String(
            Math.round(
              (current / duration) *
              1000
            )
          )
        : '0';

    state.time.textContent =
      `${formatTime(current)} / ` +
      `${formatTime(duration)}`;
  }

  function setQualityLevels() {
    if (!state.quality) return;

    state.quality.innerHTML =
      '<option value="auto">Auto</option>';

    if (
      !state.hls ||
      !state.hls.levels.length
    ) {
      return;
    }

    const seen =
      new Set();

    state.hls.levels.forEach(
      (level, index) => {
        const height =
          Number(level.height);

        const label =
          height
            ? `${height}p`
            : level.bitrate
              ? `${Math.round(
                  level.bitrate / 1000
                )} kbps`
              : `Level ${index + 1}`;

        if (seen.has(label)) return;

        seen.add(label);

        const option =
          document.createElement(
            'option'
          );

        option.value =
          String(index);

        option.textContent =
          label;

        state.quality.appendChild(
          option
        );
      }
    );
  }

  async function loadHlsLibrary() {
    if (window.Hls) {
      return window.Hls;
    }

    if (state.hlsPromise) {
      return state.hlsPromise;
    }

    state.hlsPromise =
      new Promise(
        (resolve, reject) => {
          const existing =
            document.querySelector(
              'script[data-unhappy-hls]'
            );

          if (existing) {
            existing.addEventListener(
              'load',
              () => resolve(window.Hls)
            );

            existing.addEventListener(
              'error',
              reject
            );

            return;
          }

          const script =
            document.createElement(
              'script'
            );

          script.src =
            HLS_URL;

          script.async = true;

          script.dataset.unhappyHls =
            '1';

          script.onload = () => {
            if (window.Hls) {
              resolve(window.Hls);
            } else {
              reject(
                new Error(
                  'HLS.js loaded without Hls'
                )
              );
            }
          };

          script.onerror = () => {
            reject(
              new Error(
                'Could not load HLS.js'
              )
            );
          };

          document.head.appendChild(
            script
          );
        }
      );

    return state.hlsPromise;
  }

  async function playDirect(
    m3u8,
    token
  ) {
    if (
      token !== state.token ||
      !state.video
    ) {
      return false;
    }

    const video =
      state.video;

    setStatus(
      'Opening direct stream…',
      true
    );

    if (
      video.canPlayType(
        'application/vnd.apple.mpegurl'
      )
    ) {
      video.src = m3u8;

      try {
        await video.play();
      } catch (_) {}

      if (
        token === state.token
      ) {
        setStatus(
          'Direct HLS playback'
        );
      }

      return true;
    }

    const Hls =
      await loadHlsLibrary();

    if (
      token !== state.token ||
      !state.video
    ) {
      return false;
    }

    if (!Hls.isSupported()) {
      throw new Error(
        'This browser does not support MSE/HLS playback.'
      );
    }

    destroyHls();

    state.hls =
      new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        capLevelToPlayerSize: true
      });

    state.hls.on(
      Hls.Events.MANIFEST_PARSED,
      () => {
        setQualityLevels();

        setStatus(
          'Direct HLS playback'
        );

        video.play().catch(
          () => {}
        );
      }
    );

    state.hls.on(
      Hls.Events.ERROR,
      (_, data) => {
        if (data?.fatal) {
          setStatus(
            'Stream error — original player remains available.'
          );
        }
      }
    );

    state.hls.loadSource(
      m3u8
    );

    state.hls.attachMedia(
      video
    );

    return true;
  }

  async function resolveSource(
    embedUrl,
    token
  ) {
    if (
      !isHttpUrl(embedUrl)
    ) {
      throw new Error(
        'Invalid embed URL'
      );
    }

    if (
      isM3u8(embedUrl)
    ) {
      return embedUrl;
    }

    const html =
      await fetchText(
        embedUrl
      );

    if (
      token !== state.token
    ) {
      return '';
    }

    return extractM3u8(
      html,
      embedUrl
    );
  }

  async function enhance(
    iframe
  ) {
    if (!iframe) return;

    const src =
      getEmbedUrl(iframe);

    if (
      !src ||
      src === state.originalSrc
    ) {
      return;
    }

    state.originalSrc =
      src;

    state.token += 1;

    const token =
      state.token;

    restoreIframe();

    createUi(iframe);

    if (!state.customRoot) {
      return;
    }

    try {
      const source =
        await resolveSource(
          src,
          token
        );

      if (
        token !== state.token
      ) {
        return;
      }

      if (!source) {
        throw new Error(
          'No direct HLS source found.'
        );
      }

      await playDirect(
        source,
        token
      );
    } catch (error) {
      if (
        token !== state.token
      ) {
        return;
      }

      console.info(
        '[UNHAPPY player] Direct source unavailable; keeping original embed.',
        error
      );

      setStatus(
        'Direct mode unavailable — original player ready.'
      );

      if (state.customRoot) {
        state.customRoot.classList.add(
          'direct-unavailable'
        );
      }

      if (iframe) {
        iframe.hidden = false;
        iframe.style.display = '';
      }
    }
  }

  function watchIframe() {
    let last = '';

    const scan = () => {
      const iframe =
        findIframe();

      if (!iframe) {
        return;
      }

      const src =
        getEmbedUrl(iframe);

      if (
        src &&
        (
          src !== last ||
          !state.customRoot ||
          !document.documentElement.contains(
            state.customRoot
          )
        )
      ) {
        last = src;

        enhance(
          iframe
        );
      }

      if (
        state.iframe !== iframe
      ) {
        state.iframe =
          iframe;
      }
    };

    const observer =
      new MutationObserver(
        scan
      );

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'src',
          'class'
        ]
      }
    );

    setInterval(
      scan,
      1000
    );

    scan();
  }

  function injectCss() {
    if (
      document.getElementById(
        'unhappy-player-css'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'unhappy-player-css';

    style.textContent = `
      .unhappy-player-root{
        position:relative;
        width:100%;
        margin:0;
        background:#000;
        border-radius:inherit;
        overflow:hidden;
        z-index:2
      }

      .unhappy-video-shell{
        position:relative;
        width:100%;
        background:#000;
        aspect-ratio:16/9;
        min-height:240px;
        display:flex;
        flex-direction:column;
        justify-content:flex-end
      }

      .unhappy-video{
        position:absolute;
        inset:0;
        width:100%;
        height:100%;
        background:#000;
        object-fit:contain
      }

      .unhappy-center-status{
        position:absolute;
        inset:0;
        display:grid;
        place-items:center;
        pointer-events:none;
        color:#fff;
        font-size:14px;
        text-shadow:0 2px 12px #000;
        opacity:.85
      }

      .unhappy-controls{
        position:relative;
        display:flex;
        align-items:center;
        gap:7px;
        padding:10px 10px 8px;
        background:
          linear-gradient(
            transparent,
            #07080df2 34%
          );
        z-index:3
      }

      .unhappy-controls button,
      .unhappy-controls select,
      .unhappy-controls input{
        height:34px;
        border:1px solid #ffffff20;
        border-radius:8px;
        background:#11151de8;
        color:#fff
      }

      .unhappy-controls button{
        padding:0 9px;
        cursor:pointer;
        font-weight:700
      }

      .unhappy-controls button:hover,
      .unhappy-controls select:hover{
        background:#ffffff18;
        border-color:#ffffff3d
      }

      .unhappy-controls input[type=range]{
        accent-color:#f2a900
      }

      .unhappy-controls
      [data-action=progress]{
        flex:1;
        min-width:70px
      }

      .unhappy-controls
      [data-action=volume]{
        width:76px
      }

      .unhappy-controls select{
        padding:0 7px;
        max-width:92px
      }

      .unhappy-time{
        font-variant-numeric:tabular-nums;
        color:#d9dce5;
        font-size:12px;
        white-space:nowrap
      }

      .unhappy-statusbar{
        display:flex;
        justify-content:space-between;
        gap:10px;
        padding:7px 10px;
        background:#090b10;
        border-top:1px solid #ffffff12;
        color:#8f8f9c;
        font-size:11px
      }

      .unhappy-statusbar button{
        border:0;
        background:none;
        color:#f2a900;
        padding:0;
        cursor:pointer
      }

      .unhappy-statusbar button:hover{
        text-decoration:underline
      }

      .unhappy-statusbar
      [data-action=status].is-busy::after{
        content:' ';
        display:inline-block;
        width:9px;
        height:9px;
        margin-left:6px;
        border:2px solid #ffffff33;
        border-top-color:#f2a900;
        border-radius:50%;
        animation:
          unhappy-spin .7s linear infinite;
        vertical-align:-1px
      }

      @keyframes unhappy-spin{
        to{
          transform:rotate(360deg)
        }
      }

      @media(max-width:700px){
        .unhappy-controls{
          gap:4px;
          padding:8px 6px
        }

        .unhappy-controls button{
          padding:0 6px;
          font-size:12px
        }

        .unhappy-controls
        [data-action=volume]{
          display:none
        }

        .unhappy-controls select{
          font-size:11px;
          max-width:72px
        }

        .unhappy-time{
          font-size:10px
        }
      }

      .unhappy-player-root.direct-unavailable{
        display:none
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function init() {
    injectCss();
    watchIframe();
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
