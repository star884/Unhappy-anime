"use strict";

const CONFIG = Object.freeze({
  catalogueUrl: "./data/videos.json",

  storageKeys: {
    favorites: "unhappy:favorites:v2",
    history: "unhappy:history:v2"
  },

  maxHistory: 50,
  maxContinue: 6
});

const state = {
  videos: [],
  filteredVideos: [],
  favorites: new Set(),
  history: [],
  featuredVideo: null,
  currentVideo: null,
  currentView: "home",
  lastModal: null,
  toastTimer: null
};

const elements = {};

function cacheElements() {
  const ids = [
    "brandButton",
    "homeButton",
    "browseButton",
    "favoritesButton",
    "favoriteCount",
    "historyButton",

    "mobileSearchButton",
    "mobileMenuButton",
    "mobileNav",
    "mobileFavoriteCount",

    "searchInput",
    "mobileSearchInput",

    "hero",
    "heroBackground",
    "heroBadge",
    "heroTitle",
    "heroMeta",
    "heroDescription",
    "heroPoster",
    "heroWatchButton",
    "heroFavoriteButton",
    "heroFavoriteLabel",
    "heroInfoButton",

    "continueSection",
    "continueRow",
    "openHistoryFromSection",

    "discoverySection",
    "discoveryTitle",
    "discoverySubtitle",
    "resultCount",
    "browseToolbar",

    "seriesFilter",
    "genreFilter",
    "qualityFilter",
    "sortFilter",
    "resetButton",
    "activeFilters",

    "loadingState",
    "errorState",
    "errorMessage",
    "retryButton",
    "emptyState",
    "emptyResetButton",
    "videoGrid",

    "seriesSection",
    "seriesGrid",

    "playerModal",
    "playerBackdrop",
    "playerBackButton",
    "playerTitle",
    "playerPrevButton",
    "playerNextButton",
    "playerLoading",
    "playerFrame",
    "playerSeries",
    "playerTitleBelow",
    "playerFavoriteButton",
    "playerInfoButton",

    "detailsModal",
    "detailsBackdrop",
    "detailsContent",
    "closeDetailsButton",

    "historyModal",
    "historyBackdrop",
    "historyContent",
    "closeHistoryButton",
    "clearHistoryButton",

    "toast",
    "notification"
  ];

  for (const id of ids) {
    elements[id] = document.getElementById(id);
  }
}

function loadStorage() {
  try {
    const readJson = (primaryKey, legacyKey, fallback) => {
      const primaryRaw = localStorage.getItem(primaryKey);

      if (primaryRaw !== null) {
        return JSON.parse(primaryRaw);
      }

      const legacyRaw = localStorage.getItem(legacyKey);

      return legacyRaw !== null
        ? JSON.parse(legacyRaw)
        : fallback;
    };

    const favorites = readJson(
      CONFIG.storageKeys.favorites,
      "streamverse:favorites:v1",
      []
    );

    if (Array.isArray(favorites)) {
      state.favorites = new Set(
        favorites.filter(value => typeof value === "string")
      );
    }

    const history = readJson(
      CONFIG.storageKeys.history,
      "streamverse:history:v1",
      []
    );

    if (Array.isArray(history)) {
      state.history = history
        .filter(
          item =>
            item &&
            typeof item.id === "string" &&
            Number.isFinite(Number(item.timestamp))
        )
        .map(item => ({
          id: item.id,
          timestamp: Number(item.timestamp)
        }))
        .slice(0, CONFIG.maxHistory);
    }
  } catch (error) {
    console.warn("Storage could not be loaded:", error);

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
    console.warn("Favorites could not be saved:", error);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(
      CONFIG.storageKeys.history,
      JSON.stringify(state.history)
    );
  } catch (error) {
    console.warn("History could not be saved:", error);
  }
}

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
  for (
    const value of [
      video.episode,
      video.episodeNumber,
      video.episode_number
    ]
  ) {
    const number = numberOrNull(value);

    if (number !== null) {
      return number;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function getYear(video) {
  return numberOrNull(video.year) ?? 0;
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
  ).trim() || "Untitled";
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

  return Boolean(
    String(video.id ?? "").trim() &&
    getTitle(video) &&
    getEmbed(video)
  );
}

function videoById(id) {
  return (
    state.videos.find(video => video.id === id) ||
    null
  );
}

function uniqueSorted(values) {
  return [
    ...new Set(
      values
        .map(value => String(value).trim())
        .filter(Boolean)
    )
  ].sort(
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

function formatEpisode(video) {
  const episode = getEpisodeNumber(video);

  if (!Number.isFinite(episode)) {
    return "";
  }

  return Number.isInteger(episode)
    ? String(episode).padStart(3, "0")
    : String(episode);
}

function formatEpisodeLabel(video) {
  const episode = getEpisodeNumber(video);

  if (!Number.isFinite(episode)) {
    return "";
  }

  return `Episode ${
    Number.isInteger(episode)
      ? String(episode).padStart(3, "0")
      : episode
  }`;
}

function getDisplayMeta(video) {
  const parts = [];

  const year = getYear(video);

  if (year) {
    parts.push(String(year));
  }

  const episode = formatEpisodeLabel(video);

  if (episode) {
    parts.push(episode);
  }

  const quality = getQuality(video);

  if (
    quality &&
    normalise(quality) !== "unknown"
  ) {
    parts.push(quality);
  }

  return parts;
}

function safeUrl(url) {
  const value = String(url || "").trim();

  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(
      value,
      window.location.href
    );

    if (
      [
        "http:",
        "https:",
        "data:",
        "blob:",
        "file:"
      ].includes(parsed.protocol)
    ) {
      return parsed.href;
    }
  } catch (_) {}

  return "";
}

async function loadCatalogue() {
  setLoading(true);
  hideError();

  try {
    const response = await fetch(
      CONFIG.catalogueUrl,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Catalogue request failed with HTTP ${response.status}.`
      );
    }

    const data = await response.json();

    const rawVideos =
      Array.isArray(data)
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

    if (!state.videos.length) {
      throw new Error(
        "The catalogue loaded, but no valid video entries were found."
      );
    }

    pruneStorageToCatalogue();
    buildFilters();

    state.featuredVideo =
      chooseFeaturedVideo();

    renderHero();
    updateFavoriteCount();
    renderContinueWatching();
    renderSeriesGrid();
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

function pruneStorageToCatalogue() {
  const validIds = new Set(
    state.videos.map(video => video.id)
  );

  state.favorites = new Set(
    [...state.favorites].filter(id =>
      validIds.has(id)
    )
  );

  state.history = state.history.filter(
    item => validIds.has(item.id)
  );

  saveFavorites();
  saveHistory();
}

function buildFilters() {
  populateSelect(
    elements.seriesFilter,
    uniqueSorted(
      state.videos.map(getSeries)
    ),
    "All series"
  );

  populateSelect(
    elements.genreFilter,
    uniqueSorted(
      state.videos.flatMap(getGenres)
    ),
    "All genres"
  );

  populateSelect(
    elements.qualityFilter,
    uniqueSorted(
      state.videos.map(getQuality)
    ),
    "All qualities"
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

  const current = select.value;

  select.innerHTML = "";

  const all = document.createElement("option");

  all.value = "ALL";
  all.textContent = allLabel;

  select.appendChild(all);

  values.forEach(value => {
    const option =
      document.createElement("option");

    option.value = value;
    option.textContent = value;

    select.appendChild(option);
  });

  if (
    ["ALL", ...values].includes(current)
  ) {
    select.value = current;
  }
}

function getFilterState() {
  return {
    query: normalise(
      elements.searchInput?.value ||
      elements.mobileSearchInput?.value
    ),

    series:
      elements.seriesFilter?.value ??
      "ALL",

    genre:
      elements.genreFilter?.value ??
      "ALL",

    quality:
      elements.qualityFilter?.value ??
      "ALL",

    sort:
      elements.sortFilter?.value ??
      "catalogue"
  };
}

function applyFilters() {
  const filters = getFilterState();

  let videos = state.videos.filter(
    video => {
      const haystack = [
        getTitle(video),
        getSeries(video),
        getDescription(video),
        ...getGenres(video),
        getQuality(video),
        String(getEpisodeNumber(video))
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!filters.query ||
          haystack.includes(filters.query)) &&

        (
          filters.series === "ALL" ||
          getSeries(video) === filters.series
        ) &&

        (
          filters.genre === "ALL" ||
          getGenres(video).includes(
            filters.genre
          )
        ) &&

        (
          filters.quality === "ALL" ||
          getQuality(video) === filters.quality
        )
      );
    }
  );

  videos = sortVideos(
    videos,
    filters.sort
  );

  state.filteredVideos = videos;

  updateLibraryCopy(filters);
  renderGrid();
  renderActiveFilters(filters);
}

function sortVideos(
  videos,
  sort
) {
  const result = [...videos];

  if (sort === "title") {
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
  } else if (
    sort === "episode-asc"
  ) {
    result.sort(
      (a, b) =>
        getEpisodeNumber(a) -
        getEpisodeNumber(b)
    );
  } else if (
    sort === "episode-desc"
  ) {
    result.sort(
      (a, b) =>
        getEpisodeNumber(b) -
        getEpisodeNumber(a)
    );
  } else if (
    sort === "year-desc"
  ) {
    result.sort(
      (a, b) =>
        getYear(b) -
        getYear(a)
    );
  } else if (
    sort === "year-asc"
  ) {
    result.sort(
      (a, b) =>
        getYear(a) -
        getYear(b)
    );
  }

  return result;
}

function updateLibraryCopy(filters) {
  const filtered =
    state.filteredVideos.length;

  const isSearch =
    Boolean(filters.query);

  const isFiltered =
    isSearch ||
    filters.series !== "ALL" ||
    filters.genre !== "ALL" ||
    filters.quality !== "ALL";

  elements.discoveryTitle.textContent =
    state.currentView === "favorites"
      ? "Your saved titles"
      : isFiltered
        ? "Search results"
        : "Fresh from the library";

  elements.discoverySubtitle.textContent =
    state.currentView === "favorites"
      ? (
        filtered
          ? "Everything you've saved for later."
          : "Save titles with the heart button to build your list."
      )
      : isFiltered
        ? `Showing ${filtered} matching ${
            filtered === 1
              ? "title"
              : "titles"
          }.`
        : "Browse the latest titles and episodes in your collection.";
}

function renderActiveFilters(filters) {
  if (!elements.activeFilters) {
    return;
  }

  const tags = [];

  if (filters.query) {
    tags.push({
      label: `Search: ${filters.query}`,
      action: "search"
    });
  }

  if (filters.series !== "ALL") {
    tags.push({
      label: `Series: ${filters.series}`,
      action: "series"
    });
  }

  if (filters.genre !== "ALL") {
    tags.push({
      label: `Genre: ${filters.genre}`,
      action: "genre"
    });
  }

  if (filters.quality !== "ALL") {
    tags.push({
      label: `Quality: ${filters.quality}`,
      action: "quality"
    });
  }

  elements.activeFilters.innerHTML =
    tags
      .map(
        tag =>
          `<span class="filter-tag">
            ${escapeHtml(tag.label)}
            <button
              type="button"
              data-clear-filter="${escapeHtml(tag.action)}"
              aria-label="Remove ${escapeHtml(tag.label)}"
            >×</button>
          </span>`
      )
      .join("");

  elements.activeFilters.classList.toggle(
    "hidden",
    tags.length === 0
  );
}

function chooseFeaturedVideo() {
  const favourite =
    state.videos.find(video =>
      state.favorites.has(video.id)
    );

  if (favourite) {
    return favourite;
  }

  const historyVideo =
    state.history
      .map(item => videoById(item.id))
      .find(Boolean);

  return (
    historyVideo ||
    state.videos[0] ||
    null
  );
}

function heroMetaHtml(video) {
  return getDisplayMeta(video)
    .map(
      item =>
        `<span class="meta-chip">${escapeHtml(item)}</span>`
    )
    .join("");
}

function setBackground(
  element,
  image
) {
  const url = safeUrl(image);

  if (!url) {
    element.style.backgroundImage = "";
    return;
  }

  element.style.backgroundImage =
    `url("${url.replaceAll('"', "%22")}")`;
}

function renderHero() {
  const video =
    state.featuredVideo;

  if (!video) {
    return;
  }

  const image =
    getImage(video);

  setBackground(
    elements.heroBackground,
    image
  );

  elements.heroPoster.src =
    safeUrl(image);

  elements.heroPoster.alt =
    getTitle(video);

  elements.heroTitle.textContent =
    getTitle(video).replace(
      /\s+[-–—]\s+Episode\s+\d+$/i,
      ""
    );

  elements.heroBadge.textContent =
    state.favorites.has(video.id)
      ? "IN YOUR LIST"
      : "FEATURED";

  elements.heroMeta.innerHTML =
    heroMetaHtml(video);

  elements.heroDescription.textContent =
    getDescription(video) ||
    `Watch ${getTitle(video)} from the library.`;

  updateHeroFavoriteButton();
}

function updateHeroFavoriteButton() {
  const video =
    state.featuredVideo;

  if (!video) {
    return;
  }

  const active =
    state.favorites.has(video.id);

  elements.heroFavoriteButton?.setAttribute(
    "aria-pressed",
    String(active)
  );

  elements.heroFavoriteLabel.textContent =
    active
      ? "Saved"
      : "My list";

  const icon =
    elements.heroFavoriteButton?.querySelector(
      ".button-icon"
    );

  if (icon) {
    icon.textContent =
      active
        ? "♥"
        : "♡";
  }
}

function renderContinueWatching() {
  const entries =
    state.history
      .map(item => ({
        ...item,
        video: videoById(item.id)
      }))
      .filter(entry => entry.video)
      .slice(
        0,
        CONFIG.maxContinue
      );

  elements.continueSection.classList.toggle(
    "hidden",
    entries.length === 0
  );

  elements.continueRow.innerHTML =
    entries
      .map(entry =>
        createCardHtml(
          entry.video,
          { continueItem: true }
        )
      )
      .join("");
}

function createCardHtml(
  video,
  options = {}
) {
  const image =
    safeUrl(getImage(video));

  const active =
    state.favorites.has(video.id);

  const series =
    getSeries(video);

  const episode =
    formatEpisodeLabel(video);

  const quality =
    getQuality(video);

  const year =
    getYear(video);

  const badges = [];

  if (
    quality &&
    normalise(quality) !== "unknown"
  ) {
    badges.push(quality);
  }

  if (episode) {
    badges.push(
      `EP ${formatEpisode(video)}`
    );
  }

  const meta = [];

  if (year) {
    meta.push(String(year));
  }

  if (episode) {
    meta.push(episode);
  }

  if (
    quality &&
    normalise(quality) !== "unknown"
  ) {
    meta.push(quality);
  }

  const placeholder =
    `<div class="card-placeholder" aria-hidden="true"></div>`;

  return `
    <article
      class="video-card"
      data-video-id="${escapeHtml(video.id)}"
    >
      <div class="card-media">
        ${
          image
            ? `
              <img
                src="${escapeHtml(image)}"
                alt="${escapeHtml(getTitle(video))}"
                loading="lazy"
                decoding="async"
              >
            `
            : placeholder
        }

        <div class="card-top">
          <div class="badge-row">
            ${
              badges
                .map(
                  badge =>
                    `<span class="card-badge">${escapeHtml(badge)}</span>`
                )
                .join("")
            }
          </div>

          <button
            class="favorite-button ${active ? "active" : ""}"
            type="button"
            data-action="favorite"
            aria-pressed="${active}"
            aria-label="${
              active
                ? "Remove from favorites"
                : "Add to favorites"
            }"
          >
            ${active ? "♥" : "♡"}
          </button>
        </div>

        <div class="card-hover">
          <button
            class="card-play"
            type="button"
            data-action="watch"
            aria-label="Watch ${escapeHtml(getTitle(video))}"
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
              <path d="M8 5.4v13.2c0 .8.9 1.3 1.6.9l10-6.6a1.1 1.1 0 0 0 0-1.8l-10-6.6C8.9 4.1 8 4.6 8 5.4Z"></path>
            </svg>
          </button>
        </div>

        ${
          options.continueItem
            ? `
              <div class="card-progress">
                <span></span>
              </div>
            `
            : ""
        }
      </div>

      <div class="card-body">
        <div class="card-series">
          ${escapeHtml(series || "Library")}
        </div>

        <h3
          class="card-title"
          title="${escapeHtml(getTitle(video))}"
        >
          ${escapeHtml(getTitle(video))}
        </h3>

        <div class="card-meta">
          ${
            meta
              .map(
                item =>
                  `<span>${escapeHtml(item)}</span>`
              )
              .join("")
          }
        </div>

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
            data-action="info"
          >
            Details
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderGrid() {
  const videos =
    state.filteredVideos;

  elements.resultCount.textContent =
    `${videos.length} ${
      videos.length === 1
        ? "item"
        : "items"
    }`;

  elements.videoGrid.innerHTML =
    videos
      .map(video =>
        createCardHtml(video)
      )
      .join("");

  const empty =
    videos.length === 0;

  elements.videoGrid.classList.toggle(
    "hidden",
    empty
  );

  elements.emptyState.classList.toggle(
    "hidden",
    !empty
  );
}

function renderSeriesGrid() {
  const groups = new Map();

  for (const video of state.videos) {
    const series =
      getSeries(video) ||
      "Other";

    if (!groups.has(series)) {
      groups.set(series, 0);
    }

    groups.set(
      series,
      groups.get(series) + 1
    );
  }

  const entries =
    [...groups.entries()].sort(
      (a, b) =>
        a[0].localeCompare(
          b[0],
          undefined,
          { sensitivity: "base" }
        )
    );

  elements.seriesSection.classList.toggle(
    "hidden",
    entries.length < 2
  );

  elements.seriesGrid.innerHTML =
    entries
      .map(
        ([series, count]) =>
          `
            <button
              class="series-card"
              type="button"
              data-series="${escapeHtml(series)}"
            >
              <strong>${escapeHtml(series)}</strong>
              <span>
                ${count} ${
                  count === 1
                    ? "title"
                    : "titles"
                }
              </span>
            </button>
          `
      )
      .join("");
}

function setLoading(isLoading) {
  elements.loadingState.classList.toggle(
    "hidden",
    !isLoading
  );

  if (isLoading) {
    elements.videoGrid.classList.add(
      "hidden"
    );

    elements.emptyState.classList.add(
      "hidden"
    );
  }
}

function hideError() {
  elements.errorState.classList.add(
    "hidden"
  );
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
}

function toggleFavorite(id) {
  const video =
    videoById(id);

  if (!video) {
    return;
  }

  if (state.favorites.has(id)) {
    state.favorites.delete(id);

    announce(
      `${getTitle(video)} removed from favorites.`
    );

    showToast(
      "Removed from your list"
    );
  } else {
    state.favorites.add(id);

    announce(
      `${getTitle(video)} added to favorites.`
    );

    showToast(
      "Saved to your list"
    );
  }

  saveFavorites();

  updateFavoriteCount();

  state.featuredVideo =
    chooseFeaturedVideo();

  renderHero();
  renderContinueWatching();

  if (
    state.currentView === "favorites"
  ) {
    applyFilters();
  } else {
    renderGrid();
  }

  if (
    !elements.detailsModal.classList.contains(
      "hidden"
    )
  ) {
    renderDetails(
      state.currentVideo
    );
  }

  if (
    !elements.playerModal.classList.contains(
      "hidden"
    )
  ) {
    updatePlayerFavoriteButton();
  }
}

function updateFavoriteCount() {
  const count =
    state.favorites.size;

  elements.favoriteCount.textContent =
    String(count);

  elements.mobileFavoriteCount.textContent =
    String(count);
}

function setHistory(id) {
  state.history = [
    {
      id,
      timestamp: Date.now()
    },
    ...state.history.filter(
      item => item.id !== id
    )
  ].slice(
    0,
    CONFIG.maxHistory
  );

  saveHistory();
  renderContinueWatching();
}

function getSeriesSiblings(video) {
  if (!video) {
    return [];
  }

  const series =
    getSeries(video);

  const sameSeries =
    state.videos.filter(
      item =>
        getSeries(item) === series &&
        Number.isFinite(
          getEpisodeNumber(item)
        )
    );

  return sortVideos(
    sameSeries,
    "episode-asc"
  );
}

function openPlayer(video) {
  if (!video) {
    return;
  }

  state.currentVideo =
    video;

  setHistory(
    video.id
  );

  elements.playerTitle.textContent =
    getTitle(video);

  elements.playerTitleBelow.textContent =
    getTitle(video);

  elements.playerSeries.textContent =
    getSeries(video);

  elements.playerFrame.src =
    "about:blank";

  elements.playerLoading.classList.remove(
    "hidden"
  );

  elements.playerModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );

  updatePlayerNav();
  updatePlayerFavoriteButton();

  window.setTimeout(
    () => {
      if (
        !state.currentVideo ||
        state.currentVideo.id !==
          video.id
      ) {
        return;
      }

      elements.playerFrame.src =
        safeUrl(getEmbed(video));

      elements.playerLoading.classList.remove(
        "hidden"
      );
    },
    30
  );

  window.setTimeout(
    () => {
      elements.playerLoading.classList.add(
        "hidden"
      );
    },
    1800
  );
}

function closeModal(modal) {
  modal.classList.add(
    "hidden"
  );

  if (
    [
      elements.playerModal,
      elements.detailsModal,
      elements.historyModal
    ].every(
      item =>
        item.classList.contains(
          "hidden"
        )
    )
  ) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

function closePlayer() {
  elements.playerFrame.src =
    "about:blank";

  closeModal(
    elements.playerModal
  );
}

function updatePlayerNav() {
  const siblings =
    getSeriesSiblings(
      state.currentVideo
    );

  const index =
    siblings.findIndex(
      video =>
        video.id ===
        state.currentVideo?.id
    );

  elements.playerPrevButton.disabled =
    index <= 0;

  elements.playerNextButton.disabled =
    index < 0 ||
    index >=
      siblings.length - 1;
}

function openRelativeEpisode(
  direction
) {
  const siblings =
    getSeriesSiblings(
      state.currentVideo
    );

  const index =
    siblings.findIndex(
      video =>
        video.id ===
        state.currentVideo?.id
    );

  const next =
    siblings[index + direction];

  if (next) {
    openPlayer(next);
  }
}

function updatePlayerFavoriteButton() {
  const video =
    state.currentVideo;

  if (!video) {
    return;
  }

  const active =
    state.favorites.has(
      video.id
    );

  elements.playerFavoriteButton.textContent =
    active
      ? "♥ Saved"
      : "♡ My list";
}

function renderDetails(video) {
  if (!video) {
    return;
  }

  state.currentVideo =
    video;

  const image =
    safeUrl(getImage(video));

  const meta =
    getDisplayMeta(video)
      .map(
        item =>
          `<span>${escapeHtml(item)}</span>`
      )
      .join("");

  const series =
    getSeries(video);

  const siblings =
    getSeriesSiblings(video)
      .filter(
        item => item.id !== video.id
      )
      .slice(0, 4);

  elements.detailsContent.innerHTML = `
    <div class="details-hero">
      <div
        class="details-backdrop-image"
        ${
          image
            ? `style="background-image:url('${escapeHtml(image)}')"`
            : ""
        }
      ></div>

      <div class="details-inner">
        ${
          image
            ? `
              <img
                class="details-poster"
                src="${escapeHtml(image)}"
                alt="${escapeHtml(getTitle(video))}"
                loading="eager"
              >
            `
            : `
              <div class="details-poster"></div>
            `
        }

        <div class="details-copy">
          <div class="modal-kicker">
            ${escapeHtml(series || "MEDIA")}
          </div>

          <h2 id="detailsTitle">
            ${escapeHtml(getTitle(video))}
          </h2>

          <div class="details-meta">
            ${meta}
          </div>

          <p>
            ${escapeHtml(
              getDescription(video) ||
              `Watch ${getTitle(video)} from the library.`
            )}
          </p>

          <div class="details-actions">
            <button
              class="button primary-button"
              type="button"
              data-details-watch
            >
              ▶ Watch now
            </button>

            <button
              class="button glass-button"
              type="button"
              data-details-favorite
            >
              ${
                state.favorites.has(video.id)
                  ? "♥ Saved"
                  : "♡ My list"
              }
            </button>
          </div>
        </div>
      </div>
    </div>

    ${
      siblings.length
        ? `
          <div class="details-more">
            <h3>
              More from ${escapeHtml(
                series ||
                "this collection"
              )}
            </h3>

            <div class="details-more-grid">
              ${siblings
                .map(item =>
                  createCardHtml(item)
                )
                .join("")}
            </div>
          </div>
        `
        : ""
    }
  `;
}

function openDetails(video) {
  if (!video) {
    return;
  }

  state.currentVideo =
    video;

  renderDetails(video);

  elements.detailsModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );
}

function renderHistory() {
  const entries =
    state.history
      .map(item => ({
        ...item,
        video: videoById(item.id)
      }))
      .filter(
        entry => entry.video
      );

  if (!entries.length) {
    elements.historyContent.innerHTML = `
      <div class="empty-history">
        <div>
          <strong>No watch history yet.</strong>
          <div>
            Start watching something and it will appear here.
          </div>
        </div>
      </div>
    `;

    elements.clearHistoryButton.disabled =
      true;

    elements.clearHistoryButton.style.opacity =
      ".45";

    return;
  }

  elements.clearHistoryButton.disabled =
    false;

  elements.clearHistoryButton.style.opacity =
    "";

  elements.historyContent.innerHTML =
    entries
      .map(entry => {
        const image =
          safeUrl(
            getImage(
              entry.video
            )
          );

        const date =
          new Date(
            entry.timestamp
          ).toLocaleString(
            undefined,
            {
              dateStyle: "medium",
              timeStyle: "short"
            }
          );

        return `
          <article
            class="history-item"
            data-video-id="${escapeHtml(entry.video.id)}"
          >
            <div class="history-thumb">
              ${
                image
                  ? `
                    <img
                      src="${escapeHtml(image)}"
                      alt=""
                      loading="lazy"
                    >
                  `
                  : ""
              }
            </div>

            <div class="history-details">
              <strong>
                ${escapeHtml(
                  getTitle(entry.video)
                )}
              </strong>

              <span>
                ${escapeHtml(
                  getSeries(entry.video)
                )}
                ${
                  date
                    ? ` · ${escapeHtml(date)}`
                    : ""
                }
              </span>
            </div>

            <div class="history-actions">
              <button
                class="button primary-button"
                type="button"
                data-history-watch
              >
                Resume
              </button>

              <button
                class="button subtle-button"
                type="button"
                data-history-remove
              >
                Remove
              </button>
            </div>
          </article>
        `;
      })
      .join("");
}

function openHistory() {
  renderHistory();

  elements.historyModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );
}

function clearHistory() {
  if (!state.history.length) {
    return;
  }

  state.history = [];

  saveHistory();

  renderContinueWatching();
  renderHistory();

  showToast(
    "Watch history cleared"
  );
}

function clearFilter(kind) {
  if (kind === "search") {
    elements.searchInput.value =
      "";

    elements.mobileSearchInput.value =
      "";
  }

  if (kind === "series") {
    elements.seriesFilter.value =
      "ALL";
  }

  if (kind === "genre") {
    elements.genreFilter.value =
      "ALL";
  }

  if (kind === "quality") {
    elements.qualityFilter.value =
      "ALL";
  }

  applyFilters();
}

function resetFilters() {
  elements.searchInput.value =
    "";

  elements.mobileSearchInput.value =
    "";

  elements.seriesFilter.value =
    "ALL";

  elements.genreFilter.value =
    "ALL";

  elements.qualityFilter.value =
    "ALL";

  elements.sortFilter.value =
    "catalogue";

  applyFilters();
}

function syncSearch(source) {
  const value =
    source.value;

  if (
    source !==
    elements.searchInput
  ) {
    elements.searchInput.value =
      value;
  }

  if (
    source !==
    elements.mobileSearchInput
  ) {
    elements.mobileSearchInput.value =
      value;
  }

  applyFilters();
}

function setView(view) {
  state.currentView =
    view;

  const navButtons =
    document.querySelectorAll(
      "[data-nav-view], #homeButton, #browseButton, #favoritesButton"
    );

  navButtons.forEach(button => {
    const buttonView =
      button.dataset.navView ||
      (
        button.id === "homeButton"
          ? "home"
          : button.id === "favoritesButton"
            ? "favorites"
            : button.id === "browseButton"
              ? "browse"
              : ""
      );

    button.classList.toggle(
      "active",
      buttonView === view
    );
  });

  if (view === "favorites") {
    elements.discoverySection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    elements.seriesSection.classList.add(
      "hidden"
    );

    elements.continueSection.classList.add(
      "hidden"
    );

    const filters =
      getFilterState();

    let videos =
      state.videos.filter(video =>
        state.favorites.has(
          video.id
        )
      );

    if (
      filters.query ||
      filters.series !== "ALL" ||
      filters.genre !== "ALL" ||
      filters.quality !== "ALL"
    ) {
      videos =
        videos.filter(
          video => {
            const haystack = [
              getTitle(video),
              getSeries(video),
              getDescription(video),
              ...getGenres(video),
              getQuality(video),
              String(
                getEpisodeNumber(
                  video
                )
              )
            ]
              .join(" ")
              .toLowerCase();

            return (
              (!filters.query ||
                haystack.includes(
                  filters.query
                )) &&
              (
                filters.series ===
                  "ALL" ||
                getSeries(video) ===
                  filters.series
              ) &&
              (
                filters.genre ===
                  "ALL" ||
                getGenres(video).includes(
                  filters.genre
                )
              ) &&
              (
                filters.quality ===
                  "ALL" ||
                getQuality(video) ===
                  filters.quality
              )
            );
          }
        );
    }

    state.filteredVideos =
      sortVideos(
        videos,
        filters.sort
      );

    updateLibraryCopy(
      filters
    );

    renderGrid();
    renderActiveFilters(
      filters
    );
  } else {
    elements.continueSection.classList.toggle(
      "hidden",
      state.history.length === 0
    );

    elements.seriesSection.classList.toggle(
      "hidden",
      false
    );

    if (view === "home") {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    } else {
      elements.discoverySection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }

    applyFilters();
  }

  closeMobileMenu();
}

function openBrowse() {
  setView("browse");
}

function openHome() {
  setView("home");
}

function showToast(message) {
  window.clearTimeout(
    state.toastTimer
  );

  elements.toast.textContent =
    message;

  elements.toast.classList.add(
    "visible"
  );

  state.toastTimer =
    window.setTimeout(
      () =>
        elements.toast.classList.remove(
          "visible"
        ),
      2300
    );
}

function announce(message) {
  elements.notification.textContent =
    message;
}

function closeMobileMenu() {
  elements.mobileNav.hidden =
    true;

  elements.mobileMenuButton?.setAttribute(
    "aria-expanded",
    "false"
  );
}

function toggleMobileMenu() {
  const next =
    elements.mobileNav.hidden;

  elements.mobileNav.hidden =
    !next;

  elements.mobileMenuButton.setAttribute(
    "aria-expanded",
    String(next)
  );
}

function handleCardClick(event) {
  const card =
    event.target.closest(
      ".video-card"
    );

  if (!card) {
    return;
  }

  const video =
    videoById(
      card.dataset.videoId
    );

  if (!video) {
    return;
  }

  const action =
    event.target.closest(
      "[data-action]"
    )?.dataset.action;

  if (action === "favorite") {
    toggleFavorite(video.id);
  } else if (action === "watch") {
    openPlayer(video);
  } else if (action === "info") {
    openDetails(video);
  }
}

function bindEvents() {
  elements.brandButton.addEventListener(
    "click",
    openHome
  );

  elements.homeButton.addEventListener(
    "click",
    openHome
  );

  elements.browseButton.addEventListener(
    "click",
    openBrowse
  );

  elements.favoritesButton.addEventListener(
    "click",
    () => setView("favorites")
  );

  elements.historyButton.addEventListener(
    "click",
    openHistory
  );

  elements.openHistoryFromSection.addEventListener(
    "click",
    openHistory
  );

  elements.mobileSearchButton.addEventListener(
    "click",
    () => {
      openBrowse();

      window.setTimeout(
        () =>
          elements.mobileSearchInput.focus(),
        50
      );
    }
  );

  elements.mobileMenuButton.addEventListener(
    "click",
    toggleMobileMenu
  );

  elements.searchInput.addEventListener(
    "input",
    () =>
      syncSearch(
        elements.searchInput
      )
  );

  elements.mobileSearchInput.addEventListener(
    "input",
    () =>
      syncSearch(
        elements.mobileSearchInput
      )
  );

  elements.seriesFilter.addEventListener(
    "change",
    applyFilters
  );

  elements.genreFilter.addEventListener(
    "change",
    applyFilters
  );

  elements.qualityFilter.addEventListener(
    "change",
    applyFilters
  );

  elements.sortFilter.addEventListener(
    "change",
    applyFilters
  );

  elements.resetButton.addEventListener(
    "click",
    resetFilters
  );

  elements.emptyResetButton.addEventListener(
    "click",
    resetFilters
  );

  elements.retryButton.addEventListener(
    "click",
    loadCatalogue
  );

  elements.videoGrid.addEventListener(
    "click",
    handleCardClick
  );

  elements.continueRow.addEventListener(
    "click",
    handleCardClick
  );

  elements.seriesGrid.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          "[data-series]"
        );

      if (!button) {
        return;
      }

      elements.seriesFilter.value =
        button.dataset.series;

      openBrowse();
      applyFilters();
    }
  );

  elements.activeFilters.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          "[data-clear-filter]"
        );

      if (button) {
        clearFilter(
          button.dataset.clearFilter
        );
      }
    }
  );

  elements.heroWatchButton.addEventListener(
    "click",
    () =>
      openPlayer(
        state.featuredVideo
      )
  );

  elements.heroFavoriteButton.addEventListener(
    "click",
    () => {
      if (state.featuredVideo) {
        toggleFavorite(
          state.featuredVideo.id
        );
      }
    }
  );

  elements.heroInfoButton.addEventListener(
    "click",
    () =>
      openDetails(
        state.featuredVideo
      )
  );

  elements.playerBackButton.addEventListener(
    "click",
    closePlayer
  );

  elements.playerBackdrop.addEventListener(
    "click",
    closePlayer
  );

  elements.playerPrevButton.addEventListener(
    "click",
    () =>
      openRelativeEpisode(-1)
  );

  elements.playerNextButton.addEventListener(
    "click",
    () =>
      openRelativeEpisode(1)
  );

  elements.playerFavoriteButton.addEventListener(
    "click",
    () => {
      if (state.currentVideo) {
        toggleFavorite(
          state.currentVideo.id
        );
      }
    }
  );

  elements.playerInfoButton.addEventListener(
    "click",
    () => {
      const video =
        state.currentVideo;

      closePlayer();
      openDetails(video);
    }
  );

  elements.playerFrame.addEventListener(
    "load",
    () =>
      elements.playerLoading.classList.add(
        "hidden"
      )
  );

  elements.closeDetailsButton.addEventListener(
    "click",
    () =>
      closeModal(
        elements.detailsModal
      )
  );

  elements.detailsBackdrop.addEventListener(
    "click",
    () =>
      closeModal(
        elements.detailsModal
      )
  );

  elements.detailsContent.addEventListener(
    "click",
    event => {
      if (!state.currentVideo) {
        return;
      }

      if (
        event.target.closest(
          "[data-details-watch]"
        )
      ) {
        const video =
          state.currentVideo;

        closeModal(
          elements.detailsModal
        );

        openPlayer(video);
      } else if (
        event.target.closest(
          "[data-details-favorite]"
        )
      ) {
        toggleFavorite(
          state.currentVideo.id
        );
      } else if (
        event.target.closest(
          ".video-card"
        )
      ) {
        closeModal(
          elements.detailsModal
        );

        handleCardClick(event);
      }
    }
  );

  elements.closeHistoryButton.addEventListener(
    "click",
    () =>
      closeModal(
        elements.historyModal
      )
  );

  elements.historyBackdrop.addEventListener(
    "click",
    () =>
      closeModal(
        elements.historyModal
      )
  );

  elements.clearHistoryButton.addEventListener(
    "click",
    clearHistory
  );

  elements.historyContent.addEventListener(
    "click",
    event => {
      const item =
        event.target.closest(
          ".history-item"
        );

      if (!item) {
        return;
      }

      const video =
        videoById(
          item.dataset.videoId
        );

      if (!video) {
        return;
      }

      if (
        event.target.closest(
          "[data-history-watch]"
        )
      ) {
        openPlayer(video);
      }

      if (
        event.target.closest(
          "[data-history-remove]"
        )
      ) {
        state.history =
          state.history.filter(
            historyItem =>
              historyItem.id !==
              video.id
          );

        saveHistory();
        renderHistory();
        renderContinueWatching();

        showToast(
          "Removed from history"
        );
      }
    }
  );

  document
    .querySelectorAll(
      "[data-nav-view]"
    )
    .forEach(button =>
      button.addEventListener(
        "click",
        () =>
          setView(
            button.dataset.navView
          )
      )
    );

  document
    .querySelectorAll(
      "[data-nav-history]"
    )
    .forEach(button =>
      button.addEventListener(
        "click",
        openHistory
      )
    );

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "/" &&
        document.activeElement?.tagName !==
          "INPUT" &&
        document.activeElement?.tagName !==
          "TEXTAREA"
      ) {
        event.preventDefault();

        openBrowse();

        elements.searchInput.focus();
      }

      if (
        event.key === "Escape"
      ) {
        if (
          !elements.playerModal.classList.contains(
            "hidden"
          )
        ) {
          closePlayer();
        } else if (
          !elements.detailsModal.classList.contains(
            "hidden"
          )
        ) {
          closeModal(
            elements.detailsModal
          );
        } else if (
          !elements.historyModal.classList.contains(
            "hidden"
          )
        ) {
          closeModal(
            elements.historyModal
          );
        } else {
          closeMobileMenu();
        }
      }
    }
  );
}

function init() {
  cacheElements();
  loadStorage();
  bindEvents();
  loadCatalogue();
}

document.addEventListener(
  "DOMContentLoaded",
  init,
  { once: true }
);
