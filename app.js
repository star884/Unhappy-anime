"use strict";

/*
 * StreamVerse
 *
 * Static Vercel application.
 *
 * Architecture:
 *
 * index.html
 *      |
 *      +---- style.css
 *      |
 *      +---- app.js
 *              |
 *              +---- data/videos.json
 *
 * No backend.
 * No Node server.
 * No build process.
 */

const CONFIG = Object.freeze({
  catalogueUrl: "./data/videos.json",
  storageKeys: {
    favorites: "streamverse:favorites:v1",
    history: "streamverse:history:v1"
  },
  maxHistory: 50
});


const state = {
  videos: [],
  filteredVideos: [],
  favorites: new Set(),
  history: [],
  featuredVideo: null,
  currentVideo: null,
  currentView: "home",
  notificationTimer: null
};


const elements = {};


/* -------------------------------------------------------
 * DOM
 * ----------------------------------------------------- */

function cacheElements() {
  const ids = [
    "brandButton",
    "searchInput",
    "homeButton",
    "favoritesButton",
    "historyButton",
    "favoriteCount",

    "hero",
    "heroBackground",
    "heroBadge",
    "heroTitle",
    "heroMeta",
    "heroDescription",
    "heroWatchButton",
    "heroInfoButton",

    "libraryTitle",
    "librarySubtitle",
    "resultCount",

    "seriesFilter",
    "genreFilter",
    "qualityFilter",
    "sortFilter",
    "resetButton",

    "loadingState",
    "errorState",
    "errorMessage",
    "retryButton",
    "emptyState",
    "videoGrid",

    "playerModal",
    "playerBackdrop",
    "playerTitle",
    "closePlayerButton",
    "playerFrame",
    "playerLoading",

    "detailsModal",
    "detailsBackdrop",
    "detailsTitle",
    "closeDetailsButton",
    "detailsContent",

    "historyModal",
    "historyBackdrop",
    "historyContent",
    "closeHistoryButton",
    "clearHistoryButton",

    "notification"
  ];

  for (const id of ids) {
    elements[id] = document.getElementById(id);
  }
}


/* -------------------------------------------------------
 * Storage
 * ----------------------------------------------------- */

function loadStorage() {
  try {
    const rawFavorites = localStorage.getItem(
      CONFIG.storageKeys.favorites
    );

    const rawHistory = localStorage.getItem(
      CONFIG.storageKeys.history
    );

    if (rawFavorites) {
      const parsed = JSON.parse(rawFavorites);

      if (Array.isArray(parsed)) {
        state.favorites = new Set(
          parsed
            .filter(value => typeof value === "string")
        );
      }
    }

    if (rawHistory) {
      const parsed = JSON.parse(rawHistory);

      if (Array.isArray(parsed)) {
        state.history = parsed
          .filter(item =>
            item &&
            typeof item.id === "string" &&
            typeof item.timestamp === "number"
          )
          .slice(0, CONFIG.maxHistory);
      }
    }
  } catch (error) {
    console.warn(
      "Local storage could not be loaded:",
      error
    );

    state.favorites = new Set();
    state.history = [];
  }
}


function saveFavorites() {
  try {
    localStorage.setItem(
      CONFIG.storageKeys.favorites,
      JSON.stringify([...state.favorites])
    );
  } catch (error) {
    console.warn(
      "Favorites could not be saved:",
      error
    );
  }
}


function saveHistory() {
  try {
    localStorage.setItem(
      CONFIG.storageKeys.history,
      JSON.stringify(state.history)
    );
  } catch (error) {
    console.warn(
      "History could not be saved:",
      error
    );
  }
}


/* -------------------------------------------------------
 * Utilities
 * ----------------------------------------------------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function normalise(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}


function toArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
}


function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function getEpisodeNumber(video) {
  const possibleValues = [
    video.episode,
    video.episodeNumber,
    video.episode_number
  ];

  for (const value of possibleValues) {
    const number = numberOrNull(value);

    if (number !== null) {
      return number;
    }
  }

  return Number.POSITIVE_INFINITY;
}


function getYear(video) {
  const year = numberOrNull(video.year);

  return year === null
    ? 0
    : year;
}


function getGenres(video) {
  return toArray(video.genres ?? video.genre);
}


function getSeries(video) {
  return String(
    video.series ??
    video.show ??
    video.anime ??
    ""
  ).trim();
}


function getQuality(video) {
  return String(
    video.quality ??
    video.resolution ??
    ""
  ).trim();
}


function getTitle(video) {
  return String(
    video.title ??
    video.name ??
    "Untitled"
  ).trim();
}


function getDescription(video) {
  return String(
    video.description ??
    video.summary ??
    ""
  ).trim();
}


function getEmbed(video) {
  return String(
    video.embed ??
    video.url ??
    video.videoUrl ??
    ""
  ).trim();
}


function getImage(video) {
  return String(
    video.image ??
    video.poster ??
    video.thumbnail ??
    ""
  ).trim();
}


function isValidVideo(video) {
  if (!video || typeof video !== "object") {
    return false;
  }

  const id = String(video.id ?? "").trim();
  const title = getTitle(video);
  const embed = getEmbed(video);

  return Boolean(
    id &&
    title &&
    embed
  );
}


/* -------------------------------------------------------
 * Catalogue
 * ----------------------------------------------------- */

async function loadCatalogue() {
  setLoading(true);
  hideError();
  hideEmpty();

  try {
    const response = await fetch(
      CONFIG.catalogueUrl,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Catalogue request failed with HTTP ${response.status}.`
      );
    }

    const data = await response.json();

    const rawVideos = Array.isArray(data)
      ? data
      : Array.isArray(data.videos)
        ? data.videos
        : Array.isArray(data.items)
          ? data.items
          : [];

    state.videos = rawVideos
      .filter(isValidVideo)
      .map(video => ({
        ...video,
        id: String(video.id).trim(),
        title: getTitle(video)
      }));

    if (state.videos.length === 0) {
      throw new Error(
        "The catalogue loaded successfully, but contains no valid video entries."
      );
    }

    buildFilters();

    state.featuredVideo = chooseFeaturedVideo();

    renderHero();
    updateFavoriteCount();

    applyFilters();

    setLoading(false);

  } catch (error) {
    console.error(
      "Catalogue loading error:",
      error
    );

    setLoading(false);
    showError(
      error instanceof Error
        ? error.message
        : "Unknown catalogue error."
    );
  }
}


/* -------------------------------------------------------
 * Filters
 * ----------------------------------------------------- */

function uniqueSorted(values) {
  return [...new Set(
    values
      .map(value => String(value).trim())
      .filter(Boolean)
  )].sort(
    (a, b) =>
      a.localeCompare(
        b,
        undefined,
        {
          numeric: true,
          sensitivity: "base"
        }
      )
  );
}


function buildFilters() {
  const series = uniqueSorted(
    state.videos.map(getSeries)
  );

  const genres = uniqueSorted(
    state.videos.flatMap(getGenres)
  );

  const qualities = uniqueSorted(
    state.videos.map(getQuality)
  );

  populateSelect(
    elements.seriesFilter,
    series,
    "All Series"
  );

  populateSelect(
    elements.genreFilter,
    genres,
    "All Genres"
  );

  populateSelect(
    elements.qualityFilter,
    qualities,
    "All Qualities"
  );
}


function populateSelect(
  select,
  values,
  allLabel
) {
  if (!select) {
    return;
  }

  select.innerHTML = "";

  const allOption =
    document.createElement("option");

  allOption.value = "ALL";
  allOption.textContent = allLabel;

  select.appendChild(allOption);

  for (const value of values) {
    const option =
      document.createElement("option");

    option.value = value;
    option.textContent = value;

    select.appendChild(option);
  }
}


function applyFilters() {
  const query = normalise(
    elements.searchInput?.value
  );

  const series =
    elements.seriesFilter?.value ?? "ALL";

  const genre =
    elements.genreFilter?.value ?? "ALL";

  const quality =
    elements.qualityFilter?.value ?? "ALL";

  const sort =
    elements.sortFilter?.value ?? "catalogue";

  let videos = state.videos.filter(video => {

    const title = normalise(getTitle(video));
    const videoSeries = normalise(getSeries(video));
    const description = normalise(
      getDescription(video)
    );

    const videoGenres = getGenres(video)
      .map(normalise);

    const videoQuality = normalise(
      getQuality(video)
    );

    const matchesSearch =
      !query ||
      title.includes(query) ||
      videoSeries.includes(query) ||
      description.includes(query) ||
      videoGenres.some(
        genreName => genreName.includes(query)
      ) ||
      videoQuality.includes(query);

    const matchesSeries =
      series === "ALL" ||
      getSeries(video) === series;

    const matchesGenre =
      genre === "ALL" ||
      getGenres(video).includes(genre);

    const matchesQuality =
      quality === "ALL" ||
      getQuality(video) === quality;

    return (
      matchesSearch &&
      matchesSeries &&
      matchesGenre &&
      matchesQuality
    );
  });

  videos = sortVideos(
    videos,
    sort
  );

  state.filteredVideos = videos;

  renderGrid();
}


/* -------------------------------------------------------
 * Sorting
 * ----------------------------------------------------- */

function sortVideos(videos, sort) {
  const result = [...videos];

  switch (sort) {

    case "title":
      result.sort(
        (a, b) =>
          getTitle(a).localeCompare(
            getTitle(b),
            undefined,
            {
              numeric: true,
              sensitivity: "base"
            }
          )
      );
      break;

    case "episode-asc":
      result.sort(
        (a, b) =>
          getEpisodeNumber(a) -
          getEpisodeNumber(b)
      );
      break;

    case "episode-desc":
      result.sort(
        (a, b) =>
          getEpisodeNumber(b) -
          getEpisodeNumber(a)
      );
      break;

    case "year-desc":
      result.sort(
        (a, b) =>
          getYear(b) -
          getYear(a)
      );
      break;

    case "year-asc":
      result.sort(
        (a, b) =>
          getYear(a) -
          getYear(b)
      );
      break;

    default:
      break;
  }

  return result;
}


/* -------------------------------------------------------
 * Hero
 * ----------------------------------------------------- */

function chooseFeaturedVideo() {
  if (!state.videos.length) {
    return null;
  }

  const favourite =
    state.videos.find(video =>
      state.favorites.has(video.id)
    );

  return favourite ??
    state.videos[0];
}


function renderHero() {
  const video = state.featuredVideo;

  if (!video) {
    elements.heroTitle.textContent =
      "No content available";

    elements.heroDescription.textContent =
      "";

    return;
  }

  const title = getTitle(video);
  const series = getSeries(video);
  const quality = getQuality(video);
  const episode = getEpisodeNumber(video);

  elements.heroTitle.textContent = title;

  elements.heroBadge.textContent =
    state.favorites.has(video.id)
      ? "YOUR FAVORITE"
      : "FEATURED";

  const metaParts = [];

  if (series) {
    metaParts.push(series);
  }

  if (Number.isFinite(episode)) {
    metaParts.push(`Episode ${episode}`);
  }

  if (quality) {
    metaParts.push(quality);
  }

  if (getYear(video)) {
    metaParts.push(String(getYear(video)));
  }

  elements.heroMeta.textContent =
    metaParts.join(" • ");

  elements.heroDescription.textContent =
    getDescription(video) ||
    "Watch this title from the catalogue.";

  const image = getImage(video);

  if (image) {
    elements.heroBackground.style.backgroundImage =
      `url("${image.replaceAll('"', "%22")}")`;
  } else {
    elements.heroBackground.style.backgroundImage =
      "";
  }
}


/* -------------------------------------------------------
 * Cards
 * ----------------------------------------------------- */

function renderGrid() {
  const videos = state.filteredVideos;

  elements.resultCount.textContent =
    `${videos.length} ${
      videos.length === 1
        ? "item"
        : "items"
    }`;

  elements.videoGrid.innerHTML = "";

  if (!videos.length) {
    elements.videoGrid.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.videoGrid.classList.remove("hidden");

  const fragment =
    document.createDocumentFragment();

  for (const video of videos) {
    fragment.appendChild(
      createCard(video)
    );
  }

  elements.videoGrid.appendChild(
    fragment
  );
}


function createCard(video) {
  const card =
    document.createElement("article");

  card.className = "video-card";

  const image = getImage(video);
  const quality = getQuality(video);
  const series = getSeries(video);
  const episode = getEpisodeNumber(video);

  const imageHtml = image
    ? `
      <img
        src="${escapeHtml(image)}"
        alt=""
        loading="lazy"
        onerror="this.remove();"
      >
    `
    : `
      <div class="card-placeholder">
        ▶
      </div>
    `;

  const episodeText =
    Number.isFinite(episode)
      ? `Episode ${episode}`
      : "";

  const meta =
    [
      series,
      episodeText,
      quality
    ]
      .filter(Boolean)
      .join(" • ");

  const favorite =
    state.favorites.has(video.id);

  card.innerHTML = `
    <div class="card-image">

      ${imageHtml}

      ${
        quality
          ? `
            <span class="card-badge">
              ${escapeHtml(quality)}
            </span>
          `
          : ""
      }

      <button
        class="card-favorite ${
          favorite ? "active" : ""
        }"
        type="button"
        data-action="favorite"
        aria-label="${
          favorite
            ? "Remove from favorites"
            : "Add to favorites"
        }"
        title="${
          favorite
            ? "Remove from favorites"
            : "Add to favorites"
        }"
      >
        ${favorite ? "♥" : "♡"}
      </button>

    </div>

    <div class="card-body">

      <h3 class="card-title">
        ${escapeHtml(getTitle(video))}
      </h3>

      ${
        meta
          ? `
            <p class="card-meta">
              ${escapeHtml(meta)}
            </p>
          `
          : ""
      }

      ${
        getDescription(video)
          ? `
            <p class="card-description">
              ${escapeHtml(
                getDescription(video)
              )}
            </p>
          `
          : ""
      }

      <div class="card-actions">

        <button
          class="card-action watch"
          type="button"
          data-action="watch"
        >
          Watch
        </button>

        <button
          class="card-action"
          type="button"
          data-action="details"
        >
          Info
        </button>

      </div>

    </div>
  `;

  card.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          "[data-action]"
        );

      if (!button) {
        return;
      }

      const action =
        button.dataset.action;

      if (action === "watch") {
        openPlayer(video);
      }

      if (action === "details") {
        openDetails(video);
      }

      if (action === "favorite") {
        toggleFavorite(video);
      }
    }
  );

  return card;
}


/* -------------------------------------------------------
 * Favorites
 * ----------------------------------------------------- */

function toggleFavorite(video) {
  if (state.favorites.has(video.id)) {
    state.favorites.delete(video.id);

    notify(
      "Removed from favorites."
    );
  } else {
    state.favorites.add(video.id);

    notify(
      "Added to favorites."
    );
  }

  saveFavorites();

  updateFavoriteCount();

  if (state.featuredVideo?.id === video.id) {
    renderHero();
  }

  if (state.currentView === "favorites") {
    applyFilters();
  } else {
    renderGrid();
  }
}


function updateFavoriteCount() {
  elements.favoriteCount.textContent =
    String(state.favorites.size);
}


/* -------------------------------------------------------
 * Player
 * ----------------------------------------------------- */

function openPlayer(video) {
  const embed = getEmbed(video);

  if (!embed) {
    notify(
      "This item has no playable source."
    );

    return;
  }

  state.currentVideo = video;

  elements.playerTitle.textContent =
    getTitle(video);

  elements.playerLoading.classList.remove(
    "hidden"
  );

  elements.playerFrame.src = "";

  elements.playerModal.classList.remove(
    "hidden"
  );

  document.body.style.overflow = "hidden";

  recordHistory(video);

  requestAnimationFrame(() => {
    elements.playerFrame.src = embed;
  });
}


function closePlayer() {
  elements.playerFrame.src = "";

  elements.playerModal.classList.add(
    "hidden"
  );

  document.body.style.overflow = "";

  state.currentVideo = null;
}


/* -------------------------------------------------------
 * History
 * ----------------------------------------------------- */

function recordHistory(video) {
  const now = Date.now();

  state.history =
    state.history.filter(
      item => item.id !== video.id
    );

  state.history.unshift({
    id: video.id,
    timestamp: now
  });

  state.history =
    state.history.slice(
      0,
      CONFIG.maxHistory
    );

  saveHistory();
}


function openHistory() {
  state.currentView = "history";

  updateNavigation();

  renderHistory();

  elements.historyModal.classList.remove(
    "hidden"
  );

  document.body.style.overflow = "hidden";
}


function closeHistory() {
  elements.historyModal.classList.add(
    "hidden"
  );

  document.body.style.overflow = "";
}


function renderHistory() {
  if (!state.history.length) {
    elements.historyContent.innerHTML = `
      <div class="history-empty">
        You have not watched anything yet.
      </div>
    `;

    return;
  }

  const videosById =
    new Map(
      state.videos.map(
        video => [video.id, video]
      )
    );

  const available =
    state.history
      .map(item => ({
        item,
        video: videosById.get(item.id)
      }))
      .filter(entry => entry.video);

  if (!available.length) {
    elements.historyContent.innerHTML = `
      <div class="history-empty">
        Your saved history does not match
        the current catalogue.
      </div>
    `;

    return;
  }

  elements.historyContent.innerHTML =
    available.map(
      ({
        item,
        video
      }) => `
        <div class="history-item">

          <div class="history-info">

            <p class="history-title">
              ${escapeHtml(
                getTitle(video)
              )}
            </p>

            <div class="history-date">
              ${escapeHtml(
                formatDate(item.timestamp)
              )}
            </div>

          </div>

          <button
            class="history-watch"
            type="button"
            data-history-id="${
              escapeHtml(video.id)
            }"
          >
            Watch
          </button>

        </div>
      `
    ).join("");

  elements.historyContent
    .querySelectorAll(
      "[data-history-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const video =
            videosById.get(
              button.dataset.historyId
            );

          if (video) {
            closeHistory();
            openPlayer(video);
          }
        }
      );

    });
}


function clearHistory() {
  state.history = [];

  saveHistory();

  renderHistory();

  notify(
    "Watch history cleared."
  );
}


function formatDate(timestamp) {
  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle: "medium",
        timeStyle: "short"
      }
    ).format(
      new Date(timestamp)
    );
  } catch {
    return "Previously watched";
  }
}


/* -------------------------------------------------------
 * Details
 * ----------------------------------------------------- */

function openDetails(video) {
  elements.detailsTitle.textContent =
    getTitle(video);

  const genres = getGenres(video);

  const fields = [
    ["Series", getSeries(video)],
    [
      "Episode",
      Number.isFinite(
        getEpisodeNumber(video)
      )
        ? getEpisodeNumber(video)
        : ""
    ],
    ["Quality", getQuality(video)],
    ["Year", getYear(video) || ""],
    [
      "Genres",
      genres.join(", ")
    ]
  ].filter(
    ([, value]) =>
      String(value).trim() !== ""
  );

  elements.detailsContent.innerHTML = `
    <div class="details-grid">

      ${fields.map(
        ([label, value]) => `
          <div class="detail-item">

            <span class="detail-label">
              ${escapeHtml(label)}
            </span>

            <span class="detail-value">
              ${escapeHtml(value)}
            </span>

          </div>
        `
      ).join("")}

    </div>

    ${
      getDescription(video)
        ? `
          <p class="details-description">
            ${escapeHtml(
              getDescription(video)
            )}
          </p>
        `
        : ""
    }

    <div class="hero-actions">

      <button
        id="detailsWatchButton"
        class="button primary-button"
        type="button"
      >
        Watch
      </button>

      <button
        id="detailsFavoriteButton"
        class="button secondary-button"
        type="button"
      >
        ${
          state.favorites.has(video.id)
            ? "Remove Favorite"
            : "Add Favorite"
        }
      </button>

    </div>
  `;

  elements.detailsModal.classList.remove(
    "hidden"
  );

  document.body.style.overflow = "hidden";

  document
    .getElementById("detailsWatchButton")
    ?.addEventListener(
      "click",
      () => {
        closeDetails();
        openPlayer(video);
      }
    );

  document
    .getElementById("detailsFavoriteButton")
    ?.addEventListener(
      "click",
      () => {
        toggleFavorite(video);
        openDetails(video);
      }
    );
}


function closeDetails() {
  elements.detailsModal.classList.add(
    "hidden"
  );

  document.body.style.overflow = "";
}


/* -------------------------------------------------------
 * Navigation
 * ----------------------------------------------------- */

function showHome() {
  state.currentView = "home";

  updateNavigation();

  elements.libraryTitle.textContent =
    "Library";

  elements.librarySubtitle.textContent =
    "Browse the catalogue";

  applyFilters();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


function showFavorites() {
  state.currentView = "favorites";

  updateNavigation();

  elements.libraryTitle.textContent =
    "Favorites";

  elements.librarySubtitle.textContent =
    "Your saved titles";

  const videos =
    state.videos.filter(
      video =>
        state.favorites.has(video.id)
    );

  state.filteredVideos = videos;

  renderGrid();

  window.scrollTo({
    top: document.querySelector(".library")
      ?.offsetTop ?? 0,
    behavior: "smooth"
  });
}


function updateNavigation() {
  elements.homeButton.classList.toggle(
    "active",
    state.currentView === "home"
  );

  elements.favoritesButton.classList.toggle(
    "active",
    state.currentView === "favorites"
  );
}


/* -------------------------------------------------------
 * Loading / Errors
 * ----------------------------------------------------- */

function setLoading(loading) {
  elements.loadingState.classList.toggle(
    "hidden",
    !loading
  );

  if (loading) {
    elements.videoGrid.classList.add(
      "hidden"
    );

    elements.emptyState.classList.add(
      "hidden"
    );
  }
}


function showError(message) {
  elements.errorMessage.textContent =
    message;

  elements.errorState.classList.remove(
    "hidden"
  );

  elements.videoGrid.classList.add(
    "hidden"
  );

  elements.emptyState.classList.add(
    "hidden"
  );
}


function hideError() {
  elements.errorState.classList.add(
    "hidden"
  );
}


function hideEmpty() {
  elements.emptyState.classList.add(
    "hidden"
  );
}


/* -------------------------------------------------------
 * Notifications
 * ----------------------------------------------------- */

function notify(message) {
  clearTimeout(
    state.notificationTimer
  );

  elements.notification.textContent =
    message;

  elements.notification.classList.add(
    "visible"
  );

  state.notificationTimer =
    setTimeout(
      () => {
        elements.notification.classList.remove(
          "visible"
        );
      },
      2500
    );
}


/* -------------------------------------------------------
 * Reset
 * ----------------------------------------------------- */

function resetFilters() {
  elements.searchInput.value = "";
  elements.seriesFilter.value = "ALL";
  elements.genreFilter.value = "ALL";
  elements.qualityFilter.value = "ALL";
  elements.sortFilter.value = "catalogue";

  state.currentView = "home";

  updateNavigation();

  elements.libraryTitle.textContent =
    "Library";

  elements.librarySubtitle.textContent =
    "Browse the catalogue";

  applyFilters();
}


/* -------------------------------------------------------
 * Events
 * ----------------------------------------------------- */

function setupEvents() {

  elements.brandButton.addEventListener(
    "click",
    showHome
  );

  elements.homeButton.addEventListener(
    "click",
    () => {
      showHome();
    }
  );

  elements.favoritesButton.addEventListener(
    "click",
    () => {
      showFavorites();
    }
  );

  elements.historyButton.addEventListener(
    "click",
    openHistory
  );

  elements.searchInput.addEventListener(
    "input",
    () => {
      if (
        state.currentView !== "home"
      ) {
        state.currentView = "home";
        updateNavigation();
      }

      applyFilters();
    }
  );

  [
    elements.seriesFilter,
    elements.genreFilter,
    elements.qualityFilter,
    elements.sortFilter
  ].forEach(select => {
    select.addEventListener(
      "change",
      () => {
        if (
          state.currentView !== "home"
        ) {
          state.currentView = "home";
          updateNavigation();
        }

        applyFilters();
      }
    );
  });

  elements.resetButton.addEventListener(
    "click",
    resetFilters
  );

  elements.retryButton.addEventListener(
    "click",
    loadCatalogue
  );

  elements.heroWatchButton.addEventListener(
    "click",
    () => {
      if (state.featuredVideo) {
        openPlayer(
          state.featuredVideo
        );
      }
    }
  );

  elements.heroInfoButton.addEventListener(
    "click",
    () => {
      if (state.featuredVideo) {
        openDetails(
          state.featuredVideo
        );
      }
    }
  );

  elements.closePlayerButton.addEventListener(
    "click",
    closePlayer
  );

  elements.playerBackdrop.addEventListener(
    "click",
    closePlayer
  );

  elements.closeDetailsButton.addEventListener(
    "click",
    closeDetails
  );

  elements.detailsBackdrop.addEventListener(
    "click",
    closeDetails
  );

  elements.closeHistoryButton.addEventListener(
    "click",
    closeHistory
  );

  elements.historyBackdrop.addEventListener(
    "click",
    closeHistory
  );

  elements.clearHistoryButton.addEventListener(
    "click",
    clearHistory
  );

  elements.playerFrame.addEventListener(
    "load",
    () => {
      elements.playerLoading.classList.add(
        "hidden"
      );
    }
  );

  document.addEventListener(
    "keydown",
    event => {

      if (event.key !== "Escape") {
        return;
      }

      if (
        !elements.playerModal.classList.contains(
          "hidden"
        )
      ) {
        closePlayer();
        return;
      }

      if (
        !elements.detailsModal.classList.contains(
          "hidden"
        )
      ) {
        closeDetails();
        return;
      }

      if (
        !elements.historyModal.classList.contains(
          "hidden"
        )
      ) {
        closeHistory();
      }
    }
  );
}


/* -------------------------------------------------------
 * Startup
 * ----------------------------------------------------- */

async function init() {
  cacheElements();

  loadStorage();

  setupEvents();

  updateFavoriteCount();

  await loadCatalogue();
}


if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );
} else {
  init();
          }
