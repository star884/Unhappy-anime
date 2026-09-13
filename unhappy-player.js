(() => {
  'use strict';

  /*
   * UNHAPPY DIRECT PLAYER
   *
   * Purpose:
   * - Detect the existing player iframe.
   * - Attempt browser-permitted extraction of a direct media URL.
   * - Play HLS through native HLS or hls.js.
   * - Also support direct MP4/WebM/M4V/OGV sources.
   * - Keep the original iframe as a reliable fallback.
   *
   * Important:
   * Browser CORS rules are intentionally respected.
   * This script does NOT bypass Vidmoly/server access controls.
   */

  const HLS_URL =
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

  const SOURCE_TIMEOUT = 10000;

  const STORAGE_KEY =
    'unhappy:player:v2';

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
    root?.querySelector(selector);

  /*
   * ---------------------------------------------------------
   * BASIC HELPERS
   * ---------------------------------------------------------
   */

  function safeText(value) {
    return String(value ?? '').trim();
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(
        value,
        location.href
      );

      return (
        url.protocol === 'http:' ||
        url.protocol === 'https:'
      );
    } catch (_) {
      return false;
    }
  }

  function isM3u8(value) {
    return /\.m3u8(?:[?#]|$)/i.test(
      value || ''
    );
  }

  function isMediaUrl(value) {
    return /\.(?:m3u8|mp4|webm|m4v|ogv)(?:[?#]|$)/i.test(
      value || ''
    );
  }

  /*
   * ---------------------------------------------------------
   * PLAYER SETTINGS
   * ---------------------------------------------------------
   */

  function loadSettings() {
    try {
      return JSON.parse(
        localStorage.getItem(
          STORAGE_KEY
        ) || '{}'
      );
    } catch (_) {
      return {};
    }
  }

  function saveSettings(patch) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...loadSettings(),
          ...patch
        })
      );
    } catch (_) {}
  }

  /*
   * ---------------------------------------------------------
   * TIME / STATUS
   * ---------------------------------------------------------
   */

  function formatTime(seconds) {
    if (
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return '00:00';
    }

    const total =
      Math.floor(seconds);

    const hours =
      Math.floor(
        total / 3600
      );

    const minutes =
      Math.floor(
        (total % 3600) / 60
      );

    const secs =
      total % 60;

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

  function setStatus(
    message,
    busy = false
  ) {
    if (!state.status) {
      return;
    }

    state.status.textContent =
      message;

    state.status.classList.toggle(
      'is-busy',
      busy
    );
  }

  /*
   * ---------------------------------------------------------
   * HLS CLEANUP
   * ---------------------------------------------------------
   */

  function destroyHls() {
    if (state.hls) {
      try {
        state.hls.destroy();
      } catch (_) {}
    }

    state.hls = null;
  }

  /*
   * ---------------------------------------------------------
   * RESTORE ORIGINAL VIDMOLY IFRAME
   * ---------------------------------------------------------
   */

  function restoreIframe() {
    /*
     * Invalidate all asynchronous work
     * belonging to the current player.
     */
    state.token += 1;

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
    state.video = null;

    state.status = null;
    state.quality = null;
    state.speed = null;
    state.time = null;
    state.progress = null;
    state.volume = null;
    state.play = null;
    state.seekBack = null;
    state.seekForward = null;
    state.mute = null;
    state.fullscreen = null;
    state.pip = null;
    state.fallback = null;

    if (state.iframe) {
      state.iframe.hidden = false;
      state.iframe.style.display = '';
    }

    /*
     * Allow the same iframe to be detected again
     * if the application changes its source later.
     */
    state.originalSrc = '';
  }

  /*
   * ---------------------------------------------------------
   * FIND PLAYER IFRAME
   * ---------------------------------------------------------
   */

  function findIframe() {
    return (
      document.getElementById(
        'playerFrame'
      ) ||
      document.querySelector(
        '.player iframe'
      ) ||
      document.querySelector(
        '#playerModal iframe'
      )
    );
  }

  function getEmbedUrl(iframe) {
    return safeText(
      iframe?.getAttribute('src') ||
      iframe?.src
    );
  }

  /*
   * ---------------------------------------------------------
   * FETCH EMBED HTML
   * ---------------------------------------------------------
   *
   * Deliberately uses normal browser CORS.
   * If the remote server refuses CORS,
   * this operation fails and the original iframe
   * remains available.
   */

  async function fetchText(url) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        SOURCE_TIMEOUT
      );

    try {
      const response =
        await fetch(
          url,
          {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,

            headers: {
              Accept:
                'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
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

  /*
   * ---------------------------------------------------------
   * JAVASCRIPT STRING DECODING
   * ---------------------------------------------------------
   */

  function decodeJsString(value) {
    let output =
      safeText(value);

    try {
      /*
       * Decode \xNN
       */
      output =
        output.replace(
          /\\x([0-9a-f]{2})/gi,
          (_, hex) =>
            String.fromCharCode(
              parseInt(hex, 16)
            )
        );

      /*
       * Decode \uNNNN
       */
      output =
        output.replace(
          /\\u([0-9a-f]{4})/gi,
          (_, hex) =>
            String.fromCharCode(
              parseInt(hex, 16)
            )
        );

      /*
       * Decode escaped slashes.
       */
      output =
        output.replace(
          /\\\//g,
          '/'
        );

      /*
       * Decode HTML entities commonly
       * encountered inside attributes.
       */
      output =
        output.replace(
          /&amp;/g,
          '&'
        );

    } catch (_) {}

    return output;
  }

  /*
   * ---------------------------------------------------------
   * ABSOLUTE URL
   * ---------------------------------------------------------
   */

  function absoluteUrl(
    candidate,
    base
  ) {
    const value =
      decodeJsString(candidate)
        .replace(
          /^['"]|['"]$/g,
          ''
        );

    if (!value) {
      return '';
    }

    try {
      const url =
        new URL(
          value,
          base
        );

      if (
        url.protocol !== 'http:' &&
        url.protocol !== 'https:'
      ) {
        return '';
      }

      return url.href;

    } catch (_) {
      return '';
    }
  }

  /*
   * ---------------------------------------------------------
   * MEDIA SOURCE EXTRACTION
   * ---------------------------------------------------------
   *
   * Handles examples such as:
   *
   * sources: [{
   *   file: 'https://.../master.m3u8'
   * }]
   *
   * source: "..."
   *
   * file: "..."
   *
   * hls: "..."
   *
   * playlist: "..."
   *
   * and plain quoted media URLs.
   */

  function collectMediaCandidates(
    html,
    base
  ) {
    const output = [];
    const seen = new Set();

    function addCandidate(raw) {
      const url =
        absoluteUrl(
          raw,
          base
        );

      if (
        !url ||
        !isMediaUrl(url) ||
        seen.has(url)
      ) {
        return;
      }

      seen.add(url);
      output.push(url);
    }

    const patterns = [

      /*
       * Named source fields.
       */
      /(?:file|src|source|hls|playlist|url|stream)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|webm|m4v|ogv)(?:[?#][^"']*)?)["']/ig,

      /*
       * Any quoted media URL.
       */
      /["']([^"']+\.(?:m3u8|mp4|webm|m4v|ogv)(?:[?#][^"']*)?)["']/ig,

      /*
       * Plain absolute URL.
       */
      /https?:\\?\/\\?\/[^\s"'<>\\]+\.(?:m3u8|mp4|webm|m4v|ogv)(?:\?[^\s"'<>\\]*)?/ig
    ];

    for (
      const pattern of patterns
    ) {
      for (
        const match of html.matchAll(
          pattern
        )
      ) {
        addCandidate(
          match[1] ||
          match[0]
        );
      }
    }

    return output;
  }

  function extractSource(
    html,
    base
  ) {
    const candidates =
      collectMediaCandidates(
        html,
        base
      );

    /*
     * Prefer HLS because it provides
     * adaptive-quality playback.
     */
    const hls =
      candidates.find(
        isM3u8
      );

    if (hls) {
      return hls;
    }

    return candidates[0] || '';
  }

  /*
   * ---------------------------------------------------------
   * VIDMOLY URL NORMALIZATION
   * ---------------------------------------------------------
   *
   * Some Vidmoly URL forms use /v-{id}.html.
   *
   * When that form is encountered, we can also attempt
   * the corresponding classic embed URL.
   *
   * This does NOT bypass CORS.
   */

  function vidmolyClassicUrl(
    url
  ) {
    try {
      const parsed =
        new URL(
          url,
          location.href
        );

      if (
        !/vidmoly\./i.test(
          parsed.hostname
        )
      ) {
        return '';
      }

      const match =
        parsed.pathname.match(
          /\/(?:v|embed)-([A-Za-z0-9_-]+)(?:\.html)?$/i
        );

      if (!match) {
        return '';
      }

      return (
        `${parsed.origin}/embed-` +
        `${match[1]}.html`
      );

    } catch (_) {
      return '';
    }
  }

  function sourcePages(
    embedUrl
  ) {
    const pages = [
      embedUrl
    ];

    const classic =
      vidmolyClassicUrl(
        embedUrl
      );

    if (
      classic &&
      classic !== embedUrl
    ) {
      pages.push(classic);
    }

    return [
      ...new Set(pages)
    ];
  }

  /*
   * ---------------------------------------------------------
   * CREATE PLAYER UI
   * ---------------------------------------------------------
   */

  function createUi(
    iframe
  ) {
    const parent =
      iframe.parentElement;

    if (!parent) {
      return null;
    }

    const root =
      document.createElement(
        'div'
      );

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
            aria-label="Play or pause"
          >▶</button>

          <button
            type="button"
            data-action="back"
            title="Back 10 seconds"
            aria-label="Back 10 seconds"
          >↶10</button>

          <button
            type="button"
            data-action="forward"
            title="Forward 10 seconds"
            aria-label="Forward 10 seconds"
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
            aria-label="Mute"
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
            <option value="auto">
              Auto
            </option>
          </select>

          <button
            type="button"
            data-action="pip"
            title="Picture in Picture"
            aria-label="Picture in Picture"
          >PiP</button>

          <button
            type="button"
            data-action="fullscreen"
            title="Fullscreen"
            aria-label="Fullscreen"
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

    /*
     * Keep iframe available in DOM,
     * but hide it while direct mode works.
     */
    iframe.hidden = true;
    iframe.style.display = 'none';

    const video =
      $(root, 'video');

    state.customRoot =
      root;

    state.video =
      video;

    state.status =
      $(
        root,
        '[data-action="status"]'
      );

    state.play =
      $(
        root,
        '[data-action="play"]'
      );

    state.seekBack =
      $(
        root,
        '[data-action="back"]'
      );

    state.seekForward =
      $(
        root,
        '[data-action="forward"]'
      );

    state.progress =
      $(
        root,
        '[data-action="progress"]'
      );

    state.time =
      $(root, '.unhappy-time');

    state.volume =
      $(
        root,
        '[data-action="volume"]'
      );

    state.mute =
      $(
        root,
        '[data-action="mute"]'
      );

    state.speed =
      $(
        root,
        '[data-action="speed"]'
      );

    state.quality =
      $(
        root,
        '[data-action="quality"]'
      );

    state.pip =
      $(
        root,
        '[data-action="pip"]'
      );

    state.fullscreen =
      $(
        root,
        '[data-action="fullscreen"]'
      );

    state.fallback =
      $(
        root,
        '[data-action="fallback"]'
      );

    bindVideoEvents();

    return root;
  }

  /*
   * ---------------------------------------------------------
   * PLAYER EVENTS
   * ---------------------------------------------------------
   */

  function bindVideoEvents() {
    const video =
      state.video;

    if (!video) {
      return;
    }

    /*
     * Play / pause.
     */
    state.play.onclick =
      () => {
        if (video.paused) {
          video
            .play()
            .catch(() => {});
        } else {
          video.pause();
        }
      };

    /*
     * Back 10 seconds.
     */
    state.seekBack.onclick =
      () => {
        video.currentTime =
          Math.max(
            0,
            (video.currentTime || 0) - 10
          );
      };

    /*
     * Forward 10 seconds.
     */
    state.seekForward.onclick =
      () => {
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

    /*
     * Seek bar.
     */
    state.progress.oninput =
      () => {
        if (
          Number.isFinite(
            video.duration
          ) &&
          video.duration > 0
        ) {
          video.currentTime =
            (
              Number(
                state.progress.value
              ) / 1000
            ) *
            video.duration;
        }
      };

    /*
     * Volume.
     */
    state.volume.oninput =
      () => {
        video.volume =
          Math.max(
            0,
            Math.min(
              1,
              Number(
                state.volume.value
              ) || 0
            )
          );

        video.muted =
          video.volume === 0;

        updateMute();

        saveSettings({
          volume:
            video.volume,

          muted:
            video.muted
        });
      };

    /*
     * Mute.
     */
    state.mute.onclick =
      () => {
        video.muted =
          !video.muted;

        updateMute();

        saveSettings({
          muted:
            video.muted
        });
      };

    /*
     * Playback speed.
     */
    state.speed.onchange =
      () => {
        const rate =
          Number(
            state.speed.value
          );

        video.playbackRate =
          Number.isFinite(rate)
            ? rate
            : 1;

        saveSettings({
          speed:
            video.playbackRate
        });
      };

    /*
     * HLS quality.
     */
    state.quality.onchange =
      () => {
        if (!state.hls) {
          return;
        }

        const value =
          state.quality.value;

        state.hls.currentLevel =
          value === 'auto'
            ? -1
            : Number(value);
      };

    /*
     * Fullscreen.
     */
    state.fullscreen.onclick =
      async () => {
        const shell =
          $(
            state.customRoot,
            '.unhappy-video-shell'
          );

        try {
          if (
            document.fullscreenElement
          ) {
            await document.exitFullscreen();

          } else if (
            shell?.requestFullscreen
          ) {
            await shell.requestFullscreen();

          } else if (
            video.webkitEnterFullscreen
          ) {
            video.webkitEnterFullscreen();
          }
        } catch (_) {}
      };

    /*
     * Picture-in-picture.
     */
    state.pip.onclick =
      async () => {
        try {
          if (
            document.pictureInPictureElement
          ) {
            await document
              .exitPictureInPicture();

          } else if (
            document.pictureInPictureEnabled &&
            video.requestPictureInPicture
          ) {
            await video
              .requestPictureInPicture();
          }
        } catch (_) {}
      };

    /*
     * Restore Vidmoly iframe.
     */
    state.fallback.onclick =
      () => {
        restoreIframe();
      };

    /*
     * Metadata.
     */
    video.addEventListener(
      'loadedmetadata',
      () => {
        const settings =
          loadSettings();

        const savedVolume =
          Number(
            settings.volume
          );

        const savedSpeed =
          Number(
            settings.speed
          );

        video.volume =
          Number.isFinite(
            savedVolume
          )
            ? Math.max(
                0,
                Math.min(
                  1,
                  savedVolume
                )
              )
            : 1;

        video.muted =
          Boolean(
            settings.muted
          );

        video.playbackRate =
          Number.isFinite(
            savedSpeed
          )
            ? savedSpeed
            : 1;

        state.volume.value =
          String(
            video.volume
          );

        state.speed.value =
          String(
            video.playbackRate
          );

        updateMute();
        updateTime();
      }
    );

    /*
     * Time.
     */
    video.addEventListener(
      'timeupdate',
      updateTime
    );

    video.addEventListener(
      'durationchange',
      updateTime
    );

    /*
     * Play state.
     */
    video.addEventListener(
      'play',
      () => {
        state.play.textContent =
          '❚❚';
      }
    );

    video.addEventListener(
      'pause',
      () => {
        state.play.textContent =
          '▶';
      }
    );

    /*
     * Buffering.
     */
    video.addEventListener(
      'waiting',
      () => {
        setStatus(
          'Buffering…',
          true
        );
      }
    );

    /*
     * Playback started.
     */
    video.addEventListener(
      'playing',
      () => {
        setStatus(
          'Direct playback'
        );
      }
    );

    /*
     * Playback error.
     */
    video.addEventListener(
      'error',
      () => {
        if (
          state.customRoot
        ) {
          setStatus(
            'Playback error — original player is available.'
          );
        }
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * MUTE UI
   * ---------------------------------------------------------
   */

  function updateMute() {
    if (
      !state.mute ||
      !state.video
    ) {
      return;
    }

    state.mute.textContent =
      (
        state.video.muted ||
        state.video.volume === 0
      )
        ? '🔇'
        : '🔊';
  }

  /*
   * ---------------------------------------------------------
   * TIME UI
   * ---------------------------------------------------------
   */

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
      Number.isFinite(
        video.duration
      )
        ? video.duration
        : 0;

    const current =
      Number.isFinite(
        video.currentTime
      )
        ? video.currentTime
        : 0;

    state.progress.value =
      duration > 0
        ? String(
            Math.max(
              0,
              Math.min(
                1000,
                Math.round(
                  (
                    current /
                    duration
                  ) *
                  1000
                )
              )
            )
          )
        : '0';

    state.time.textContent =
      `${formatTime(current)} / ` +
      `${formatTime(duration)}`;
  }

  /*
   * ---------------------------------------------------------
   * HLS QUALITY LEVELS
   * ---------------------------------------------------------
   */

  function setQualityLevels() {
    if (!state.quality) {
      return;
    }

    state.quality.innerHTML =
      '<option value="auto">Auto</option>';

    if (
      !state.hls ||
      !state.hls.levels ||
      !state.hls.levels.length
    ) {
      return;
    }

    const levels =
      state.hls.levels
        .map(
          (level, index) => ({
            index,
            height:
              Number(
                level.height
              ) || 0,
            bitrate:
              Number(
                level.bitrate
              ) || 0
          })
        )
        .sort(
          (a, b) =>
            b.height - a.height ||
            b.bitrate - a.bitrate
        );

    const seen =
      new Set();

    for (
      const level of levels
    ) {
      const label =
        level.height
          ? `${level.height}p`
          : level.bitrate
            ? `${Math.round(
                level.bitrate / 1000
              )} kbps`
            : `Level ${level.index + 1}`;

      if (
        seen.has(label)
      ) {
        continue;
      }

      seen.add(label);

      const option =
        document.createElement(
          'option'
        );

      option.value =
        String(
          level.index
        );

      option.textContent =
        label;

      state.quality.appendChild(
        option
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * LOAD HLS.JS
   * ---------------------------------------------------------
   */

  async function loadHlsLibrary() {
    if (window.Hls) {
      return window.Hls;
    }

    if (state.hlsPromise) {
      return state.hlsPromise;
    }

    state.hlsPromise =
      new Promise(
        (
          resolve,
          reject
        ) => {
          let script =
            document.querySelector(
              'script[data-unhappy-hls]'
            );

          if (script) {
            if (window.Hls) {
              resolve(
                window.Hls
              );

              return;
            }

            script.addEventListener(
              'load',
              () => {
                if (
                  window.Hls
                ) {
                  resolve(
                    window.Hls
                  );
                } else {
                  reject(
                    new Error(
                      'HLS.js unavailable'
                    )
                  );
                }
              },
              {
                once: true
              }
            );

            script.addEventListener(
              'error',
              () => {
                reject(
                  new Error(
                    'Could not load HLS.js'
                  )
                );
              },
              {
                once: true
              }
            );

            return;
          }

          script =
            document.createElement(
              'script'
            );

          script.src =
            HLS_URL;

          script.async = true;

          script.dataset.unhappyHls =
            '1';

          script.onload =
            () => {
              if (
                window.Hls
              ) {
                resolve(
                  window.Hls
                );
              } else {
                reject(
                  new Error(
                    'HLS.js loaded without Hls'
                  )
                );
              }
            };

          script.onerror =
            () => {
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

  /*
   * ---------------------------------------------------------
   * WAIT FOR ACTUAL PLAYBACK
   * ---------------------------------------------------------
   *
   * Important correction:
   * video.play() resolving is not enough to claim
   * that playback actually started.
   */

  function waitForPlaying(
    video,
    timeout = 8000
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        if (
          !video.paused &&
          !video.ended
        ) {
          resolve();
          return;
        }

        let finished = false;

        let timer;

        const cleanup =
          () => {
            clearTimeout(
              timer
            );

            video.removeEventListener(
              'playing',
              onPlaying
            );

            video.removeEventListener(
              'error',
              onError
            );
          };

        const onPlaying =
          () => {
            if (finished) {
              return;
            }

            finished = true;

            cleanup();

            resolve();
          };

        const onError =
          () => {
            if (finished) {
              return;
            }

            finished = true;

            cleanup();

            reject(
              new Error(
                'Video element reported an error'
              )
            );
          };

        timer =
          setTimeout(
            () => {
              if (finished) {
                return;
              }

              finished = true;

              cleanup();

              reject(
                new Error(
                  'Playback did not start'
                )
              );
            },
            timeout
          );

        video.addEventListener(
          'playing',
          onPlaying,
          {
            once: true
          }
        );

        video.addEventListener(
          'error',
          onError,
          {
            once: true
          }
        );
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * DIRECT PLAYBACK
   * ---------------------------------------------------------
   */

  async function playDirect(
    source,
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

    if (
      !isHttpUrl(source)
    ) {
      throw new Error(
        'Invalid media source'
      );
    }

    setStatus(
      'Opening direct stream…',
      true
    );

    destroyHls();

    /*
     * Clear any previous media source.
     */
    video.removeAttribute(
      'src'
    );

    video.load();

    /*
     * -------------------------------------------------------
     * DIRECT MP4 / WEBM / ETC.
     * -------------------------------------------------------
     */

    if (
      !isM3u8(source)
    ) {
      video.src =
        source;

      try {
        await video.play();

        await waitForPlaying(
          video,
          8000
        );

      } catch (error) {
        throw new Error(
          'Direct media playback failed: ' +
          (
            error?.message ||
            'unknown error'
          )
        );
      }

      if (
        token !== state.token
      ) {
        throw new Error(
          'Player changed'
        );
      }

      setStatus(
        'Direct playback'
      );

      return true;
    }

    /*
     * -------------------------------------------------------
     * NATIVE HLS
     * -------------------------------------------------------
     */

    if (
      video.canPlayType(
        'application/vnd.apple.mpegurl'
      )
    ) {
      video.src =
        source;

      try {
        await video.play();

        await waitForPlaying(
          video,
          8000
        );

      } catch (error) {
        throw new Error(
          'Native HLS playback failed: ' +
          (
            error?.message ||
            'unknown error'
          )
        );
      }

      if (
        token !== state.token
      ) {
        throw new Error(
          'Player changed'
        );
      }

      setStatus(
        'Direct HLS playback'
      );

      return true;
    }

    /*
     * -------------------------------------------------------
     * HLS.JS
     * -------------------------------------------------------
     */

    const Hls =
      await loadHlsLibrary();

    if (
      token !== state.token ||
      !state.video
    ) {
      return false;
    }

    if (
      !Hls.isSupported()
    ) {
      throw new Error(
        'This browser does not support HLS playback'
      );
    }

    const hls =
      new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        capLevelToPlayerSize: true
      });

    state.hls =
      hls;

    /*
     * Manifest parsed.
     */
    hls.on(
      Hls.Events.MANIFEST_PARSED,
      () => {
        if (
          token !== state.token
        ) {
          return;
        }

        setQualityLevels();

        video
          .play()
          .catch(() => {});
      }
    );

    /*
     * New/updated quality levels.
     */
    hls.on(
      Hls.Events.LEVELS_UPDATED,
      () => {
        if (
          token === state.token
        ) {
          setQualityLevels();
        }
      }
    );

    /*
     * Fatal HLS errors.
     */
    hls.on(
      Hls.Events.ERROR,
      (_, data) => {
        if (
          token !== state.token
        ) {
          return;
        }

        if (
          data?.fatal
        ) {
          setStatus(
            'Stream error — original player is available.'
          );
        }
      }
    );

    /*
     * Attach the media element.
     */
    hls.attachMedia(
      video
    );

    /*
     * Load the playlist.
     */
    hls.loadSource(
      source
    );

    /*
     * Wait for actual metadata.
     */
    await new Promise(
      (
        resolve,
        reject
      ) => {
        let settled =
          false;

        const timer =
          setTimeout(
            () => {
              if (
                settled
              ) {
                return;
              }

              settled =
                true;

              cleanup();

              reject(
                new Error(
                  'HLS manifest did not load'
                )
              );
            },
            SOURCE_TIMEOUT
          );

        const cleanup =
          () => {
            clearTimeout(
              timer
            );

            video.removeEventListener(
              'loadedmetadata',
              onMetadata
            );

            video.removeEventListener(
              'error',
              onError
            );
          };

        const onMetadata =
          () => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            cleanup();

            resolve();
          };

        const onError =
          () => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            cleanup();

            reject(
              new Error(
                'HLS media error'
              )
            );
          };

        video.addEventListener(
          'loadedmetadata',
          onMetadata,
          {
            once: true
          }
        );

        video.addEventListener(
          'error',
          onError,
          {
            once: true
          }
        );
      }
    );

    if (
      token !== state.token
    ) {
      throw new Error(
        'Player changed'
      );
    }

    /*
     * Confirm actual playback.
     */
    try {
      await video.play();

      await waitForPlaying(
        video,
        8000
      );

    } catch (error) {
      throw new Error(
        'HLS playback failed: ' +
        (
          error?.message ||
          'unknown error'
        )
      );
    }

    setStatus(
      'Direct HLS playback'
    );

    return true;
  }

  /*
   * ---------------------------------------------------------
   * RESOLVE SOURCE
   * ---------------------------------------------------------
   */

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

    /*
     * If the iframe itself already points directly
     * to media, don't fetch HTML unnecessarily.
     */
    if (
      isMediaUrl(embedUrl)
    ) {
      return embedUrl;
    }

    let lastError =
      null;

    const pages =
      sourcePages(
        embedUrl
      );

    for (
      const page of pages
    ) {
      if (
        token !== state.token
      ) {
        return '';
      }

      try {
        setStatus(
          'Resolving direct source…',
          true
        );

        const html =
          await fetchText(
            page
          );

        if (
          token !== state.token
        ) {
          return '';
        }

        const source =
          extractSource(
            html,
            page
          );

        if (source) {
          return source;
        }

        lastError =
          new Error(
            'No supported media URL in page'
          );

      } catch (error) {
        lastError =
          error;
      }
    }

    throw (
      lastError ||
      new Error(
        'Could not read embed page'
      )
    );
  }

  /*
   * ---------------------------------------------------------
   * ENHANCE IFRAME
   * ---------------------------------------------------------
   */

  async function enhance(
    iframe
  ) {
    if (!iframe) {
      return;
    }

    const src =
      getEmbedUrl(
        iframe
      );

    if (
      !src ||
      src === state.originalSrc
    ) {
      return;
    }

    /*
     * Save the current iframe source.
     */
    state.originalSrc =
      src;

    /*
     * New asynchronous generation.
     */
    state.token += 1;

    const token =
      state.token;

    /*
     * Clean previous direct player.
     */
    destroyHls();

    if (
      state.customRoot
    ) {
      state.customRoot.remove();
    }

    state.customRoot =
      null;

    state.video =
      null;

    state.status =
      null;

    /*
     * Create new UI.
     */
    createUi(
      iframe
    );

    if (
      !state.customRoot
    ) {
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
          'No direct media source found'
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

      /*
       * Do NOT remove the iframe.
       *
       * The original Vidmoly player remains the
       * guaranteed fallback.
       */
      if (
        state.customRoot
      ) {
        state.customRoot.classList.add(
          'direct-unavailable'
        );
      }

      if (iframe) {
        iframe.hidden =
          false;

        iframe.style.display =
          '';
      }

      setStatus(
        'Direct mode unavailable — original player ready.'
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * WATCH FOR DYNAMICALLY CREATED IFRAME
   * ---------------------------------------------------------
   */

  function watchIframe() {
    let lastIframe =
      null;

    let lastSrc =
      '';

    const scan =
      () => {
        const iframe =
          findIframe();

        if (!iframe) {
          return;
        }

        const src =
          getEmbedUrl(
            iframe
          );

        /*
         * New iframe element.
         */
        if (
          iframe !== lastIframe
        ) {
          lastIframe =
            iframe;

          lastSrc =
            '';

          state.iframe =
            iframe;
        }

        /*
         * New iframe source.
         */
        if (
          src &&
          src !== lastSrc
        ) {
          lastSrc =
            src;

          enhance(
            iframe
          );
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

    /*
     * Backup polling because some SPA code
     * changes iframe properties in ways that are
     * not always easy to observe.
     */
    setInterval(
      scan,
      1500
    );

    scan();
  }

  /*
   * ---------------------------------------------------------
   * CSS
   * ---------------------------------------------------------
   */

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
        opacity:.85;
        padding:20px;
        text-align:center
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

      .unhappy-player-root.direct-unavailable{
        display:none
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
    `;

    document.head.appendChild(
      style
    );
  }

  /*
   * ---------------------------------------------------------
   * INITIALIZATION
   * ---------------------------------------------------------
   */

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
      {
        once: true
      }
    );
  } else {
    init();
  }

})();
