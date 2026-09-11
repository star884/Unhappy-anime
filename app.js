/**
 * StreamVerse - VidMoly Media Library Frontend Architecture
 * Pure Frontend Vanilla Engine
 */

(function () {
  'use strict';

  // --- Constants & State ---
  const STORAGE_KEYS = {
    FAVORITES: 'vidmoly_favs_v1',
    HISTORY: 'vidmoly_history_v1'
  };

  const state = {
    rawVideos: [],
    enrichedVideos: [],
    filteredVideos: [],
    favorites: new Set(),
    history: [],
    filters: {
      search: '',
      series: 'ALL',
      genre: 'ALL',
      quality: 'ALL',
      sortBy: 'default'
    },
    activeTab: 'home' // 'home', 'favorites', 'history'
  };

  // --- Utility Functions ---

  function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isValidUrl(urlStr) {
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function extractVidmolyId(embedUrl) {
    if (!embedUrl) return null;
    const match = embedUrl.match(/embed-([a-zA-Z0-9]+)\.html/);
    return match ? match[1] : null;
  }

  /**
   * Generates a deterministic SVG fallback poster locally
   */
  function generateFallbackArtwork(title, series) {
    const textToShow = series || title || 'VidMoly Media';
    const cleanText = sanitizeHTML(textToShow);
    
    // Hash text to generate deterministic pleasant background colors
    let hash = 0;
    for (let i = 0; i < textToShow.length; i++) {
      hash = textToShow.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 40) % 360;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="337" viewBox="0 0 600 337">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${h1}, 60%, 20%)" />
          <stop offset="100%" stop-color="hsl(${h2}, 70%, 10%)" />
        </linearGradient>
      </defs>
      <rect width="600" height="337" fill="url(#g)" />
      <circle cx="300" cy="140" r="45" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="4" />
      <polygon points="293,125 315,140 293,155" fill="rgba(255,255,255,0.8)" />
      <text x="300" y="240" font-family="-apple-system, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${cleanText}</text>
    </svg>`;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  // --- LocalStorage Helpers ---

  function loadStorage() {
    try {
      const favsRaw = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      if (favsRaw) {
        state.favorites = new Set(JSON.parse(favsRaw));
      }
    } catch (e) {
      console.warn('Storage read failed for favorites:', e);
    }

    try {
      const histRaw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (histRaw) {
        state.history = JSON.parse(histRaw);
      }
    } catch (e) {
      console.warn('Storage read failed for history:', e);
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(Array.from(state.favorites)));
    } catch (e) {
      console.warn('Storage write failed for favorites:', e);
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
    } catch (e) {
      console.warn('Storage write failed for history:', e);
    }
  }

  // --- Catalogue Processing & Enrichment ---

  function enrichCatalogueItem(item, index) {
    if (!item || typeof item !== 'object') return null;

    // Validate embed URL
    if (!item.embed || typeof item.embed !== 'string' || !isValidUrl(item.embed)) {
      console.warn(`Item index ${index} ignored: Invalid embed URL.`);
      return null;
    }

    const vidmolyId = extractVidmolyId(item.embed);
    const fallbackId = item.id || (vidmolyId ? `vidmoly-${vidmolyId}` : `video-${index}`);

    const series = item.series || '';
    const episode = item.episode || null;
    const season = item.season || null;

    let title = item.title;
    if (!title) {
      if (series && episode !== null) {
        title = `${series} - Episode ${String(episode).padStart(3, '0')}`;
      } else if (series) {
        title = `${series} (Media)`;
      } else {
        title = `VidMoly Video ${vidmolyId || index + 1}`;
      }
    }

    const fallbackArt = generateFallbackArtwork(title, series);
    const poster = (item.poster && isValidUrl(item.poster)) ? item.poster : fallbackArt;
    const backdrop = (item.backdrop && isValidUrl(item.backdrop)) ? item.backdrop : poster;

    return {
      id: String(fallbackId),
      embed: item.embed,
      vidmolyId: vidmolyId,
      title: title,
      series: series,
      season: season,
      episode: episode,
      quality: item.quality || 'HD',
      year: item.year || null,
      genres: Array.isArray(item.genres) ? item.genres : [],
      description: item.description || 'No detailed description available for this item.',
      poster: poster,
      backdrop: backdrop
    };
  }

  async function loadCatalogue() {
    try {
      const response = await fetch('data/videos.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch videos.json`);
      }
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('videos.json content must be an array.');
      }

      state.rawVideos = data;
      processCatalogue();
    } catch (err) {
      showNotification(`Catalogue Load Warning: ${err.message}`, 'warning');
      state.rawVideos = [];
      processCatalogue();
    }
  }

  function processCatalogue() {
    const seenIds = new Set();
    const enriched = [];

    state.rawVideos.forEach((item, idx) => {
      const processed = enrichCatalogueItem(item, idx);
      if (processed) {
        if (!seenIds.has(processed.id)) {
          seenIds.add(processed.id);
          enriched.push(processed);
        } else {
          console.warn(`Duplicate video ID skipped: ${processed.id}`);
        }
      }
    });

    state.enrichedVideos = enriched;
    populateFilterDropdowns();
    applyFilters();
    renderHero();
  }

  // --- UI Rendering ---

  function showNotification(msg, type = 'warning') {
    const container = document.getElementById('notificationArea');
    const note = document.createElement('div');
    note.className = `notification notification-${type}`;
    note.textContent = msg;
    container.appendChild(note);
    setTimeout(() => note.remove(), 6000);
  }

  function updateFavBadge() {
    document.getElementById('favCount').textContent = state.favorites.size;
  }

  function populateFilterDropdowns() {
    const seriesSelect = document.getElementById('seriesFilter');
    const genreSelect = document.getElementById('genreFilter');
    const qualitySelect = document.getElementById('qualityFilter');

    const seriesSet = new Set();
    const genreSet = new Set();
    const qualitySet = new Set();

    state.enrichedVideos.forEach(v => {
      if (v.series) seriesSet.add(v.series);
      if (v.quality) qualitySet.add(v.quality);
      v.genres.forEach(g => genreSet.add(g));
    });

    seriesSelect.innerHTML = '<option value="ALL">All Series</option>';
    seriesSet.forEach(s => {
      seriesSelect.innerHTML += `<option value="${sanitizeHTML(s)}">${sanitizeHTML(s)}</option>`;
    });

    genreSelect.innerHTML = '<option value="ALL">All Genres</option>';
    genreSet.forEach(g => {
      genreSelect.innerHTML += `<option value="${sanitizeHTML(g)}">${sanitizeHTML(g)}</option>`;
    });

    qualitySelect.innerHTML = '<option value="ALL">All Qualities</option>';
    qualitySet.forEach(q => {
      qualitySelect.innerHTML += `<option value="${sanitizeHTML(q)}">${sanitizeHTML(q)}</option>`;
    });
  }

  function applyFilters() {
    let list = [...state.enrichedVideos];

    // Search Query
    if (state.filters.search.trim()) {
      const q = state.filters.search.toLowerCase().trim();
      list = list.filter(v => 
        v.title.toLowerCase().includes(q) ||
        v.series.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.quality.toLowerCase().includes(q) ||
        v.genres.some(g => g.toLowerCase().includes(q))
      );
    }

    // Series Filter
    if (state.filters.series !== 'ALL') {
      list = list.filter(v => v.series === state.filters.series);
    }

    // Genre Filter
    if (state.filters.genre !== 'ALL') {
      list = list.filter(v => v.genres.includes(state.filters.genre));
    }

    // Quality Filter
    if (state.filters.quality !== 'ALL') {
      list = list.filter(v => v.quality === state.filters.quality);
    }

    // Tab view logic (Favorites)
    if (state.activeTab === 'favorites') {
      list = list.filter(v => state.favorites.has(v.id));
    }

    // Sorting
    switch (state.filters.sortBy) {
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'episode':
        list.sort((a, b) => (a.episode || 0) - (b.episode || 0));
        break;
      case 'quality':
        list.sort((a, b) => a.quality.localeCompare(b.quality));
        break;
      default:
        // Original catalogue order preserved
        break;
    }

    state.filteredVideos = list;
    renderGrid();
  }

  function renderHero() {
    if (state.enrichedVideos.length === 0) {
      document.getElementById('heroSection').style.display = 'none';
      return;
    }
    
    document.getElementById('heroSection').style.display = 'flex';
    const featured = state.enrichedVideos[0]; // Hero picks first video in catalogue
    
    document.getElementById('heroTitle').textContent = featured.title;
    document.getElementById('heroDescription').textContent = featured.description;
    
    let metaText = [];
    if (featured.series) metaText.push(featured.series);
    if (featured.season) metaText.push(`Season ${featured.season}`);
    if (featured.episode) metaText.push(`Episode ${featured.episode}`);
    if (featured.quality) metaText.push(featured.quality);
    document.getElementById('heroMeta').textContent = metaText.join(' • ');

    const backdropEl = document.getElementById('heroBackdrop');
    backdropEl.style.backgroundImage = `url('${featured.backdrop}')`;

    document.getElementById('heroWatchBtn').onclick = () => openPlayer(featured);
    document.getElementById('heroDetailsBtn').onclick = () => openDetails(featured);
  }

  function renderGrid() {
    const grid = document.getElementById('videoGrid');
    const countBadge = document.getElementById('resultCount');
    
    grid.innerHTML = '';
    countBadge.textContent = `${state.filteredVideos.length} items`;

    if (state.filteredVideos.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>No media matches found</h3>
          <p>Try adjusting your search query or reset your selected filters.</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    state.filteredVideos.forEach(video => {
      const isFav = state.favorites.has(video.id);

      const card = document.createElement('article');
      card.className = 'card';
      
      let epTag = (video.season && video.episode) ? `S${video.season}:E${video.episode}` : (video.episode ? `EP ${video.episode}` : '');

      card.innerHTML = `
        <div class="card-media-wrapper">
          <img class="card-img" loading="lazy" src="${video.poster}" alt="${sanitizeHTML(video.title)} artwork">
          <button class="fav-btn-toggle ${isFav ? 'active' : ''}" data-id="${video.id}" aria-label="Toggle Favorite">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.78-8.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          ${video.quality ? `<span class="quality-tag">${sanitizeHTML(video.quality)}</span>` : ''}
          <div class="card-overlay-btn" data-action="play">
            <div class="play-icon-circle">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
          </div>
        </div>
        <div class="card-content">
          ${video.series ? `<span class="card-series">${sanitizeHTML(video.series)}</span>` : ''}
          <h3 class="card-title" title="${sanitizeHTML(video.title)}">${sanitizeHTML(video.title)}</h3>
          <div class="card-info">
            <span>${epTag}</span>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary" data-action="play">Watch</button>
            <button class="btn btn-secondary" data-action="details">Details</button>
          </div>
        </div>
      `;

      // Card event listeners
      card.querySelector('.fav-btn-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(video.id);
      });

      card.querySelectorAll('[data-action="play"]').forEach(btn => {
        btn.addEventListener('click', () => openPlayer(video));
      });

      card.querySelector('[data-action="details"]').addEventListener('click', () => openDetails(video));

      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
  }

  // --- Actions & Features ---

  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
    } else {
      state.favorites.add(id);
    }
    saveFavorites();
    updateFavBadge();
    applyFilters();
  }

  function recordWatchHistory(video) {
    state.history = state.history.filter(h => h.id !== video.id);
    state.history.unshift({
      id: video.id,
      title: video.title,
      timestamp: new Date().toISOString()
    });
    // Keep last 50 entries
    if (state.history.length > 50) state.history.pop();
    saveHistory();
  }

  // --- Modals & Player Logic ---

  function openPlayer(video) {
    recordWatchHistory(video);
    
    const modal = document.getElementById('playerModal');
    const container = document.getElementById('iframeContainer');
    const titleEl = document.getElementById('playerTitle');
    const loader = document.getElementById('playerLoader');

    titleEl.textContent = video.title;
    loader.style.display = 'flex';

    // Remove old frame if exists
    const existingIframe = container.querySelector('iframe');
    if (existingIframe) existingIframe.remove();

    // Create fresh lazy iframe directly referencing VidMoly embed URL
    const iframe = document.createElement('iframe');
    iframe.src = video.embed;
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;

    iframe.onload = () => {
      loader.style.display = 'none';
    };

    iframe.onerror = () => {
      loader.innerHTML = '<p class="notification-error">Failed to load VidMoly embedded player.</p>';
    };

    container.appendChild(iframe);
    modal.hidden = false;
  }

  function closePlayer() {
    const modal = document.getElementById('playerModal');
    const container = document.getElementById('iframeContainer');
    // Destroy iframe to stop video playback & conserve browser memory
    const iframe = container.querySelector('iframe');
    if (iframe) iframe.remove();
    modal.hidden = true;
  }

  function openDetails(video) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsBody');
    document.getElementById('detailsTitle').textContent = video.title;

    let genresHTML = video.genres.map(g => `<span class="tag">${sanitizeHTML(g)}</span>`).join(' ');

    body.innerHTML = `
      <div class="details-layout">
        <img class="details-poster" src="${video.poster}" alt="${sanitizeHTML(video.title)} poster">
        <div class="details-info">
          <h4>${sanitizeHTML(video.title)}</h4>
          <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:0.5rem;">
            ${video.series ? `Series: <strong>${sanitizeHTML(video.series)}</strong>` : ''} 
            ${video.season ? ` | Season ${video.season}` : ''}
            ${video.episode ? ` | Episode ${video.episode}` : ''}
          </p>
          <div class="details-meta-list">
            <span class="tag" style="background:var(--accent-color); color:#fff;">${sanitizeHTML(video.quality)}</span>
            ${video.year ? `<span class="tag">${video.year}</span>` : ''}
            ${genresHTML}
          </div>
          <p style="font-size:0.9rem; margin-bottom:1.5rem;">${sanitizeHTML(video.description)}</p>
          <button class="btn btn-primary" id="detailsWatchBtn">Watch Video Now</button>
        </div>
      </div>
    `;

    document.getElementById('detailsWatchBtn').onclick = () => {
      modal.hidden = true;
      openPlayer(video);
    };

    modal.hidden = false;
  }

  function openHistoryModal() {
    const modal = document.getElementById('historyModal');
    const listEl = document.getElementById('historyList');

    listEl.innerHTML = '';
    if (state.history.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No watch history recorded yet.</p>';
    } else {
      state.history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const dateStr = new Date(item.timestamp).toLocaleString();
        div.innerHTML = `
          <div class="history-info-text">
            <strong>${sanitizeHTML(item.title)}</strong>
            <div class="history-time">${dateStr}</div>
          </div>
        `;
        listEl.appendChild(div);
      });
    }

    modal.hidden = false;
  }

  // --- Event Listeners Setup ---

  function setupEventListeners() {
    // Search input
    document.getElementById('searchInput').addEventListener('input', (e) => {
      state.filters.search = e.target.value;
      applyFilters();
    });

    // Filters & Sorting
    document.getElementById('seriesFilter').addEventListener('change', (e) => {
      state.filters.series = e.target.value;
      applyFilters();
    });

    document.getElementById('genreFilter').addEventListener('change', (e) => {
      state.filters.genre = e.target.value;
      applyFilters();
    });

    document.getElementById('qualityFilter').addEventListener('change', (e) => {
      state.filters.quality = e.target.value;
      applyFilters();
    });

    document.getElementById('sortBy').addEventListener('change', (e) => {
      state.filters.sortBy = e.target.value;
      applyFilters();
    });

    document.getElementById('resetFiltersBtn').addEventListener('click', () => {
      state.filters.search = '';
      state.filters.series = 'ALL';
      state.filters.genre = 'ALL';
      state.filters.quality = 'ALL';
      state.filters.sortBy = 'default';

      document.getElementById('searchInput').value = '';
      document.getElementById('seriesFilter').value = 'ALL';
      document.getElementById('genreFilter').value = 'ALL';
      document.getElementById('qualityFilter').value = 'ALL';
      document.getElementById('sortBy').value = 'default';

      state.activeTab = 'home';
      document.getElementById('navHomeBtn').classList.add('active');
      document.getElementById('navFavsBtn').classList.remove('active');
      document.getElementById('sectionTitle').textContent = 'Library Catalogue';

      applyFilters();
    });

    // Nav Tabs
    document.getElementById('logoLink').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('resetFiltersBtn').click();
    });

    document.getElementById('navHomeBtn').addEventListener('click', () => {
      state.activeTab = 'home';
      document.getElementById('navHomeBtn').classList.add('active');
      document.getElementById('navFavsBtn').classList.remove('active');
      document.getElementById('sectionTitle').textContent = 'Library Catalogue';
      applyFilters();
    });

    document.getElementById('navFavsBtn').addEventListener('click', () => {
      state.activeTab = 'favorites';
      document.getElementById('navFavsBtn').classList.add('active');
      document.getElementById('navHomeBtn').classList.remove('active');
      document.getElementById('sectionTitle').textContent = 'Your Favorites';
      applyFilters();
    });

    document.getElementById('navHistoryBtn').addEventListener('click', openHistoryModal);

    // Modal Close Triggers
    document.getElementById('closePlayerBtn').onclick = closePlayer;
    document.getElementById('playerOverlay').onclick = closePlayer;

    document.getElementById('closeDetailsBtn').onclick = () => { document.getElementById('detailsModal').hidden = true; };
    document.getElementById('detailsOverlay').onclick = () => { document.getElementById('detailsModal').hidden = true; };

    document.getElementById('closeHistoryBtn').onclick = () => { document.getElementById('historyModal').hidden = true; };
    document.getElementById('historyOverlay').onclick = () => { document.getElementById('historyModal').hidden = true; };

    document.getElementById('clearHistoryBtn').onclick = () => {
      state.history = [];
      saveHistory();
      openHistoryModal();
    };

    // Keyboard navigation (Escape key modal close)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePlayer();
        document.getElementById('detailsModal').hidden = true;
        document.getElementById('historyModal').hidden = true;
      }
    });
  }

  // --- Initialization ---

  function init() {
    loadStorage();
    updateFavBadge();
    setupEventListeners();
    document.getElementById('navHomeBtn').classList.add('active');
    loadCatalogue();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
