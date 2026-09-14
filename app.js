"use strict";

const CONFIG = Object.freeze({
  catalogueUrl: "./data/videos.json",
  seriesUrl: "./data/series.json",

  storageKeys: {
    favorites: "unhappy:favorites:v3",
    history: "unhappy:history:v3"
  },

  maxHistory: 50
});


const state = {
  videos: [],
  seriesMeta: new Map(),
  series: [],
  filteredSeries: [],

  favorites: new Set(),
  history: [],

  currentSeries: null,
  currentVideo: null,

  currentView: "home",
  toastTimer: null
};


const $ = id =>
  document.getElementById(id);


const els = {};

const ids = [
  "brandButton",
  "historyButton",
  "mobileHistoryButton",
  "mobileMenuButton",
  "mobileNav",

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
  "heroSeriesButton",
  "heroFavoriteButton",
  "heroFavoriteLabel",

  "continueSection",
  "continueRow",
  "openHistoryButton",

  "seriesSection",
  "seriesTitle",
  "seriesSubtitle",
  "seriesCount",

  "genreFilter",
  "seriesSort",
  "resetButton",

  "loadingState",
  "errorState",
  "errorMessage",
  "retryButton",
  "emptyState",
  "seriesGrid",

  "episodeLibrary",
  "episodeTitle",
  "episodeSubtitle",
  "resultCount",
  "seriesFilter",
  "episodeSort",
  "videoGrid",

  "seriesModal",
  "closeSeriesButton",
  "seriesModalImage",
  "seriesModalTitle",
  "seriesModalMeta",
  "seriesModalDescription",
  "seriesModalGenres",
  "seriesModalStats",
  "seriesPlayButton",
  "seriesContinueButton",
  "seriesFavoriteButton",
  "seriesEpisodeSearch",
  "seriesEpisodeList",

  "playerModal",
  "playerBackButton",
  "playerSeries",
  "playerTitle",
  "playerPrevButton",
  "playerNextButton",
  "playerLoading",
  "playerFrame",
  "playerTitleBelow",
  "playerMeta",
  "playerFavoriteButton",
  "playerInfoButton",

  "historyModal",
  "closeHistoryButton",
  "historyContent",
  "clearHistoryButton",

  "toast",

  "favoriteCount",
  "mobileFavoriteCount",
  "footerStats"
];


ids.forEach(id => {
  els[id] = $(id);
});


/* --------------------------------------------------
   BASIC HELPERS
-------------------------------------------------- */

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]
  );
}


function text(value) {
  return String(value ?? "").trim();
}


function normalise(value) {
  return text(value).toLocaleLowerCase();
}


function toArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(text)
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map(text)
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


function compareText(a, b) {
  return text(a).localeCompare(
    text(b),
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}


/* --------------------------------------------------
   VIDEO DATA ACCESSORS
-------------------------------------------------- */

function titleOf(video) {
  return (
    text(
      video.title ??
      video.name
    ) ||
    "Untitled"
  );
}


function seriesOf(video) {
  return (
    text(
      video.series ??
      video.show ??
      video.anime
    ) ||
    "Other"
  );
}


const MEDIA_TYPES = new Set(["episode", "movie", "ova", "ona", "extra", "other"]);
const MEDIA_CATEGORIES = new Set(["main", "special", "movie", "ova", "ona", "extra", "other"]);

function typeOf(video) {
  const value = normalise(video.type);
  return MEDIA_TYPES.has(value) ? value : "episode";
}

function categoryOf(video) {
  const value = normalise(video.category);
  if (MEDIA_CATEGORIES.has(value)) return value;
  return typeOf(video) === "episode" ? "main" : typeOf(video);
}

function seasonOf(video) {
  return numberOrNull(video.season ?? video.season_number);
}

function episodeTitleOf(video) {
  return text(video.episode_title ?? video.episodeTitle);
}

function specialDateOf(video) {
  return text(video.special_date ?? video.specialDate);
}

function sourceFilenameOf(video) {
  return text(video.source_filename ?? video.sourceFilename ?? video.filename);
}

function mediaGroupKey(video) {
  return `${categoryOf(video)}:${seasonOf(video) ?? "none"}`;
}

function normalizeVideo(video) {
  return {
    ...video,
    id: text(video.id),
    type: typeOf(video),
    category: categoryOf(video),
    series: seriesOf(video)
  };
}


function episodeOf(video) {
  return numberOrNull(
    video.episode ??
    video.episodeNumber ??
    video.episode_number
  );
}


function yearOf(video) {
  return numberOrNull(
    video.year
  );
}


function genresOf(video) {
  return toArray(
    video.genres ??
    video.genre
  );
}


function qualityOf(video) {
  return text(
    video.quality ??
    video.resolution
  );
}


function descriptionOf(video) {
  return text(
    video.description ??
    video.summary
  );
}


function imageOf(video) {
  return text(
    video.thumbnail ??
    video.poster ??
    video.image
  );
}


function embedOf(video) {
  return text(
    video.embed ??
    video.url ??
    video.videoUrl
  );
}


function episodeLabel(video) {
  const number = episodeOf(video);
  const specialDate = specialDateOf(video);
  const episodeTitle = episodeTitleOf(video);

  if (specialDate) return specialDate;
  if (number === null) return episodeTitle || categoryOf(video).toUpperCase();

  return Number.isInteger(number)
    ? `E${String(number).padStart(3, "0")}`
    : `E${number}`;
}


function safeUrl(value) {
  try {
    const url = new URL(
      text(value),
      location.href
    );

    if (
      [
        "http:",
        "https:",
        "blob:",
        "data:"
      ].includes(url.protocol)
    ) {
      return url.href;
    }
  } catch (_) {}

  return "";
}


/* --------------------------------------------------
   STORAGE
-------------------------------------------------- */

function loadStorage() {
  try {
    const favorites =
      JSON.parse(
        localStorage.getItem(
          CONFIG.storageKeys.favorites
        ) || "[]"
      );

    const history =
      JSON.parse(
        localStorage.getItem(
          CONFIG.storageKeys.history
        ) || "[]"
      );


    if (Array.isArray(favorites)) {
      state.favorites =
        new Set(
          favorites.filter(
            value =>
              typeof value === "string"
          )
        );
    }


    if (Array.isArray(history)) {
      state.history =
        history
          .filter(
            item =>
              item &&
              typeof item.id === "string"
          )
          .map(item => ({
            id: item.id,
            timestamp:
              numberOrNull(
                item.timestamp
              ) ||
              Date.now()
          }))
          .slice(
            0,
            CONFIG.maxHistory
          );
    }

  } catch (_) {
    state.favorites = new Set();
    state.history = [];
  }
}


function saveStorage() {
  try {
    localStorage.setItem(
      CONFIG.storageKeys.favorites,
      JSON.stringify(
        [...state.favorites]
      )
    );

    localStorage.setItem(
      CONFIG.storageKeys.history,
      JSON.stringify(
        state.history
      )
    );
  } catch (_) {}
}


/* --------------------------------------------------
   MODALS / TOAST
-------------------------------------------------- */

function setModal(modal, open) {
  modal.classList.toggle(
    "hidden",
    !open
  );

  document.body.classList.toggle(
    "modal-open",
    open
  );

  if (open) {
    modal
      .querySelector(
        "button,input"
      )
      ?.focus();
  }
}


function toast(message) {
  els.toast.textContent =
    message;

  els.toast.classList.add(
    "show"
  );

  clearTimeout(
    state.toastTimer
  );

  state.toastTimer =
    setTimeout(
      () =>
        els.toast.classList.remove(
          "show"
        ),
      2200
    );
}


/* --------------------------------------------------
   FETCHING
-------------------------------------------------- */

async function fetchJson(url) {
  const response =
    await fetch(
      url,
      {
        cache: "no-store",

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status})`
    );
  }

  return response.json();
}


async function load() {
  els.loadingState.classList.remove(
    "hidden"
  );

  els.errorState.classList.add(
    "hidden"
  );


  try {

    const [
      videoData,
      seriesData
    ] =
      await Promise.all([
        fetchJson(
          CONFIG.catalogueUrl
        ),

        fetchJson(
          CONFIG.seriesUrl
        ).catch(
          () => ({
            series: []
          })
        )
      ]);


    const rawVideos =
      Array.isArray(videoData)
        ? videoData
        : (
            videoData.videos ||
            videoData.items ||
            []
          );


    state.videos =
      rawVideos
        .filter(
          video =>
            video &&
            text(video.id) &&
            embedOf(video)
        )
        .map(normalizeVideo);


    if (!state.videos.length) {
      throw new Error(
        "No valid video entries were found in data/videos.json."
      );
    }


    const rawSeries =
      Array.isArray(seriesData)
        ? seriesData
        : (
            seriesData.series ||
            []
          );


    state.seriesMeta =
      new Map(
        rawSeries
          .filter(
            series =>
              series &&
              text(series.name)
          )
          .map(
            series => [
              normalise(
                series.name
              ),
              series
            ]
          )
      );


    state.series =
      buildSeries();


    const validIds =
      new Set(
        state.videos.map(
          video =>
            video.id
        )
      );


    state.favorites =
      new Set(
        [...state.favorites]
          .filter(
            id =>
              validIds.has(id)
          )
      );


    state.history =
      state.history.filter(
        item =>
          validIds.has(
            item.id
          )
      );


    saveStorage();

    buildFilters();

    renderHero();

    renderContinue();

    applySeriesFilters();

    renderEpisodes();

    updateCounts();


    els.footerStats.textContent =
      `${state.videos.length} ${
        state.videos.length === 1
          ? "title"
          : "titles"
      } · ${
        state.series.length
      } ${
        state.series.length === 1
          ? "series"
          : "series"
      }`;


    els.loadingState.classList.add(
      "hidden"
    );

  } catch (error) {

    console.error(
      "Library loading error:",
      error
    );

    els.loadingState.classList.add(
      "hidden"
    );

    els.errorState.classList.remove(
      "hidden"
    );

    els.errorMessage.textContent =
      error.message ||
      "Unknown catalogue error.";
  }
}


/* --------------------------------------------------
   SERIES BUILDING
-------------------------------------------------- */

function buildSeries() {

  const groups =
    new Map();


  /*
   * IMPORTANT:
   *
   * Episodes are grouped using a
   * normalized series name.
   *
   * This means:
   *
   * "Kiteretsu Daihyakka"
   *
   * and
   *
   * "  Kiteretsu Daihyakka  "
   *
   * become the same series.
   */

  state.videos.forEach(
    video => {

      const name =
        seriesOf(video);

      const key =
        normalise(name);


      if (!groups.has(key)) {
        groups.set(
          key,
          []
        );
      }


      groups
        .get(key)
        .push(video);
    }
  );


  return [
    ...groups.entries()
  ].map(
    ([key, episodes]) => {

      /*
       * NUMERIC EPISODE SORT
       *
       * 1
       * 2
       * 3
       * 10
       *
       * rather than:
       *
       * 1
       * 10
       * 2
       * 3
       */

      episodes.sort(
        (a, b) => {

          const aEpisode =
            episodeOf(a);

          const bEpisode =
            episodeOf(b);


          if (
            aEpisode !== null &&
            bEpisode !== null
          ) {
            return (
              aEpisode -
              bEpisode
            );
          }


          if (
            aEpisode !== null
          ) {
            return -1;
          }


          if (
            bEpisode !== null
          ) {
            return 1;
          }


          return compareText(
            titleOf(a),
            titleOf(b)
          );
        }
      );


      const metadata =
        state.seriesMeta.get(
          key
        ) || {};


      const firstEpisode =
        episodes[0];


      const numberedEpisodes =
        episodes.filter(
          episode =>
            episodeOf(
              episode
            ) !== null
        );


      const latestEpisode =
        numberedEpisodes.length
          ? numberedEpisodes[
              numberedEpisodes.length - 1
            ]
          : firstEpisode;


      /*
       * Manual series artwork wins.
       *
       * If no manual series thumbnail
       * exists, the first episode
       * thumbnail becomes a fallback.
       */

      const thumbnail =
        safeUrl(
          metadata.thumbnail
        ) ||
        imageOf(
          firstEpisode
        );


      const backdrop =
        safeUrl(
          metadata.backdrop
        ) ||
        safeUrl(
          metadata.thumbnail
        ) ||
        imageOf(
          firstEpisode
        );


      const metadataGenres =
        toArray(
          metadata.genres
        );


      const derivedGenres =
        [
          ...new Set(
            episodes.flatMap(
              genresOf
            )
          )
        ];


      const buckets = {
        episodes: episodes.filter(video => categoryOf(video) === "main" && typeOf(video) === "episode"),
        seasons: new Map(),
        specials: episodes.filter(video => categoryOf(video) === "special"),
        movies: episodes.filter(video => categoryOf(video) === "movie" || typeOf(video) === "movie"),
        ovas: episodes.filter(video => categoryOf(video) === "ova" || typeOf(video) === "ova"),
        onas: episodes.filter(video => categoryOf(video) === "ona" || typeOf(video) === "ona"),
        extras: episodes.filter(video => categoryOf(video) === "extra" || typeOf(video) === "extra"),
        other: episodes.filter(video => categoryOf(video) === "other" || typeOf(video) === "other")
      };
      episodes.filter(video => categoryOf(video) === "main" && typeOf(video) === "episode" && seasonOf(video) !== null)
        .forEach(video => {
          const season = seasonOf(video);
          if (!buckets.seasons.has(season)) buckets.seasons.set(season, []);
          buckets.seasons.get(season).push(video);
        });

      return {

        key,

        name:
          text(
            metadata.name
          ) ||
          seriesOf(
            firstEpisode
          ),

        episodes,
        groups: buckets,

        thumbnail,

        backdrop,

        description:
          text(
            metadata.description
          ) ||
          descriptionOf(
            firstEpisode
          ) ||
          `A collection of ${episodes.length} episode${
            episodes.length === 1
              ? ""
              : "s"
          }.`,


        year:
          numberOrNull(
            metadata.year
          ) ??
          yearOf(
            firstEpisode
          ),


        genres:
          metadataGenres.length
            ? metadataGenres
            : derivedGenres,


        status:
          text(
            metadata.status
          ) ||
          "Library",


        latest:
          latestEpisode
      };
    }
  );
}


/* --------------------------------------------------
   SERIES PROGRESS
-------------------------------------------------- */

function seriesProgress(series) {

  const ids =
    new Set(
      series.episodes.map(
        episode =>
          episode.id
      )
    );


  const watched =
    state.history.filter(
      history =>
        ids.has(
          history.id
        )
    );


  if (!watched.length) {
    return 0;
  }


  return Math.min(
    100,
    Math.round(
      (
        watched.length /
        series.episodes.length
      ) * 100
    )
  );
}


function continueVideoForSeries(
  series
) {

  const ids =
    new Set(
      series.episodes.map(
        episode =>
          episode.id
      )
    );


  const history =
    state.history
      .filter(
        item =>
          ids.has(item.id)
      )
      .sort(
        (a,b) =>
          b.timestamp -
          a.timestamp
      );


  if (!history.length) {
    return null;
  }


  return (
    state.videos.find(
      video =>
        video.id ===
        history[0].id
    ) ||
    null
  );
}


/* --------------------------------------------------
   HERO
-------------------------------------------------- */

function renderHero() {

  const series =
    state.series[0];


  if (!series) {
    return;
  }


  els.heroBadge.textContent =
    series.status === "Complete"
      ? "FEATURED SERIES"
      : "FEATURED";


  els.heroTitle.textContent =
    series.name;


  els.heroMeta.innerHTML =
    [
      series.year,

      `${series.episodes.length} ${
        series.episodes.length === 1
          ? "Episode"
          : "Episodes"
      }`,

      ...series.genres.slice(
        0,
        3
      )
    ]
      .filter(Boolean)
      .map(
        value =>
          `<span>${escapeHtml(
            value
          )}</span>`
      )
      .join("");


  els.heroDescription.textContent =
    series.description;


  els.heroPoster.src =
    series.thumbnail ||
    "";


  els.heroPoster.alt =
    `${series.name} poster`;


  els.heroBackground.style.backgroundImage =
    series.backdrop
      ? `url("${series.backdrop}")`
      : "";


  els.heroWatchButton.onclick =
    () =>
      openPlayer(
        series.episodes[0]
      );


  els.heroSeriesButton.onclick =
    () =>
      openSeries(
        series
      );


  els.heroFavoriteButton.onclick =
    () =>
      toggleSeriesFavorite(
        series
      );


  updateHeroFavorite(
    series
  );
}


function updateHeroFavorite(
  series
) {

  const saved =
    series.episodes.every(
      episode =>
        state.favorites.has(
          episode.id
        )
    );


  els.heroFavoriteLabel.textContent =
    saved
      ? "In My List"
      : "My List";


  els.heroFavoriteButton.classList.toggle(
    "saved",
    saved
  );
}


/* --------------------------------------------------
   FILTERS
-------------------------------------------------- */

function fillSelect(
  select,
  values,
  firstLabel
) {

  const current =
    select.value;


  select.innerHTML =
    `<option value="ALL">${
      escapeHtml(
        firstLabel
      )
    }</option>`;


  values.forEach(
    value => {

      select.insertAdjacentHTML(
        "beforeend",

        `<option value="${
          escapeHtml(value)
        }">${
          escapeHtml(value)
        }</option>`
      );
    }
  );


  if (
    [...select.options]
      .some(
        option =>
          option.value ===
          current
      )
  ) {
    select.value =
      current;
  }
}


function buildFilters() {

  const genres =
    [
      ...new Set(
        state.series.flatMap(
          series =>
            series.genres
        )
      )
    ].sort(
      compareText
    );


  fillSelect(
    els.genreFilter,
    genres,
    "All genres"
  );


  fillSelect(
    els.seriesFilter,

    state.series
      .map(
        series =>
          series.name
      )
      .sort(
        compareText
      ),

    "All series"
  );
}


/* --------------------------------------------------
   SEARCH
-------------------------------------------------- */

function searchQuery() {

  return normalise(
    els.searchInput.value ||
    els.mobileSearchInput.value
  );
}


function seriesMatches(
  series
) {

  const query =
    searchQuery();


  const genre =
    els.genreFilter.value;


  const searchable =
    [
      series.name,
      series.description,
      series.status,

      ...series.genres,

      ...series.episodes.flatMap(
        episode => [
          titleOf(
            episode
          ),

          episodeTitleOf(episode),
          String(episodeOf(episode) ?? ""),
          String(seasonOf(episode) ?? ""),
          typeOf(episode),
          categoryOf(episode),
          specialDateOf(episode),
          sourceFilenameOf(episode)
        ]
      )
    ].join(" ");


  return (
    (
      !query ||
      normalise(
        searchable
      ).includes(
        query
      )
    ) &&

    (
      genre === "ALL" ||
      series.genres.includes(
        genre
      )
    )
  );
}


/* --------------------------------------------------
   SERIES FILTERING
-------------------------------------------------- */

function applySeriesFilters() {

  let list =
    state.series.filter(
      series =>
        seriesMatches(
          series
        )
    );


  const sort =
    els.seriesSort.value;


  if (sort === "az") {

    list.sort(
      (a,b) =>
        compareText(
          a.name,
          b.name
        )
    );

  }


  if (sort === "za") {

    list.sort(
      (a,b) =>
        compareText(
          b.name,
          a.name
        )
    );

  }


  if (sort === "episodes") {

    list.sort(
      (a,b) =>
        b.episodes.length -
        a.episodes.length
    );

  }


  if (sort === "year") {

    list.sort(
      (a,b) =>
        (b.year || 0) -
        (a.year || 0)
    );

  }


  state.filteredSeries =
    list;


  els.seriesCount.textContent =
    `${list.length} ${
      list.length === 1
        ? "series"
        : "series"
    }`;


  els.seriesGrid.classList.toggle(
    "hidden",
    !list.length
  );


  els.emptyState.classList.toggle(
    "hidden",
    !!list.length
  );


  els.seriesGrid.innerHTML =
    list
      .map(
        seriesCard
      )
      .join("");


  bindSeriesCards();
}


function bindSeriesCards() {

  els.seriesGrid
    .querySelectorAll(
      "[data-series]"
    )
    .forEach(
      button => {

        button.onclick =
          () => {

            const series =
              state.series.find(
                item =>
                  item.key ===
                  button.dataset.series
              );


            openSeries(
              series
            );
          };
      }
    );


  els.seriesGrid
    .querySelectorAll(
      "[data-series-fav]"
    )
    .forEach(
      button => {

        button.onclick =
          event => {

            event.stopPropagation();


            const series =
              state.series.find(
                item =>
                  item.key ===
                  button.dataset.seriesFav
              );


            toggleSeriesFavorite(
              series
            );
          };
      }
    );
}


/* --------------------------------------------------
   SERIES CARD
-------------------------------------------------- */

function seriesCard(
  series
) {

  const progress =
    seriesProgress(
      series
    );


  const saved =
    series.episodes.every(
      episode =>
        state.favorites.has(
          episode.id
        )
    );


  return `
    <article
      class="series-card"
    >

      <button
        class="series-card-main"
        data-series="${escapeHtml(
          series.key
        )}"
        type="button"
      >

        <div class="poster-wrap">

          <img
            src="${escapeHtml(
              series.thumbnail
            )}"
            alt=""
            loading="lazy"
            onerror="this.closest('.poster-wrap').classList.add('image-failed')"
          >

          <span class="episode-count">
            ${
              series.episodes.length
            }
            ${
              series.episodes.length === 1
                ? "EP"
                : "EPS"
            }
          </span>

        </div>


        <div class="series-card-body">

          <div class="series-card-title">
            ${escapeHtml(
              series.name
            )}
          </div>


          <div class="series-card-meta">

            ${
              series.year
                ? `${escapeHtml(
                    series.year
                  )} · `
                : ""
            }

            ${escapeHtml(
              series.status
            )}

          </div>


          <p>
            ${escapeHtml(
              series.description
            )}
          </p>


          <div class="tag-list">

            ${series.genres
              .slice(0,3)
              .map(
                genre =>
                  `<span>${escapeHtml(
                    genre
                  )}</span>`
              )
              .join("")}

          </div>


          ${
            progress
              ? `
                <div class="progress">
                  <i
                    style="width:${progress}%"
                  ></i>
                </div>

                <small>
                  ${progress}% watched
                </small>
              `
              : ""
          }

        </div>

      </button>


      <button
        class="series-fav ${
          saved
            ? "saved"
            : ""
        }"
        data-series-fav="${escapeHtml(
          series.key
        )}"
        type="button"
        aria-label="${
          saved
            ? "Remove from"
            : "Add to"
        } My List"
      >
        ${
          saved
            ? "♥"
            : "♡"
        }
      </button>

    </article>
  `;
}


/* --------------------------------------------------
   CONTINUE WATCHING
-------------------------------------------------- */

function renderContinue() {

  const videos =
    state.history
      .slice()
      .sort(
        (a,b) =>
          b.timestamp -
          a.timestamp
      )
      .map(
        history =>
          state.videos.find(
            video =>
              video.id ===
              history.id
          )
      )
      .filter(Boolean)
      .slice(0,6);


  els.continueSection.classList.toggle(
    "hidden",
    !videos.length
  );


  els.continueRow.innerHTML =
    videos
      .map(
        episodeCard
      )
      .join("");


  bindEpisodeButtons(
    els.continueRow
  );
}


/* --------------------------------------------------
   EPISODE CARD
-------------------------------------------------- */

function episodeCard(
  video
) {

  return `
    <button
      class="episode-card"
      data-episode="${escapeHtml(
        video.id
      )}"
      type="button"
    >

      <div class="episode-thumb">

        <img
          src="${escapeHtml(
            imageOf(video)
          )}"
          alt=""
          loading="lazy"
        >

        <span>
          ${escapeHtml(
            episodeLabel(
              video
            )
          )}
        </span>

      </div>


      <div class="episode-card-body">

        <strong>
          ${escapeHtml(
            titleOf(video)
          )}
        </strong>

        <small>
          ${escapeHtml(seriesOf(video))}
          · ${escapeHtml(episodeLabel(video))}
          ${seasonOf(video) ? ` · S${seasonOf(video)}` : ""}
          ${categoryOf(video) !== "main" ? ` · ${escapeHtml(categoryOf(video))}` : ""}
        </small>

      </div>

    </button>
  `;
}


function bindEpisodeButtons(
  root
) {

  root
    .querySelectorAll(
      "[data-episode]"
    )
    .forEach(
      button => {

        button.onclick =
          () => {

            const video =
              state.videos.find(
                item =>
                  item.id ===
                  button.dataset.episode
              );


            openPlayer(
              video
            );
          };
      }
    );
}


/* --------------------------------------------------
   EPISODE LIBRARY
-------------------------------------------------- */

function renderEpisodes() {

  const query =
    searchQuery();


  const selectedSeries =
    els.seriesFilter.value;


  let list =
    state.videos.filter(
      video => {

        const searchable =
          [
            titleOf(video),
            seriesOf(video),
            descriptionOf(video),

            ...genresOf(
              video
            ),

            episodeTitleOf(video),
            String(episodeOf(video) ?? ""),
            String(seasonOf(video) ?? ""),
            typeOf(video),
            categoryOf(video),
            specialDateOf(video),
            sourceFilenameOf(video)
          ].join(" ");


        return (
          (
            !query ||
            normalise(
              searchable
            ).includes(
              query
            )
          ) &&

          (
            selectedSeries ===
              "ALL" ||
            seriesOf(video) ===
              selectedSeries
          )
        );
      }
    );


  const sort =
    els.episodeSort.value;


  if (sort === "episode") {

    list.sort(
      (a,b) =>
        (
          episodeOf(a) ??
          Infinity
        ) -
        (
          episodeOf(b) ??
          Infinity
        )
    );

  }


  else if (
    sort === "episode-desc"
  ) {

    list.sort(
      (a,b) =>
        (
          episodeOf(b) ??
          -Infinity
        ) -
        (
          episodeOf(a) ??
          -Infinity
        )
    );

  }


  else if (
    sort === "title"
  ) {

    list.sort(
      (a,b) =>
        compareText(
          titleOf(a),
          titleOf(b)
        )
    );

  }


  else if (
    sort === "newest"
  ) {

    list.sort(
      (a,b) =>
        (
          yearOf(b) ||
          0
        ) -
        (
          yearOf(a) ||
          0
        )
    );

  }


  else {

    /*
     * Default:
     *
     * SERIES A
     *   001
     *   002
     *   003
     *
     * SERIES B
     *   001
     *   002
     */

    list.sort(
      (a,b) =>
        compareText(
          seriesOf(a),
          seriesOf(b)
        ) ||

        (
          episodeOf(a) ??
          Infinity
        ) -
        (
          episodeOf(b) ??
          Infinity
        )
    );
  }


  els.resultCount.textContent =
    `${list.length} ${
      list.length === 1
        ? "episode"
        : "episodes"
    }`;


  els.videoGrid.innerHTML =
    list
      .map(
        episodeCard
      )
      .join("");


  bindEpisodeButtons(
    els.videoGrid
  );


  if (
    query ||
    selectedSeries !== "ALL"
  ) {

    els.episodeTitle.textContent =
      "Matching episodes";

  } else {

    els.episodeTitle.textContent =
      "All episodes";
  }


  els.episodeSubtitle.textContent =
    query
      ? `Results for “${query}”`
      : "Every available episode, numbered and sorted correctly.";
}


/* --------------------------------------------------
   FAVORITES
-------------------------------------------------- */

function updateCounts() {

  const count =
    [
      ...state.favorites
    ].filter(
      id =>
        state.videos.some(
          video =>
            video.id ===
            id
        )
    ).length;


  els.favoriteCount.textContent =
    count;


  els.mobileFavoriteCount.textContent =
    count;
}


function toggleSeriesFavorite(
  series
) {

  if (!series) {
    return;
  }


  const allSaved =
    series.episodes.every(
      episode =>
        state.favorites.has(
          episode.id
        )
    );


  series.episodes.forEach(
    episode => {

      if (allSaved) {

        state.favorites.delete(
          episode.id
        );

      } else {

        state.favorites.add(
          episode.id
        );

      }

    }
  );


  saveStorage();

  updateCounts();

  renderContinue();

  applySeriesFilters();

  updateHeroFavorite(
    series
  );


  if (
    state.currentSeries &&
    state.currentSeries.key ===
      series.key
  ) {
    renderSeriesModal(
      series
    );
  }


  toast(
    allSaved
      ? `${series.name} removed from My List`
      : `${series.name} added to My List`
  );
}


/* --------------------------------------------------
   SERIES MODAL
-------------------------------------------------- */

function openSeries(
  series
) {

  if (!series) {
    return;
  }


  state.currentSeries =
    series;


  renderSeriesModal(
    series
  );


  setModal(
    els.seriesModal,
    true
  );
}


function renderSeriesModal(
  series
) {

  const progress =
    seriesProgress(
      series
    );


  const nextEpisode =
    continueVideoForSeries(
      series
    );


  els.seriesModalImage.src =
    series.thumbnail ||
    "";


  els.seriesModalImage.alt =
    series.name;


  els.seriesModalTitle.textContent =
    series.name;


  els.seriesModalMeta.innerHTML =
    [
      series.year,

      `${series.episodes.length} episodes`,

      series.status
    ]
      .filter(Boolean)
      .map(
        value =>
          `<span>${escapeHtml(
            value
          )}</span>`
      )
      .join("");


  els.seriesModalDescription.textContent =
    series.description;


  els.seriesModalGenres.innerHTML =
    series.genres
      .map(
        genre =>
          `<span>${escapeHtml(
            genre
          )}</span>`
      )
      .join("");


  els.seriesModalStats.innerHTML = `
    <div>
      <b>${series.episodes.length}</b>
      <span>Episodes</span>
    </div>

    <div>
      <b>${series.year || "—"}</b>
      <span>Year</span>
    </div>

    <div>
      <b>${progress}%</b>
      <span>Watched</span>
    </div>
  `;


  els.seriesPlayButton.onclick =
    () =>
      openPlayer(
        series.episodes[0]
      );


  els.seriesContinueButton.onclick =
    () =>
      openPlayer(
        nextEpisode ||
        series.episodes[0]
      );


  els.seriesContinueButton.disabled =
    !nextEpisode;


  const saved =
    series.episodes.every(
      episode =>
        state.favorites.has(
          episode.id
        )
    );


  els.seriesFavoriteButton.textContent =
    saved
      ? "♥ In My List"
      : "♡ Add to My List";


  els.seriesFavoriteButton.onclick =
    () =>
      toggleSeriesFavorite(
        series
      );


  renderSeriesEpisodes(
    series
  );
}


function renderSeriesEpisodes(
  series
) {

  const query =
    normalise(
      els.seriesEpisodeSearch.value
    );


  const list =
    series.episodes.filter(
      video =>
        !query ||
        normalise(
          [
            titleOf(video),
            String(
              episodeOf(video) ??
              ""
            )
          ].join(" ")
        ).includes(
          query
        )
    );


  const groups = new Map();
  list.forEach(video => {
    const label = categoryOf(video) === "main"
      ? (seasonOf(video) ? `Season ${seasonOf(video)}` : "Episodes")
      : ({ special: "Specials", movie: "Movies", ova: "OVAs", ona: "ONAs", extra: "Extras", other: "Other" }[categoryOf(video)] || "Other");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(video);
  });

  els.seriesEpisodeList.innerHTML = [...groups.entries()]
    .map(([label, videos]) => `<section class="media-group"><h3>${escapeHtml(label)}</h3>${videos.map(episodeCard).join("")}</section>`)
    .join("");


  bindEpisodeButtons(
    els.seriesEpisodeList
  );
}


/* --------------------------------------------------
   WATCH HISTORY
-------------------------------------------------- */

function markWatched(
  video
) {

  state.history =
    state.history.filter(
      item =>
        item.id !==
        video.id
    );


  state.history.unshift({
    id: video.id,
    timestamp: Date.now()
  });


  state.history =
    state.history.slice(
      0,
      CONFIG.maxHistory
    );


  saveStorage();

  renderContinue();
}


/* --------------------------------------------------
   PLAYER
-------------------------------------------------- */

function openPlayer(
  video
) {

  if (!video) {
    return;
  }


  state.currentVideo =
    video;


  markWatched(
    video
  );


  const series =
    state.series.find(
      item =>
        item.episodes.some(
          episode =>
            episode.id ===
            video.id
        )
    );


  els.playerSeries.textContent =
    series?.name ||
    seriesOf(video);


  els.playerTitle.textContent =
    titleOf(video);


  els.playerTitleBelow.textContent =
    `${
      series?.name ||
      seriesOf(video)
    } · Episode ${
      episodeLabel(video)
    }`;


  els.playerMeta.textContent =
    [
      yearOf(video),
      qualityOf(video),
      ...genresOf(video)
    ]
      .filter(Boolean)
      .join(" · ");


  const navigationEpisodes = series
    ? series.episodes.filter(episode => mediaGroupKey(episode) === mediaGroupKey(video))
    : [];
  const index = navigationEpisodes.findIndex(episode => episode.id === video.id);

  els.playerPrevButton.disabled = index <= 0;
  els.playerNextButton.disabled = index < 0 || index >= navigationEpisodes.length - 1;

  els.playerPrevButton.onclick = () => openPlayer(navigationEpisodes[index - 1]);
  els.playerNextButton.onclick = () => openPlayer(navigationEpisodes[index + 1]);


  els.playerFavoriteButton.textContent =
    state.favorites.has(
      video.id
    )
      ? "♥ In My List"
      : "♡ My List";


  els.playerFavoriteButton.onclick =
    () => {

      if (
        state.favorites.has(
          video.id
        )
      ) {

        state.favorites.delete(
          video.id
        );

      } else {

        state.favorites.add(
          video.id
        );
      }


      saveStorage();

      updateCounts();

      els.playerFavoriteButton.textContent =
        state.favorites.has(
          video.id
        )
          ? "♥ In My List"
          : "♡ My List";
    };


  els.playerInfoButton.onclick =
    () => {

      closePlayer();

      if (series) {
        openSeries(
          series
        );
      }
    };


  const embed =
    safeUrl(
      embedOf(video)
    );


  els.playerLoading.textContent =
    "Loading player…";


  els.playerLoading.classList.remove(
    "hidden"
  );


  els.playerFrame.removeAttribute(
    "src"
  );


  setModal(
    els.playerModal,
    true
  );


  requestAnimationFrame(
    () => {

      if (!embed) {

        els.playerLoading.textContent =
          "No playable source.";

        return;
      }


      els.playerFrame.src =
        embed;


      els.playerFrame.onload =
        () =>
          els.playerLoading.classList.add(
            "hidden"
          );
    }
  );
}


function closePlayer() {

  els.playerFrame.src =
    "about:blank";


  setModal(
    els.playerModal,
    false
  );
}


/* --------------------------------------------------
   HISTORY MODAL
-------------------------------------------------- */

function showHistory() {

  const items =
    state.history
      .map(
        history =>
          state.videos.find(
            video =>
              video.id ===
              history.id
          )
      )
      .filter(Boolean);


  if (!items.length) {

    els.historyContent.innerHTML = `
      <div class="state">
        <strong>
          No watch history yet.
        </strong>

        <p>
          Episodes you open will appear here.
        </p>
      </div>
    `;

  } else {

    els.historyContent.innerHTML = `
      <div class="history-list">

        ${items
          .map(
            video => {

              const history =
                state.history.find(
                  item =>
                    item.id ===
                    video.id
                );


              return `
                <div class="history-item">

                  ${episodeCard(
                    video
                  )}

                  <time>
                    ${
                      new Date(
                        history?.timestamp ||
                        Date.now()
                      ).toLocaleString()
                    }
                  </time>

                </div>
              `;
            }
          )
          .join("")}

      </div>
    `;


    bindEpisodeButtons(
      els.historyContent
    );
  }


  setModal(
    els.historyModal,
    true
  );
}


function closeHistory() {

  setModal(
    els.historyModal,
    false
  );
}


/* --------------------------------------------------
   NAVIGATION
-------------------------------------------------- */

function setView(
  view
) {

  state.currentView =
    view;


  document
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset.view ===
            view
        );
      }
    );


  if (view === "favorites") {

    const favoriteSeries =
      state.series.filter(
        series =>
          series.episodes.some(
            episode =>
              state.favorites.has(
                episode.id
              )
          )
      );


    els.seriesTitle.textContent =
      "My List";


    els.seriesSubtitle.textContent =
      "Series and episodes you saved.";


    els.seriesGrid.innerHTML =
      favoriteSeries
        .map(
          seriesCard
        )
        .join("");


    state.filteredSeries =
      favoriteSeries;


    els.seriesCount.textContent =
      `${favoriteSeries.length} series`;


    els.emptyState.classList.toggle(
      "hidden",
      !!favoriteSeries.length
    );


    els.seriesGrid.classList.toggle(
      "hidden",
      !favoriteSeries.length
    );


    bindSeriesCards();

  } else {

    els.seriesTitle.textContent =
      "Series";


    els.seriesSubtitle.textContent =
      "Everything grouped neatly by series.";


    applySeriesFilters();
  }


  if (view === "browse") {

    els.episodeLibrary.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } else if (view === "home") {

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  els.mobileNav.hidden =
    true;


  els.mobileMenuButton.setAttribute(
    "aria-expanded",
    "false"
  );
}


/* --------------------------------------------------
   RESET
-------------------------------------------------- */

function reset() {

  els.searchInput.value =
    "";

  els.mobileSearchInput.value =
    "";

  els.genreFilter.value =
    "ALL";

  els.seriesFilter.value =
    "ALL";

  els.seriesSort.value =
    "recommended";

  els.episodeSort.value =
    "series-episode";


  setView(
    "home"
  );


  applySeriesFilters();

  renderEpisodes();
}


/* --------------------------------------------------
   MODAL CLOSE
-------------------------------------------------- */

function closeAll() {

  [
    els.seriesModal,
    els.playerModal,
    els.historyModal
  ].forEach(
    modal =>
      setModal(
        modal,
        false
      )
  );


  els.playerFrame.src =
    "about:blank";
}


/* --------------------------------------------------
   EVENTS
-------------------------------------------------- */

function events() {

  document
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(
      button => {

        button.onclick =
          () =>
            setView(
              button.dataset.view
            );
      }
    );


  els.brandButton.onclick =
    () =>
      setView(
        "home"
      );


  els.historyButton.onclick =
    showHistory;


  els.mobileHistoryButton.onclick =
    showHistory;


  els.openHistoryButton.onclick =
    showHistory;


  els.mobileMenuButton.onclick =
    () => {

      els.mobileNav.hidden =
        !els.mobileNav.hidden;


      els.mobileMenuButton.setAttribute(
        "aria-expanded",
        String(
          !els.mobileNav.hidden
        )
      );
    };


  [
    els.searchInput,
    els.mobileSearchInput
  ].forEach(
    input => {

      input.addEventListener(
        "input",
        () => {

          els.searchInput.value =
            input.value;

          els.mobileSearchInput.value =
            input.value;


          applySeriesFilters();

          renderEpisodes();
        }
      );
    }
  );


  [
    els.genreFilter,
    els.seriesSort,
    els.seriesFilter,
    els.episodeSort
  ].forEach(
    input => {

      input.addEventListener(
        "change",
        () => {

          applySeriesFilters();

          renderEpisodes();
        }
      );
    }
  );


  els.resetButton.onclick =
    reset;


  els.retryButton.onclick =
    load;


  els.closeSeriesButton.onclick =
    () =>
      setModal(
        els.seriesModal,
        false
      );


  els.closeHistoryButton.onclick =
    closeHistory;


  els.playerBackButton.onclick =
    closePlayer;


  els.clearHistoryButton.onclick =
    () => {

      state.history = [];

      saveStorage();

      renderContinue();

      showHistory();

      toast(
        "Watch history cleared"
      );
    };


  els.seriesEpisodeSearch.addEventListener(
    "input",
    () => {

      if (
        state.currentSeries
      ) {
        renderSeriesEpisodes(
          state.currentSeries
        );
      }
    }
  );


  document
    .querySelectorAll(
      "[data-close]"
    )
    .forEach(
      button => {

        button.onclick =
          closeAll;
      }
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "/" &&
        ![
          "INPUT",
          "TEXTAREA",
          "SELECT"
        ].includes(
          document.activeElement.tagName
        )
      ) {

        event.preventDefault();

        els.searchInput.focus();
      }


      if (
        event.key === "Escape"
      ) {
        closeAll();
      }


      if (
        event.key === "ArrowLeft" &&
        !els.playerModal.classList.contains(
          "hidden"
        ) &&
        !els.playerPrevButton.disabled
      ) {
        els.playerPrevButton.click();
      }


      if (
        event.key === "ArrowRight" &&
        !els.playerModal.classList.contains(
          "hidden"
        ) &&
        !els.playerNextButton.disabled
      ) {
        els.playerNextButton.click();
      }

    }
  );
}


/* --------------------------------------------------
   START
-------------------------------------------------- */

loadStorage();

events();

load();
