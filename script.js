'use strict';

/**
 * GAXIPTV Professional IPTV Application
 * @class GAXIPTV
 */
class GAXIPTV {
    constructor() {
        // DOM Elements
        this.video = document.getElementById("liveVideo");
        this.posterImage = document.getElementById("posterImage");
        this.loadingOverlay = document.getElementById("loadingOverlay");
        this.errorMessage = document.getElementById("errorMessage");
        this.errorText = document.getElementById("errorText");

        // Player Controls
        this.muteBtn = document.getElementById("muteBtn");
        this.playPauseBtn = document.getElementById("playPauseBtn");
        this.volumeSlider = document.getElementById("volumeSlider");
        this.qualityMenu = document.getElementById("qualityMenu");

        // App State
        this.hls = null;
        this.zoomIndex = 0;
        this.zoomModes = ["fill", "cover", "contain"];
        this.currentChannel = null;
        this.channels = [];
        this.favorites = JSON.parse(localStorage.getItem('favorites')) || [];
        this.playlists = JSON.parse(localStorage.getItem('playlists')) || [];
        this.recentlyPlayed = JSON.parse(localStorage.getItem('recentlyPlayed')) || [];
        this.sleepTimer = null;
        this.sleepTimerEnd = null;
        this.categories = new Set();
        this.currentCategory = 'all';
        this.searchQuery = '';
        this.isScanning = false;
        this.workingChannels = [];
        this.newPlaylistChannels = []; 
        this.editingPlaylistIndex = -1; 
        this.scanningPlaylistIndex = -1; 

        // External playlist file
        this.builtinPlaylistUrl = 'playlist.m3u';

        this.init();
    }

    /**
     * Initialize the application
     */
    async init() {
        await this.loadM3UPlaylist();
        this.initPlayer();
        this.setupEventListeners();
        this.renderCategories();
        this.renderRecentlyPlayed();
        this.renderChannels();
        this.updateCounts();
        this.loadPlaylists();

        // Auto-play first channel if available
        if (this.channels.length > 0) {
            this.loadChannel(this.channels[0]);
        }
        
        // Timer update interval
        setInterval(() => this.updateTimerStatus(), 1000);
        setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
        const clockEl = document.getElementById('headerClock');
        if (!clockEl) return;
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    /**
     * M3U Playlist Handling
     */
    async loadM3UPlaylist() {
        try {
            const response = await fetch(this.builtinPlaylistUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const m3uContent = await response.text();
            this.channels = this.parseM3U(m3uContent);
            this.extractCategories();
            document.getElementById('builtinCount').textContent = `${this.channels.length} channels`;
        } catch (error) {
            console.error('Failed to load built-in playlist:', error);
            this.channels = [];
            this.categories = new Set();
            document.getElementById('builtinCount').textContent = '0 channels';

            if (!localStorage.getItem('playlistLoadAttempted')) {
                this.showNotification('No playlist found. Add channels using Create M3U tab.', 'info');
                localStorage.setItem('playlistLoadAttempted', 'true');
            }
        }
    }

    parseM3U(content) {
        const lines = content.split('\n');
        const channels = [];
        let currentChannel = null;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('#EXTINF:')) {
                const nameMatch = trimmedLine.match(/,(.+)$/);
                const logoMatch = trimmedLine.match(/tvg-logo="([^"]+)"/);
                const groupMatch = trimmedLine.match(/group-title="([^"]+)"/);
                const idMatch = trimmedLine.match(/tvg-id="([^"]+)"/);
                const langMatch = trimmedLine.match(/tvg-language="([^"]+)"/);
                const qualMatch = trimmedLine.match(/tvg-resolution="([^"]+)"/);

                currentChannel = {
                    name: nameMatch ? nameMatch[1] : 'Unknown',
                    logo: logoMatch ? logoMatch[1] : `https://picsum.photos/seed/${Math.random().toString(36).substring(7)}/200/200.jpg`,
                    group: groupMatch ? groupMatch[1] : 'General',
                    id: idMatch ? idMatch[1] : Math.random().toString(36).substring(7),
                    language: langMatch ? langMatch[1] : null,
                    quality: qualMatch ? qualMatch[1] : null,
                    url: ''
                };
            } else if (trimmedLine && !trimmedLine.startsWith('#') && currentChannel) {
                currentChannel.url = trimmedLine;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }
        return channels;
    }

    extractCategories() {
        this.categories.clear();
        for (const channel of this.channels) {
            if (channel.group) {
                this.categories.add(channel.group);
            }
        }
    }

    getCategoryIcon(categoryName) {
        const categoryLower = categoryName.toLowerCase();
        if (categoryLower.includes('movie') || categoryLower.includes('film')) return 'fa-film';
        if (categoryLower.includes('sport')) return 'fa-football-ball';
        if (categoryLower.includes('news')) return 'fa-newspaper';
        if (categoryLower.includes('music')) return 'fa-music';
        if (categoryLower.includes('kids') || categoryLower.includes('children')) return 'fa-child';
        if (categoryLower.includes('documentary')) return 'fa-globe';
        if (categoryLower.includes('entertainment')) return 'fa-theater-masks';
        if (categoryLower.includes('relious') || categoryLower.includes('religious')) return 'fa-mosque';
        if (categoryLower.includes('adult')) return 'fa-user-secret';
        return 'fa-tv';
    }

    initPlayer() {
        this.video.volume = 0;
        this.video.muted = true;
        this.volumeSlider.value = 0;
        this.muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';

        if (!localStorage.getItem('userHasUnmuted')) {
            this.muteBtn.addEventListener('click', () => {
                if (this.video.volume === 0 && this.video.muted) {
                    this.video.volume = 1.0;
                    this.video.muted = false;
                    this.volumeSlider.value = 1.0;
                    localStorage.setItem('userHasUnmuted', 'true');
                    this.updateMuteButton();
                } else {
                    this.toggleMute();
                }
            }, { once: true });
        }

        this.volumeSlider.addEventListener("input", () => {
            this.video.volume = this.volumeSlider.value;
            if (this.video.volume > 0) this.video.muted = false;
            this.updateMuteButton();
        });

        this.video.addEventListener("play", () => {
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            this.posterImage.style.display = "none";
        });

        this.video.addEventListener("pause", () => {
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        });

        this.video.addEventListener("waiting", () => this.loadingOverlay.style.display = "flex");
        this.video.addEventListener("playing", () => {
            this.loadingOverlay.style.display = "none";
            this.errorMessage.style.display = "none";
        });

        this.qualityMenu.addEventListener("change", () => {
            if (this.hls) {
                const level = parseInt(this.qualityMenu.value);
                this.hls.currentLevel = level >= 0 ? level : Hls.level.AUTO;
            }
        });
    }

    loadSource(url) {
        this.cleanupPlayer();
        this.loadingOverlay.style.display = "flex";
        this.errorMessage.style.display = "none";

        if (Hls.isSupported()) {
            this.hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90
            });

            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);

            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.populateQualityMenu();
                this.video.play().catch(e => {
                    console.error("Autoplay failed:", e);
                    this.loadingOverlay.style.display = "none";
                });
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    this.showError(`Stream error: ${data.details}`);
                    this.cleanupPlayer();
                }
            });
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this.video.src = url;
            this.video.addEventListener('loadedmetadata', () => this.video.play());
        } else {
            this.showError("HLS not supported");
        }
    }

    cleanupPlayer() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.src = "";
        this.video.load();
    }

    populateQualityMenu() {
        if (!this.hls || !this.hls.levels || this.hls.levels.length <= 1) {
            this.qualityMenu.style.display = 'none';
            return;
        }

        this.qualityMenu.innerHTML = '<option value="auto">Auto Quality</option>';
        this.hls.levels.forEach((level, index) => {
            const option = document.createElement("option");
            option.value = index;
            option.textContent = `${level.height}p`;
            this.qualityMenu.appendChild(option);
        });
        this.qualityMenu.style.display = 'block';
    }

    togglePlayPause() {
        if (this.video.paused) this.video.play().catch(e => console.error(e));
        else this.video.pause();
    }

    toggleMute() {
        if (this.video.volume > 0) {
            this.video.volume = 0;
            this.video.muted = true;
            this.volumeSlider.value = 0;
        } else {
            this.video.volume = 1.0;
            this.video.muted = false;
            this.volumeSlider.value = 1.0;
        }
        this.updateMuteButton();
    }

    updateMuteButton() {
        this.muteBtn.innerHTML = this.video.volume > 0 ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
    }

    cycleZoom() {
        this.zoomIndex = (this.zoomIndex + 1) % this.zoomModes.length;
        this.video.style.objectFit = this.zoomModes[this.zoomIndex];
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) this.video.requestFullscreen().catch(err => console.error(err));
        else document.exitFullscreen();
    }

    togglePiP() {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else if (document.pictureInPictureEnabled) this.video.requestPictureInPicture();
    }

    showError(message) {
        this.errorText.textContent = message;
        this.errorMessage.style.display = "block";
    }

    loadChannel(channel) {
        if (!channel || !channel.url) return;
        this.currentChannel = channel;
        this.updateChannelInfo(channel);
        this.loadSource(channel.url);
        this.updateActiveChannelCard(channel.id);
        this.addToRecentlyPlayed(channel);
        document.querySelector('.player-container').scrollIntoView({ behavior: 'smooth' });
    }

    updateChannelInfo(channel) {
        document.getElementById('currentChannelName').textContent = channel.name;
        document.getElementById('currentChannelLogo').src = channel.logo;
        document.getElementById('currentChannelQuality').innerHTML = `<i class="fas fa-signal"></i> ${channel.quality || 'Auto'}`;

        const lang = document.getElementById('currentChannelLanguage');
        if (channel.language) {
            lang.style.display = 'flex';
            lang.innerHTML = `<i class="fas fa-globe"></i> ${channel.language}`;
        } else lang.style.display = 'none';

        const group = document.getElementById('currentChannelGroup');
        if (channel.group) {
            group.style.display = 'flex';
            group.innerHTML = `<i class="fas fa-tag"></i> ${channel.group}`;
        } else group.style.display = 'none';
    }

    updateActiveChannelCard(channelId) {
        document.querySelectorAll('.channel-card').forEach(card => card.classList.toggle('active', card.dataset.channelId === channelId));
    }

    toggleFavorite(channelId) {
        const index = this.favorites.indexOf(channelId);
        if (index > -1) this.favorites.splice(index, 1);
        else this.favorites.push(channelId);
        localStorage.setItem('favorites', JSON.stringify(this.favorites));
        this.renderChannels();
    }

    renderCategories() {
        const tabs = document.getElementById('categoryTabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        
        // All Channels
        tabs.appendChild(this.createCategoryTab('all', 'All', 'fa-globe', this.channels.length));

        // Favorites Tab (Dynamic)
        if (this.favorites.length > 0) {
            const favCount = this.channels.filter(c => this.favorites.includes(c.id)).length;
            if (favCount > 0) {
                tabs.appendChild(this.createCategoryTab('favorites', 'Favorites', 'fa-heart', favCount));
            }
        }

        this.categories.forEach(category => {
            const count = this.channels.filter(c => c.group === category).length;
            if (count > 0) tabs.appendChild(this.createCategoryTab(category, category, this.getCategoryIcon(category), count));
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

    setActiveCategory(category) {
        this.currentCategory = category;
        document.querySelectorAll('.category-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.category === category));
        this.renderChannels();
    }

    renderChannels() {
        const grid = document.getElementById('channelsGrid');
        grid.innerHTML = '';

        let list = this.channels;
        if (this.currentCategory !== 'all') {
            if (this.currentCategory === 'favorites') list = list.filter(c => this.favorites.includes(c.id));
            else list = list.filter(c => c.group === this.currentCategory);
        }

        if (this.searchQuery) list = list.filter(c => c.name.toLowerCase().includes(this.searchQuery.toLowerCase()));

        list.sort((a, b) => a.name.localeCompare(b.name));

        if (list.length === 0) {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-tv"></i><h3>No channels found</h3></div>';
            return;
        }

        list.forEach(channel => grid.appendChild(this.createChannelCard(channel)));
    }

    createChannelCard(channel) {
        const card = document.createElement('div');
        card.className = `channel-card ${this.currentChannel?.id === channel.id ? 'active' : ''}`;
        card.dataset.channelId = channel.id;
        const isFav = this.favorites.includes(channel.id);

        card.innerHTML = `
            <div class="channel-card-logo-container">
                <img data-src="${channel.logo}" alt="${channel.name}" class="channel-card-logo lazy-load" onerror="this.src='https://picsum.photos/seed/error/60/60.jpg'">
            </div>
            <div class="channel-card-name">${channel.name}</div>
            <button class="favorite-btn ${isFav ? 'active' : ''}"><i class="fas fa-heart"></i></button>
        `;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.favorite-btn')) this.loadChannel(channel);
        });

        card.querySelector('.favorite-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFavorite(channel.id);
        });

        this.setupLazyLoading(card.querySelector('.lazy-load'));
        return card;
    }

    setupLazyLoading(img) {
        const obs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const i = entry.target;
                    i.src = i.dataset.src;
                    i.classList.add('loaded');
                    obs.unobserve(i);
                }
            });
        });
        obs.observe(img);
    }

    /**
     * Playlist Logic
     */
    loadPlaylists() {
        const list = document.getElementById('playlistsList');
        list.innerHTML = '';

        if (this.playlists.length === 0) {
            list.innerHTML = '<div class="empty-state"><h3>No playlists yet</h3></div>';
            return;
        }

        this.playlists.forEach((p, index) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.innerHTML = `
                <div class="playlist-info">
                    <div class="playlist-name">${p.name}</div>
                    <div class="playlist-meta">Custom Playlist</div>
                </div>
                <div class="playlist-actions">
                    <button class="btn btn-secondary" onclick="app.deletePlaylist(${index})"><i class="fas fa-trash"></i></button>
                    <button class="btn" onclick="app.loadPlaylist(${index})"><i class="fas fa-play"></i></button>
                </div>
            `;
            list.appendChild(item);
        });
    }

    deletePlaylist(index) {
        if (confirm('Delete this playlist?')) {
            this.playlists.splice(index, 1);
            localStorage.setItem('playlists', JSON.stringify(this.playlists));
            this.loadPlaylists();
        }
    }

    async loadPlaylist(index) {
        const p = this.playlists[index];
        if (!p) return;
        this.channels = this.parseM3U(p.content);
        this.extractCategories();
        this.renderCategories();
        this.renderChannels();
        this.updateCounts();
        this.switchPage('homePage');
        if (this.channels.length > 0) this.loadChannel(this.channels[0]);
    }

    saveNewPlaylist() {
        const name = document.getElementById('newPlaylistName').value.trim() || 'Custom Playlist';
        let m3u = '#EXTM3U\n';
        this.newPlaylistChannels.forEach(c => {
            m3u += `#EXTINF:-1 tvg-logo="${c.logo}" group-title="${c.group}",${c.name}\n${c.url}\n`;
        });

        this.playlists.push({ name, content: m3u });
        localStorage.setItem('playlists', JSON.stringify(this.playlists));
        this.resetPlaylistCreator();
        this.loadPlaylists();
        this.switchPage('playlistsPage');
    }

    addChannelToPlaylist() {
        const nameInp = document.getElementById('newChannelName');
        const urlInp = document.getElementById('newChannelUrl');
        if (!nameInp || !urlInp) return;
        
        const name = nameInp.value.trim();
        const url = urlInp.value.trim();
        if (!name || !url) return;

        const logoInp = document.getElementById('newChannelLogo');
        const groupInp = document.getElementById('newChannelGroupInput');

        this.newPlaylistChannels.push({
            name, url, 
            logo: (logoInp ? logoInp.value.trim() : '') || 'https://picsum.photos/seed/chan/200/200.jpg',
            group: (groupInp ? groupInp.value : '') || 'General',
            id: Math.random().toString(36).substr(2, 9)
        });
        this.renderNewPlaylistPreview();
    }

    renderNewPlaylistPreview() {
        const list = document.getElementById('newPlaylistChannelsList');
        document.getElementById('emptyChannelList').style.display = this.newPlaylistChannels.length ? 'none' : 'block';
        document.getElementById('saveNewPlaylistBtn').disabled = !this.newPlaylistChannels.length;
        document.getElementById('channelCount').textContent = this.newPlaylistChannels.length;
        list.innerHTML = '';
        this.newPlaylistChannels.forEach((c, i) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.innerHTML = `<span>${c.name}</span> <button class="btn btn-secondary" onclick="app.removeChannelFromPreview(${i})"><i class="fas fa-times"></i></button>`;
            list.appendChild(item);
        });
    }

    removeChannelFromPreview(i) {
        this.newPlaylistChannels.splice(i, 1);
        this.renderNewPlaylistPreview();
    }

    resetPlaylistCreator() {
        this.newPlaylistChannels = [];
        document.getElementById('newPlaylistName').value = '';
        this.renderNewPlaylistPreview();
    }

    /**
     * UI & Events
     */
    setupEventListeners() {
        document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', () => this.switchPage(i.dataset.page)));
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.renderChannels();
            });
        }

        const loadBuiltinBtn = document.getElementById('loadBuiltinBtn');
        if (loadBuiltinBtn) {
            loadBuiltinBtn.addEventListener('click', () => this.loadM3UPlaylist().then(() => {
                this.renderCategories();
                this.renderChannels();
            }));
        }

        const sleepTimerBtn = document.getElementById('sleepTimerBtn');
        if (sleepTimerBtn) sleepTimerBtn.addEventListener('click', () => this.showDialog('sleepTimerModal'));
        
        const addChannelBtn = document.getElementById('addChannelToListBtn');
        if (addChannelBtn) addChannelBtn.addEventListener('click', () => this.addChannelToPlaylist());
        
        const savePlaylistBtn = document.getElementById('saveNewPlaylistBtn');
        if (savePlaylistBtn) savePlaylistBtn.addEventListener('click', () => this.saveNewPlaylist());
        
        this.setupCustomSelect('newChannelGroup', 'groupDropdown', 'newChannelGroupInput');
        this.setupCustomSelect('newChannelRes', 'resDropdown', 'newChannelResInput');
        this.setupCustomSelect('newChannelLang', 'langDropdown', 'newChannelLangInput');

        const closeAbout = document.getElementById('closeAbout');
        if (closeAbout) closeAbout.addEventListener('click', () => this.hideDialog('aboutDialog'));
        
        const aboutItem = document.getElementById('aboutItem');
        if (aboutItem) aboutItem.addEventListener('click', () => this.showDialog('aboutDialog'));
        
        const subscribeBtn = document.getElementById('subscribeBtn');
        if (subscribeBtn) subscribeBtn.addEventListener('click', () => window.open('https://youtube.com/@GamerArnabXYZ'));
        
        const scanBtn = document.getElementById('scanBuiltinBtn');
        if (scanBtn) scanBtn.addEventListener('click', () => this.showNotification('Scanner logic requires more resources. Check again later.', 'info'));
    }

    setupCustomSelect(id, dropId, hidId) {
        const inp = document.getElementById(id);
        const drop = document.getElementById(dropId);
        if (!inp || !drop) return;

        inp.addEventListener('click', (e) => {
            e.stopPropagation();
            drop.parentElement.classList.toggle('active');
        });
        drop.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.addEventListener('click', () => {
                inp.value = opt.textContent;
                const hid = document.getElementById(hidId);
                if (hid) hid.value = opt.dataset.value;
                drop.parentElement.classList.remove('active');
            });
        });
        document.addEventListener('click', () => drop.parentElement.classList.remove('active'));
    }

    switchPage(id) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === id));
        document.querySelectorAll('.page-section').forEach(s => s.classList.toggle('active', s.id === id));
    }

    showDialog(id) { document.getElementById(id).classList.add('active'); }
    hideDialog(id) { document.getElementById(id).classList.remove('active'); }

    showNotification(msg, type = 'info') {
        const n = document.createElement('div');
        n.className = `notification ${type}`;
        n.innerHTML = `<span>${msg}</span>`;
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3000);
    }

    updateCounts() {
        document.getElementById('builtinCount').textContent = `${this.channels.length} channels`;
    }

    /**
     * Extra Features
     */
    addToRecentlyPlayed(channel) {
        this.recentlyPlayed = this.recentlyPlayed.filter(c => c.id !== channel.id);
        this.recentlyPlayed.unshift(channel);
        if (this.recentlyPlayed.length > 10) this.recentlyPlayed.pop();
        localStorage.setItem('recentlyPlayed', JSON.stringify(this.recentlyPlayed));
        this.renderRecentlyPlayed();
    }

    renderRecentlyPlayed() {
        const grid = document.getElementById('recentlyPlayedGrid');
        const sec = document.getElementById('recentlyPlayedSection');
        if (!this.recentlyPlayed.length) { sec.style.display = 'none'; return; }
        sec.style.display = 'block';
        grid.innerHTML = '';
        this.recentlyPlayed.forEach(c => grid.appendChild(this.createChannelCard(c)));
    }

    clearRecentlyPlayed() {
        this.recentlyPlayed = [];
        localStorage.setItem('recentlyPlayed', '[]');
        this.renderRecentlyPlayed();
    }

    setSleepTimer(mins) {
        this.clearSleepTimer();
        this.sleepTimerEnd = Date.now() + mins * 60000;
        this.sleepTimer = setTimeout(() => {
            this.video.pause();
            this.showNotification('Sleep timer ended', 'info');
            this.clearSleepTimer();
        }, mins * 60000);
        document.getElementById('cancelTimerBtn').style.display = 'block';
        this.hideDialog('sleepTimerModal');
    }

    clearSleepTimer() {
        if (this.sleepTimer) clearTimeout(this.sleepTimer);
        this.sleepTimer = null;
        this.sleepTimerEnd = null;
        document.getElementById('cancelTimerBtn').style.display = 'none';
        document.getElementById('timerStatus').textContent = 'Set a timer to automatically pause playback.';
    }

    updateTimerStatus() {
        if (!this.sleepTimerEnd) return;
        const rem = Math.ceil((this.sleepTimerEnd - Date.now()) / 60000);
        if (rem > 0) document.getElementById('timerStatus').textContent = `Pause in ${rem} minutes`;
        else this.clearSleepTimer();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new GAXIPTV();
});
