'use strict';

class GAXIPTV {
    constructor() {
        // DOM Elements
        this.video          = document.getElementById('liveVideo');
        this.posterImage    = document.getElementById('posterImage');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.errorMessage   = document.getElementById('errorMessage');
        this.errorText      = document.getElementById('errorText');
        this.muteBtn        = document.getElementById('muteBtn');
        this.playPauseBtn   = document.getElementById('playPauseBtn');
        this.volumeSlider   = document.getElementById('volumeSlider');
        this.qualityMenu    = document.getElementById('qualityMenu');

        // State
        this.hls                  = null;
        this.zoomIndex            = 0;
        this.zoomModes            = ['fill', 'cover', 'contain'];
        this.currentChannel       = null;
        this.currentChannelUrl    = null;
        this.channels             = [];
        this.favorites            = this._load('favorites', []);
        this.playlists            = this._load('playlists', []);
        this.recentlyPlayed       = this._load('recentlyPlayed', []);
        this.sleepTimer           = null;
        this.sleepTimerEnd        = null;
        this.categories           = new Set();
        this.currentCategory      = 'all';
        this.searchQuery          = '';
        this.isScanning           = false;
        this.workingChannels      = [];
        this.newPlaylistChannels  = [];
        this.volTimeout           = null;
        this.statsInterval        = null;
        this.controlsTimeout      = null;

        this.builtinPlaylistUrl = 'playlist.m3u';
        this.init();
    }

    _load(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (e) { return fallback; }
    }

    _save(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch (e) { console.warn('Storage error:', e); }
    }

    async init() {
        await this.loadM3UPlaylist();
        this.initPlayer();
        this.setupEventListeners();
        this.renderCategories();
        this.renderRecentlyPlayed();
        this.renderChannels();
        this.updateCounts();
        this.loadPlaylists();

        if (this.channels.length > 0) this.loadChannel(this.channels[0]);

        setInterval(() => this.updateTimerStatus(), 1000);
        setInterval(() => this.updateClock(), 1000);

        setTimeout(() => {
            const splash = document.getElementById('splashScreen');
            if (splash) {
                splash.style.opacity = '0';
                setTimeout(() => { splash.style.display = 'none'; }, 800);
            }
        }, 2000);
    }

    /* ============ M3U LOADING ============ */

    async loadM3UPlaylist() {
        try {
            const res = await fetch(this.builtinPlaylistUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            this.channels = this.parseM3U(text);
            this.extractCategories();
            document.getElementById('builtinCount').textContent = `${this.channels.length} channels`;
        } catch (err) {
            console.error('Playlist load failed:', err);
            this.channels = [];
            this.categories = new Set();
            document.getElementById('builtinCount').textContent = '0 channels';
            if (!localStorage.getItem('playlistLoadAttempted')) {
                this.showNotification('No playlist found. Use "New" tab to add channels.', 'info');
                localStorage.setItem('playlistLoadAttempted', 'true');
            }
        }
    }

    parseM3U(content) {
        const lines = content.split('\n');
        const channels = [];
        let cur = null;

        for (const raw of lines) {
            const line = raw.trim();
            if (line.startsWith('#EXTINF:')) {
                const nameM = line.match(/,(.+)$/);
                const logoM = line.match(/tvg-logo="([^"]+)"/);
                const groupM = line.match(/group-title="([^"]+)"/);
                const idM = line.match(/tvg-id="([^"]+)"/);
                const langM = line.match(/tvg-language="([^"]+)"/);
                const qualM = line.match(/tvg-resolution="([^"]+)"/);
                cur = {
                    name:     nameM ? nameM[1].trim() : 'Unknown',
                    logo:     logoM ? logoM[1] : null,
                    group:    groupM ? groupM[1] : 'General',
                    id:       idM ? idM[1] : Math.random().toString(36).substring(2, 10),
                    language: langM ? langM[1] : null,
                    quality:  qualM ? qualM[1] : null,
                    url:      ''
                };
            } else if (line && !line.startsWith('#') && cur) {
                cur.url = line;
                if (!cur.logo) cur.logo = `https://picsum.photos/seed/${cur.id}/200/200.jpg`;
                channels.push(cur);
                cur = null;
            }
        }
        return channels;
    }

    extractCategories() {
        this.categories.clear();
        for (const ch of this.channels) {
            if (ch.group) this.categories.add(ch.group);
        }
    }

    getCategoryIcon(name) {
        const n = name.toLowerCase();
        if (n.includes('movie') || n.includes('film')) return 'fa-film';
        if (n.includes('sport'))   return 'fa-football-ball';
        if (n.includes('news'))    return 'fa-newspaper';
        if (n.includes('music'))   return 'fa-music';
        if (n.includes('kids') || n.includes('children')) return 'fa-child';
        if (n.includes('documentary')) return 'fa-globe';
        if (n.includes('entertainment')) return 'fa-theater-masks';
        if (n.includes('religi'))  return 'fa-mosque';
        if (n.includes('adult'))   return 'fa-user-secret';
        if (n.includes('nature'))  return 'fa-leaf';
        return 'fa-tv';
    }

    /* ============ PLAYER ============ */

    initPlayer() {
        // Start muted for autoplay policy
        this.video.volume = 0;
        this.video.muted  = true;
        this.volumeSlider.value = 0;

        this.video.addEventListener('play', () => {
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            if (this.posterImage) this.posterImage.style.display = 'none';
        });

        this.video.addEventListener('pause', () => {
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        });

        this.video.addEventListener('waiting', () => {
            this.loadingOverlay.style.display = 'flex';
        });

        this.video.addEventListener('playing', () => {
            this.loadingOverlay.style.display = 'none';
            this.errorMessage.style.display = 'none';
            this.startStatsUpdate();
        });

        this.video.addEventListener('error', () => {
            this.loadingOverlay.style.display = 'none';
        });

        this.muteBtn.addEventListener('click', () => {
            if (this.video.muted || this.video.volume === 0) {
                this.video.volume = 1.0;
                this.video.muted  = false;
                this.volumeSlider.value = 1.0;
                this._save('userUnmuted', true);
            } else {
                this.toggleMute();
            }
            this.updateMuteButton();
            this.showVolumeIndicator(this.video.volume);
        });

        this.volumeSlider.addEventListener('input', () => {
            const v = parseFloat(this.volumeSlider.value);
            this.video.volume = v;
            this.video.muted  = (v === 0);
            this.updateMuteButton();
            this.showVolumeIndicator(v);
        });

        this.qualityMenu.addEventListener('change', () => {
            if (!this.hls) return;
            const v = this.qualityMenu.value;
            this.hls.currentLevel = (v === '-1' || v === 'auto') ? -1 : parseInt(v);
        });

        // Touch controls: tap to show/hide on mobile
        const vc = document.getElementById('videoContainer');
        if (vc) {
            vc.addEventListener('touchstart', () => {
                vc.classList.add('touch-active');
                clearTimeout(this.controlsTimeout);
                this.controlsTimeout = setTimeout(() => vc.classList.remove('touch-active'), 3000);
            }, { passive: true });
        }
    }

    loadSource(url) {
        if (!url) return;
        this.cleanupPlayer();
        this.loadingOverlay.style.display = 'flex';
        this.errorMessage.style.display   = 'none';
        this.currentChannelUrl = url;

        if (Hls.isSupported()) {
            this.hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90,
                maxBufferLength: 30,
            });
            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);

            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.populateQualityMenu();
                this.video.play().catch(e => {
                    console.warn('Autoplay blocked:', e);
                    this.loadingOverlay.style.display = 'none';
                });
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            this.hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            this.hls.recoverMediaError();
                            break;
                        default:
                            this.showError('Stream error: ' + data.details);
                            this.cleanupPlayer();
                    }
                }
            });
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari/iOS)
            this.video.src = url;
            this.video.addEventListener('loadedmetadata', () => {
                this.video.play().catch(e => console.warn(e));
            });
        } else {
            this.showError('HLS not supported on this browser');
        }
    }

    retryStream() {
        if (this.currentChannelUrl) this.loadSource(this.currentChannelUrl);
    }

    cleanupPlayer() {
        if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        this.video.src = '';
        this.video.load();
    }

    populateQualityMenu() {
        if (!this.hls || !this.hls.levels || this.hls.levels.length <= 1) {
            this.qualityMenu.style.display = 'none';
            return;
        }
        this.qualityMenu.innerHTML = '<option value="-1">Auto</option>';
        this.hls.levels.forEach((lvl, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = lvl.height ? `${lvl.height}p` : `Level ${i}`;
            this.qualityMenu.appendChild(opt);
        });
        this.qualityMenu.style.display = 'block';
    }

    startStatsUpdate() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(() => {
            if (!this.video || this.video.paused) return;
            const rEl = document.getElementById('statRes');
            const bEl = document.getElementById('statBitrate');
            const buEl = document.getElementById('statBuffer');
            if (rEl) rEl.textContent = `${this.video.videoWidth}x${this.video.videoHeight}`;
            if (buEl && this.video.buffered.length > 0) {
                const dur = this.video.buffered.end(this.video.buffered.length - 1) - this.video.currentTime;
                buEl.textContent = dur.toFixed(1);
            }
            if (bEl && this.hls && this.hls.levels[this.hls.currentLevel]) {
                bEl.textContent = (this.hls.levels[this.hls.currentLevel].bitrate / 1e6).toFixed(2);
            }
        }, 2000);
    }

    showVolumeIndicator(vol) {
        const el = document.getElementById('volumeIndicator');
        if (!el) return;
        const icon = el.querySelector('i');
        if (vol === 0) icon.className = 'fas fa-volume-mute';
        else if (vol < 0.5) icon.className = 'fas fa-volume-down';
        else icon.className = 'fas fa-volume-up';
        el.style.opacity = '1';
        if (this.volTimeout) clearTimeout(this.volTimeout);
        this.volTimeout = setTimeout(() => { el.style.opacity = '0'; }, 1200);
    }

    togglePlayPause() {
        if (!this.currentChannelUrl) return;
        if (this.video.paused) this.video.play().catch(e => console.warn(e));
        else this.video.pause();
    }

    toggleMute() {
        if (this.video.volume > 0 && !this.video.muted) {
            this.video.muted  = true;
            this.video.volume = 0;
            this.volumeSlider.value = 0;
        } else {
            this.video.muted  = false;
            this.video.volume = 1.0;
            this.volumeSlider.value = 1.0;
        }
        this.updateMuteButton();
    }

    updateMuteButton() {
        const muted = this.video.muted || this.video.volume === 0;
        this.muteBtn.innerHTML = muted
            ? '<i class="fas fa-volume-mute"></i>'
            : '<i class="fas fa-volume-up"></i>';
    }

    cycleZoom() {
        this.zoomIndex = (this.zoomIndex + 1) % this.zoomModes.length;
        this.video.style.objectFit = this.zoomModes[this.zoomIndex];
    }

    toggleFullscreen() {
        const el = document.getElementById('videoContainer');
        if (!document.fullscreenElement) {
            (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen).call(el)
                .catch(e => console.warn(e));
        } else {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
    }

    togglePiP() {
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && !this.video.disablePictureInPicture) {
            this.video.requestPictureInPicture().catch(e => console.warn(e));
        }
    }

    showError(msg) {
        this.loadingOverlay.style.display = 'none';
        this.errorText.textContent = msg;
        this.errorMessage.style.display = 'block';
    }

    /* ============ CHANNELS ============ */

    loadChannel(channel) {
        if (!channel || !channel.url) return;
        this.currentChannel = channel;
        this.updateChannelInfo(channel);
        this.loadSource(channel.url);
        this.updateActiveChannelCard(channel.id);
        this.addToRecentlyPlayed(channel);
        const pc = document.querySelector('.player-container');
        if (pc) pc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    updateChannelInfo(channel) {
        const nameEl = document.getElementById('currentChannelName');
        const logoEl = document.getElementById('currentChannelLogo');
        const qualEl = document.getElementById('currentChannelQuality');
        const langEl = document.getElementById('currentChannelLanguage');
        const grpEl  = document.getElementById('currentChannelGroup');

        if (nameEl) nameEl.textContent = channel.name;
        if (logoEl) { logoEl.src = channel.logo || ''; logoEl.onerror = () => { logoEl.src = 'https://picsum.photos/seed/err/60/60.jpg'; }; }
        if (qualEl) qualEl.innerHTML = `<i class="fas fa-signal"></i> ${channel.quality || 'Auto'}`;

        if (langEl) {
            if (channel.language) { langEl.style.display = ''; langEl.innerHTML = `<i class="fas fa-globe"></i> ${channel.language}`; }
            else langEl.style.display = 'none';
        }
        if (grpEl) {
            if (channel.group) { grpEl.style.display = ''; grpEl.innerHTML = `<i class="fas fa-tag"></i> ${channel.group}`; }
            else grpEl.style.display = 'none';
        }
    }

    updateActiveChannelCard(id) {
        document.querySelectorAll('.channel-card').forEach(c => {
            c.classList.toggle('active', c.dataset.channelId === id);
        });
    }

    toggleFavorite(id) {
        const idx = this.favorites.indexOf(id);
        if (idx > -1) this.favorites.splice(idx, 1);
        else this.favorites.push(id);
        this._save('favorites', this.favorites);
        this.renderChannels();
        this.renderCategories();
    }

    /* ============ RENDER ============ */

    renderCategories() {
        const tabs = document.getElementById('categoryTabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        tabs.appendChild(this.createCategoryTab('all', 'All', 'fa-globe', this.channels.length));

        const favCount = this.channels.filter(c => this.favorites.includes(c.id)).length;
        if (favCount > 0) tabs.appendChild(this.createCategoryTab('favorites', 'Favorites', 'fa-heart', favCount));

        this.categories.forEach(cat => {
            const cnt = this.channels.filter(c => c.group === cat).length;
            if (cnt > 0) tabs.appendChild(this.createCategoryTab(cat, cat, this.getCategoryIcon(cat), cnt));
        });
    }

    createCategoryTab(category, name, icon, count) {
        const tab = document.createElement('div');
        tab.className = `category-tab ${this.currentCategory === category ? 'active' : ''}`;
        tab.dataset.category = category;
        tab.innerHTML = `<i class="fas ${icon}"></i> ${name} <span class="category-count">${count}</span>`;
        tab.addEventListener('click', () => this.setActiveCategory(category));
        return tab;
    }

    setActiveCategory(cat) {
        this.currentCategory = cat;
        document.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t.dataset.category === cat));
        this.renderChannels();
    }

    renderChannels() {
        const grid = document.getElementById('channelsGrid');
        if (!grid) return;
        grid.innerHTML = '';

        let list = [...this.channels];
        if (this.currentCategory === 'favorites') list = list.filter(c => this.favorites.includes(c.id));
        else if (this.currentCategory !== 'all') list = list.filter(c => c.group === this.currentCategory);

        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            list = list.filter(c => c.name.toLowerCase().includes(q));
        }

        list.sort((a, b) => a.name.localeCompare(b.name));

        if (list.length === 0) {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-tv"></i><h3>No channels found</h3></div>';
            return;
        }

        const frag = document.createDocumentFragment();
        list.forEach(ch => frag.appendChild(this.createChannelCard(ch)));
        grid.appendChild(frag);
    }

    createChannelCard(channel) {
        const card = document.createElement('div');
        card.className = `channel-card ${this.currentChannel?.id === channel.id ? 'active' : ''}`;
        card.dataset.channelId = channel.id;
        const isFav = this.favorites.includes(channel.id);

        card.innerHTML = `
            <div class="channel-card-logo-container">
                <img data-src="${channel.logo}" alt="${channel.name}" class="channel-card-logo lazy-load"
                     onerror="this.src='https://picsum.photos/seed/${channel.id}/60/60.jpg'">
            </div>
            <div class="channel-card-name">${channel.name}</div>
            <button class="favorite-btn ${isFav ? 'active' : ''}" aria-label="Favorite">
                <i class="fas fa-heart"></i>
            </button>
        `;

        card.addEventListener('click', e => {
            if (!e.target.closest('.favorite-btn')) this.loadChannel(channel);
        });

        card.querySelector('.favorite-btn').addEventListener('click', e => {
            e.stopPropagation();
            this.toggleFavorite(channel.id);
        });

        this.setupLazyLoad(card.querySelector('.lazy-load'));
        return card;
    }

    setupLazyLoad(img) {
        if (!img) return;
        const obs = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    e.target.src = e.target.dataset.src;
                    e.target.classList.add('loaded');
                    obs.unobserve(e.target);
                }
            });
        }, { rootMargin: '100px' });
        obs.observe(img);
    }

    /* ============ PLAYLISTS ============ */

    loadPlaylists() {
        const list = document.getElementById('playlistsList');
        if (!list) return;
        list.innerHTML = '';

        if (this.playlists.length === 0) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><h3>No playlists yet</h3><p>Create one in the New tab</p></div>';
            return;
        }

        this.playlists.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'playlist-item glass-card';
            item.style.margin = '0 0 12px 0';
            item.innerHTML = `
                <div class="playlist-info">
                    <div class="playlist-name"><i class="fas fa-list" style="color:var(--accent-glow);margin-right:8px;"></i>${p.name}</div>
                    <div class="playlist-meta">Custom Playlist • ${(p.content.match(/#EXTINF/g) || []).length} channels</div>
                </div>
                <div class="playlist-actions">
                    <button class="btn btn-secondary" title="Delete"><i class="fas fa-trash"></i></button>
                    <button class="btn btn-primary" title="Load"><i class="fas fa-play"></i></button>
                </div>
            `;
            item.querySelectorAll('.btn')[0].addEventListener('click', () => this.deletePlaylist(i));
            item.querySelectorAll('.btn')[1].addEventListener('click', () => this.loadPlaylist(i));
            list.appendChild(item);
        });
    }

    deletePlaylist(i) {
        if (!confirm('Delete this playlist?')) return;
        this.playlists.splice(i, 1);
        this._save('playlists', this.playlists);
        this.loadPlaylists();
        this.showNotification('Playlist deleted', 'info');
    }

    loadPlaylist(i) {
        const p = this.playlists[i];
        if (!p) return;
        this.channels = this.parseM3U(p.content);
        this.extractCategories();
        this.renderCategories();
        this.renderChannels();
        this.updateCounts();
        this.switchPage('homePage');
        if (this.channels.length > 0) this.loadChannel(this.channels[0]);
        this.showNotification(`Loaded: ${p.name}`, 'success');
    }

    saveNewPlaylist() {
        if (this.newPlaylistChannels.length === 0) return;
        const name = document.getElementById('newPlaylistName').value.trim() || 'Custom Playlist';
        let m3u = '#EXTM3U\n';
        this.newPlaylistChannels.forEach(c => {
            m3u += `#EXTINF:-1 tvg-logo="${c.logo}" group-title="${c.group}",${c.name}\n${c.url}\n`;
        });
        this.playlists.push({ name, content: m3u });
        this._save('playlists', this.playlists);
        this.resetPlaylistCreator();
        this.loadPlaylists();
        this.switchPage('playlistsPage');
        this.showNotification(`"${name}" saved!`, 'success');
    }

    addChannelToPlaylist() {
        const nameInp = document.getElementById('newChannelName');
        const urlInp  = document.getElementById('newChannelUrl');
        const logoInp = document.getElementById('newChannelLogo');
        const grpInp  = document.getElementById('newChannelGroupInput');

        const name = nameInp ? nameInp.value.trim() : '';
        const url  = urlInp  ? urlInp.value.trim()  : '';

        if (!name || !url) {
            this.showNotification('Name and URL are required', 'error');
            return;
        }

        const logo  = (logoInp && logoInp.value.trim()) ? logoInp.value.trim() : `https://picsum.photos/seed/${Date.now()}/200/200.jpg`;
        const group = (grpInp && grpInp.value.trim())   ? grpInp.value.trim()  : 'General';

        this.newPlaylistChannels.push({ name, url, logo, group, id: Math.random().toString(36).substring(2, 11) });
        if (nameInp) nameInp.value = '';
        if (urlInp)  urlInp.value  = '';
        this.renderNewPlaylistPreview();
        this.showNotification(`"${name}" added to draft`, 'success');
    }

    renderNewPlaylistPreview() {
        const listEl   = document.getElementById('newPlaylistChannelsList');
        const emptyEl  = document.getElementById('emptyChannelList');
        const countEl  = document.getElementById('channelCount');
        const saveBtn  = document.getElementById('saveNewPlaylistBtn');

        const count = this.newPlaylistChannels.length;
        if (emptyEl)  emptyEl.style.display  = count ? 'none'    : 'block';
        if (saveBtn)  saveBtn.disabled         = !count;
        if (countEl)  countEl.textContent      = count;
        if (!listEl)  return;

        listEl.innerHTML = '';
        this.newPlaylistChannels.forEach((c, i) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.style.marginBottom = '8px';
            item.innerHTML = `
                <div class="playlist-info"><div class="playlist-name">${c.name}</div><div class="playlist-meta">${c.group}</div></div>
                <button class="btn btn-secondary"><i class="fas fa-times"></i></button>
            `;
            item.querySelector('.btn').addEventListener('click', () => this.removeChannelFromPreview(i));
            listEl.appendChild(item);
        });
    }

    removeChannelFromPreview(i) {
        this.newPlaylistChannels.splice(i, 1);
        this.renderNewPlaylistPreview();
    }

    resetPlaylistCreator() {
        this.newPlaylistChannels = [];
        const el = document.getElementById('newPlaylistName');
        if (el) el.value = '';
        this.renderNewPlaylistPreview();
    }

    /* ============ RECENTLY PLAYED ============ */

    addToRecentlyPlayed(channel) {
        this.recentlyPlayed = this.recentlyPlayed.filter(c => c.id !== channel.id);
        this.recentlyPlayed.unshift(channel);
        if (this.recentlyPlayed.length > 10) this.recentlyPlayed.pop();
        this._save('recentlyPlayed', this.recentlyPlayed);
        this.renderRecentlyPlayed();
    }

    renderRecentlyPlayed() {
        const grid = document.getElementById('recentlyPlayedGrid');
        const sec  = document.getElementById('recentlyPlayedSection');
        if (!grid || !sec) return;
        if (!this.recentlyPlayed.length) { sec.style.display = 'none'; return; }
        sec.style.display = 'block';
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        this.recentlyPlayed.forEach(c => frag.appendChild(this.createChannelCard(c)));
        grid.appendChild(frag);
    }

    clearRecentlyPlayed() {
        this.recentlyPlayed = [];
        this._save('recentlyPlayed', []);
        this.renderRecentlyPlayed();
    }

    /* ============ SLEEP TIMER ============ */

    setSleepTimer(mins) {
        this.clearSleepTimer();
        this.sleepTimerEnd = Date.now() + mins * 60000;
        this.sleepTimer = setTimeout(() => {
            this.video.pause();
            this.showNotification('Sleep timer: stream paused', 'info');
            this.clearSleepTimer();
        }, mins * 60000);
        const cancelBtn = document.getElementById('cancelTimerBtn');
        if (cancelBtn) cancelBtn.style.display = 'block';
        this.hideDialog('sleepTimerModal');
        this.showNotification(`Sleep timer: ${mins} min`, 'success');
    }

    clearSleepTimer() {
        if (this.sleepTimer) clearTimeout(this.sleepTimer);
        this.sleepTimer    = null;
        this.sleepTimerEnd = null;
        const cancelBtn = document.getElementById('cancelTimerBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const statusEl = document.getElementById('timerStatus');
        if (statusEl) statusEl.textContent = 'Set auto-pause timer';
    }

    updateTimerStatus() {
        if (!this.sleepTimerEnd) return;
        const rem = Math.ceil((this.sleepTimerEnd - Date.now()) / 60000);
        const statusEl = document.getElementById('timerStatus');
        if (statusEl) statusEl.textContent = rem > 0 ? `Pausing in ${rem} min` : 'Pausing...';
        if (rem <= 0) this.clearSleepTimer();
    }

    /* ============ SCANNER ============ */

    async startScan() {
        if (this.channels.length === 0) { this.showNotification('No channels to scan', 'error'); return; }

        this.isScanning    = true;
        this.workingChannels = [];
        const results  = document.getElementById('scanResults');
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn  = document.getElementById('stopScanBtn');
        const loadBtn  = document.getElementById('loadWorkingBtn');
        const countEl  = document.getElementById('scanCount');
        const subEl    = document.getElementById('scanSubStatus');
        const progEl   = document.getElementById('scanProgress');

        if (results)  results.innerHTML = '';
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn)  stopBtn.style.display  = 'flex';
        if (loadBtn)  loadBtn.style.display  = 'none';

        for (let i = 0; i < this.channels.length; i++) {
            if (!this.isScanning) break;
            const ch = this.channels[i];
            const pct = Math.round(((i + 1) / this.channels.length) * 100);

            if (countEl) countEl.textContent = `SCANNING ${i + 1}/${this.channels.length}`;
            if (subEl)   subEl.textContent   = ch.name.toUpperCase();
            if (progEl)  progEl.style.width  = `${pct}%`;

            const row = document.createElement('div');
            row.style.cssText = 'padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.75rem;display:flex;justify-content:space-between;gap:10px;';
            row.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ch.name}</span><span class="scan-status" style="flex-shrink:0;color:var(--text-dim);">CHECKING...</span>`;
            if (results) results.prepend(row);

            const ok = await this.checkStreamWorking(ch.url);
            const statusSpan = row.querySelector('.scan-status');
            if (ok) {
                this.workingChannels.push(ch);
                if (statusSpan) { statusSpan.textContent = '✓ ONLINE'; statusSpan.style.color = 'var(--accent-neon)'; }
            } else {
                if (statusSpan) { statusSpan.textContent = '✗ OFFLINE'; statusSpan.style.color = 'var(--accent-secondary)'; }
            }
        }

        this.isScanning = false;
        if (startBtn) startBtn.style.display = 'flex';
        if (stopBtn)  stopBtn.style.display  = 'none';
        if (countEl)  countEl.textContent    = 'SCAN COMPLETE';
        if (subEl)    subEl.textContent      = `${this.workingChannels.length} STREAMS ONLINE`;
        if (loadBtn && this.workingChannels.length > 0) loadBtn.style.display = 'flex';
    }

    async checkStreamWorking(url) {
        return new Promise(resolve => {
            const v = document.createElement('video');
            v.muted = true;
            const t = setTimeout(() => { v.src = ''; resolve(false); }, 5000);
            v.oncanplay = () => { clearTimeout(t); v.src = ''; resolve(true); };
            v.onerror   = () => { clearTimeout(t); v.src = ''; resolve(false); };
            v.src = url;
            v.load();
        });
    }

    loadWorkingChannels() {
        this.channels = [...this.workingChannels];
        this.extractCategories();
        this.renderCategories();
        this.renderChannels();
        this.updateCounts();
        this.hideDialog('scannerModal');
        this.showNotification(`Loaded ${this.channels.length} working streams`, 'success');
        if (this.channels.length > 0) this.loadChannel(this.channels[0]);
    }

    /* ============ UI ============ */

    setupEventListeners() {
        // Keyboard shortcuts (desktop)
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.code) {
                case 'Space':   e.preventDefault(); this.togglePlayPause(); break;
                case 'KeyM':    this.toggleMute(); break;
                case 'KeyF':    this.toggleFullscreen(); break;
                case 'KeyP':    this.togglePiP(); break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.video.volume = Math.min(1, this.video.volume + 0.1);
                    this.volumeSlider.value = this.video.volume;
                    this.video.muted = false;
                    this.updateMuteButton();
                    this.showVolumeIndicator(this.video.volume);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.video.volume = Math.max(0, this.video.volume - 0.1);
                    this.volumeSlider.value = this.video.volume;
                    if (this.video.volume === 0) this.video.muted = true;
                    this.updateMuteButton();
                    this.showVolumeIndicator(this.video.volume);
                    break;
            }
        });

        // Bottom nav
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => this.switchPage(item.dataset.page));
        });

        // Search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            let searchDebounce;
            searchInput.addEventListener('input', e => {
                clearTimeout(searchDebounce);
                searchDebounce = setTimeout(() => {
                    this.searchQuery = e.target.value;
                    this.renderChannels();
                }, 200);
            });
        }

        // Load builtin
        const loadBuiltinBtn = document.getElementById('loadBuiltinBtn');
        if (loadBuiltinBtn) {
            loadBuiltinBtn.addEventListener('click', async () => {
                loadBuiltinBtn.disabled = true;
                loadBuiltinBtn.textContent = 'Loading...';
                await this.loadM3UPlaylist();
                this.renderCategories();
                this.renderChannels();
                this.switchPage('homePage');
                loadBuiltinBtn.disabled = false;
                loadBuiltinBtn.textContent = 'LOAD';
            });
        }

        // Sleep timer
        const sleepBtn = document.getElementById('sleepTimerBtn');
        if (sleepBtn) sleepBtn.addEventListener('click', () => this.showDialog('sleepTimerModal'));

        // Add playlist (new)
        const addPL = document.getElementById('addPlaylist');
        if (addPL) addPL.addEventListener('click', () => this.switchPage('createM3UPage'));

        // Add channel to draft
        const addChBtn = document.getElementById('addChannelToListBtn');
        if (addChBtn) addChBtn.addEventListener('click', () => this.addChannelToPlaylist());

        // Save playlist
        const savePLBtn = document.getElementById('saveNewPlaylistBtn');
        if (savePLBtn) savePLBtn.addEventListener('click', () => this.saveNewPlaylist());

        // About
        const aboutItem = document.getElementById('aboutItem');
        if (aboutItem) aboutItem.addEventListener('click', () => this.showDialog('aboutDialog'));

        const subscribeBtn = document.getElementById('subscribeBtn');
        if (subscribeBtn) subscribeBtn.addEventListener('click', () => window.open('https://youtube.com/@GamerArnabXYZ', '_blank'));

        // Favorites shortcut (Hub)
        const favItem = document.getElementById('favoritesItem');
        if (favItem) {
            favItem.addEventListener('click', () => {
                this.switchPage('homePage');
                this.setActiveCategory('favorites');
            });
        }

        // Scanner
        const startScanBtn = document.getElementById('startScanBtn');
        if (startScanBtn) startScanBtn.addEventListener('click', () => this.startScan());

        const stopScanBtn = document.getElementById('stopScanBtn');
        if (stopScanBtn) stopScanBtn.addEventListener('click', () => { this.isScanning = false; });

        const loadWorkingBtn = document.getElementById('loadWorkingBtn');
        if (loadWorkingBtn) loadWorkingBtn.addEventListener('click', () => this.loadWorkingChannels());

        // Close modals on backdrop click
        document.querySelectorAll('.modal').forEach(m => {
            m.addEventListener('click', e => {
                if (e.target === m) this.hideDialog(m.id);
            });
        });
    }

    switchPage(id) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === id));
        document.querySelectorAll('.page-section').forEach(s => s.classList.toggle('active', s.id === id));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    showDialog(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    hideDialog(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    }

    showNotification(msg, type = 'info') {
        // Remove old notifications
        document.querySelectorAll('.notification').forEach(n => n.remove());
        const n = document.createElement('div');
        n.className = `notification ${type}`;
        n.textContent = msg;
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3000);
    }

    updateCounts() {
        const el = document.getElementById('builtinCount');
        if (el) el.textContent = `${this.channels.length} channels`;
    }

    updateClock() {
        const el = document.getElementById('headerClock');
        if (!el) return;
        el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new GAXIPTV();
});
