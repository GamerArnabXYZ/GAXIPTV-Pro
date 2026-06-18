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
        this.categories = new Set();
        this.currentCategory = 'all';
        this.searchQuery = '';
        this.isScanning = false;
        this.workingChannels = [];
        this.newPlaylistChannels = []; // For the new M3U creator
        this.editingPlaylistIndex = -1; // Track which playlist is being edited (-1 means creating new)
        this.scanningPlaylistIndex = -1; // Track which playlist is being scanned

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
        this.renderChannels();
        this.updateCounts();
        this.loadPlaylists();

        // Auto-play first channel if available
        if (this.channels.length > 0) {
            this.loadChannel(this.channels[0]);
        }
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

            // Show a helpful message for first-time users
            if (!localStorage.getItem('playlistLoadAttempted')) {
                this.showNotification('No playlist found. Add channels using Create M3U tab.', 'info');
                localStorage.setItem('playlistLoadAttempted', 'true');
            }
        }
    }

    /**
     * Parse M3U content into channel objects
     * @param {string} content - M3U file content
     * @returns {Array} Array of channel objects
     */
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

                // Extra metadata parsing if available
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

    /**
     * Extract categories from channels
     */
    extractCategories() {
        this.categories.clear();
        for (const channel of this.channels) {
            if (channel.group) {
                this.categories.add(channel.group);
            }
        }
    }

    /**
     * Get appropriate icon for category
     * @param {string} categoryName - Name of the category
     * @returns {string} Font Awesome icon class
     */
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

    /**
     * Initialize video player
     */
    initPlayer() {
        // Set initial state to muted for autoplay
        this.video.volume = 0;
        this.video.muted = true;
        this.volumeSlider.value = 0;
        this.muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';

        // Add a one-click unmute option for first-time users
        if (!localStorage.getItem('userHasUnmuted')) {
            this.muteBtn.addEventListener('click', () => {
                if (this.video.volume === 0 && this.video.muted) {
                    this.video.volume = 1.0;
                    this.video.muted = false;
                    this.volumeSlider.value = 1.0;
                    localStorage.setItem('userHasUnmuted', 'true');
                    this.updateMuteButton();
                    this.showNotification('Volume enabled. Adjust using the slider.', 'info');
                } else {
                    this.toggleMute();
                }
            }, {
                once: true
            });
        }

        this.volumeSlider.addEventListener("input", () => {
            this.video.volume = this.volumeSlider.value;
            // If user adjusts slider from 0, unmute the video
            if (this.video.volume > 0) {
                this.video.muted = false;
            }
            this.updateMuteButton();
        });

        this.video.addEventListener("play", () => {
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            this.posterImage.style.display = "none";
        });

        this.video.addEventListener("pause", () => {
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        });

        this.video.addEventListener("waiting", () => {
            this.loadingOverlay.style.display = "flex";
        });

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

    /**
     * Load video source
     * @param {string} url - Video URL
     */
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

            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                this.populateQualityMenu();
                this.video.play().catch(e => {
                    console.error("Autoplay failed:", e);
                    this.loadingOverlay.style.display = "none";
                });
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.error("HLS Error:", data);
                if (data.fatal) {
                    this.showError(`Stream error: ${data.details}. Please try another channel.`);
                    this.cleanupPlayer();
                }
            });
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.video.src = url;
            this.video.addEventListener('loadedmetadata', () => {
                this.video.play();
            });
        } else {
            this.showError("Your browser doesn't support HLS playback. Please try a modern browser.");
            this.loadingOverlay.style.display = "none";
        }
    }

    /**
     * Clean up video player resources
     */
    cleanupPlayer() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.src = "";
        this.video.load();
    }

    /**
     * Populate quality menu with available options
     */
    populateQualityMenu() {
        if (!this.hls || !this.hls.levels || this.hls.levels.length <= 1) {
            this.qualityMenu.style.display = 'none';
            return;
        }

        this.qualityMenu.innerHTML = '';
        const autoOption = document.createElement("option");
        autoOption.value = "auto";
        autoOption.textContent = "Auto Quality";
        this.qualityMenu.appendChild(autoOption);

        this.hls.levels.forEach((level, index) => {
            const option = document.createElement("option");
            option.value = index;
            option.textContent = `${level.height}p`;
            this.qualityMenu.appendChild(option);
        });

        this.qualityMenu.style.display = 'block';
        this.qualityMenu.value = "auto";
    }

    /**
     * Control Functions
     */
    togglePlayPause() {
        if (this.video.paused) {
            this.video.play().catch(e => console.error("Play failed:", e));
        } else {
            this.video.pause();
        }
    }

    toggleMute() {
        if (this.video.volume > 0) {
            // Mute: Set volume to 0
            this.video.volume = 0;
            this.video.muted = true;
            this.volumeSlider.value = 0;
        } else {
            // Unmute: Set volume to 100%
            this.video.volume = 1.0;
            this.video.muted = false;
            this.volumeSlider.value = 1.0;
        }
        this.updateMuteButton();
    }

    updateMuteButton() {
        if (this.video.volume > 0) {
            this.muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        } else {
            this.muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        }
    }

    cycleZoom() {
        this.zoomIndex = (this.zoomIndex + 1) % this.zoomModes.length;
        this.video.style.objectFit = this.zoomModes[this.zoomIndex];
        if (document.fullscreenElement) {
            const fsVideo = document.fullscreenElement.querySelector('video') || document.fullscreenElement;
            fsVideo.style.objectFit = this.zoomModes[this.zoomIndex];
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.video.requestFullscreen().catch(err => console.error("Fullscreen error:", err));
        } else {
            document.exitFullscreen();
        }
    }

    togglePiP() {
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(err => console.error("PiP error:", err));
        } else if (document.pictureInPictureEnabled) {
            this.video.requestPictureInPicture().catch(err => console.error("PiP error:", err));
        }
    }

    showError(message) {
        this.errorText.textContent = message;
        this.errorMessage.style.display = "block";
    }

    /**
     * IPTV Functions
     */
    loadChannel(channel) {
        if (!channel || !channel.url) {
            this.showError("Invalid channel selected");
            return;
        }
        this.currentChannel = channel;
        this.updateChannelInfo(channel);
        this.loadSource(channel.url);
        this.updateActiveChannelCard(channel.id);
        this.addToRecentlyPlayed(channel);

        // Scroll to top to see video
        document.querySelector('.player-container').scrollIntoView({
            behavior: 'smooth'
        });
    }

    updateChannelInfo(channel) {
        document.getElementById('currentChannelName').textContent = channel.name;
        document.getElementById('currentChannelLogo').src = channel.logo;
        document.getElementById('currentChannelQuality').innerHTML = `<i class="fas fa-signal"></i> ${channel.quality || 'Auto'}`;

        const languageSpan = document.getElementById('currentChannelLanguage');
        if (channel.language) {
            languageSpan.style.display = 'flex';
            languageSpan.innerHTML = `<i class="fas fa-globe"></i> ${channel.language}`;
        } else {
            languageSpan.style.display = 'none';
        }

        const groupSpan = document.getElementById('currentChannelGroup');
        if (channel.group) {
            groupSpan.style.display = 'flex';
            groupSpan.innerHTML = `<i class="fas fa-tag"></i> ${channel.group}`;
        } else {
            groupSpan.style.display = 'none';
        }
    }

    updateActiveChannelCard(channelId) {
        document.querySelectorAll('.channel-card').forEach(card => {
            card.classList.toggle('active', card.dataset.channelId === channelId);
        });
    }

    toggleFavorite(channelId) {
        const index = this.favorites.indexOf(channelId);
        if (index > -1) {
            this.favorites.splice(index, 1);
        } else {
            this.favorites.push(channelId);
        }
        localStorage.setItem('favorites', JSON.stringify(this.favorites));
        this.renderChannels();
    }

    renderCategories() {
        const categoryTabs = document.getElementById('categoryTabs');
        categoryTabs.innerHTML = '';

        const allTab = this.createCategoryTab('all', 'All', 'fa-globe', this.channels.length);
        categoryTabs.appendChild(allTab);

        this.categories.forEach(category => {
            const count = this.channels.filter(c => c.group === category).length;
            if (count > 0) {
                const icon = this.getCategoryIcon(category);
                const tab = this.createCategoryTab(category, category, icon, count);
                categoryTabs.appendChild(tab);
            }
        });
    }

    createCategoryTab(category, name, icon, count) {
        const tab = document.createElement('div');
        tab.className = 'category-tab';
        tab.dataset.category = category;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', category === this.currentCategory ? 'true' : 'false');
        tab.setAttribute('tabindex', '0');
        tab.innerHTML = `
            <i class="fas ${icon} category-icon"></i>
            ${name}
            <span class="category-count">${count}</span>
        `;
        tab.addEventListener('click', () => this.setActiveCategory(category));
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.setActiveCategory(category);
            }
        });
        return tab;
    }

    setActiveCategory(category) {
        this.currentCategory = category;
        document.querySelectorAll('.category-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
            tab.setAttribute('aria-selected', tab.dataset.category === category ? 'true' : 'false');
        });
        this.renderChannels();
    }

    renderChannels() {
        const channelsGrid = document.getElementById('channelsGrid');
        channelsGrid.innerHTML = '';

        let channelsToShow = this.channels;
        if (this.currentCategory !== 'all') {
            if (this.currentCategory === 'favorites') {
                channelsToShow = channelsToShow.filter(c => this.favorites.includes(c.id));
            } else {
                channelsToShow = channelsToShow.filter(c => c.group === this.currentCategory);
            }
        }

        if (this.searchQuery) {
            channelsToShow = channelsToShow.filter(c => c.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
        }

        channelsToShow.sort((a, b) => a.name.localeCompare(b.name));

        if (channelsToShow.length === 0) {
            channelsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <i class="fas fa-tv"></i>
                    <h3>No channels found</h3>
                    <p>Try changing category or search term</p>
                </div>
            `;
            return;
        }

        channelsToShow.forEach(channel => {
            const card = this.createChannelCard(channel);
            channelsGrid.appendChild(card);
        });
    }

    createChannelCard(channel) {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.dataset.channelId = channel.id;
        card.setAttribute('role', 'gridcell');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', channel.name);
        const isFavorite = this.favorites.includes(channel.id);

        card.innerHTML = `
            <div class="channel-card-logo-container">
                <div class="channel-logo-placeholder"></div>
                <img data-src="${channel.logo}" alt="${channel.name}" class="channel-card-logo lazy-load" onerror="this.src='https://picsum.photos/seed/error/60/60.jpg'">
            </div>
            <div class="channel-card-name">${channel.name}</div>
            <button class="favorite-btn ${isFavorite ? 'active' : ''}" aria-label="Toggle favorite">
                <i class="fas fa-heart"></i>
            </button>
        `;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.favorite-btn')) {
                this.loadChannel(channel);
            }
        });

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.loadChannel(channel);
            }
        });

        card.querySelector('.favorite-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFavorite(channel.id);
        });

        // Setup lazy loading
        this.setupLazyLoading(card.querySelector('.lazy-load'));

        return card;
    }

    /**
     * Setup lazy loading for images
     * @param {HTMLImageElement} img - Image element to lazy load
     */
    setupLazyLoading(img) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.remove('lazy-load');
                    img.classList.add('loaded');
                    observer.unobserve(img);
                }
            });
        });

        observer.observe(img);
    }

    /**
     * --- NEW M3U CREATOR LOGIC ---
     */
    addChannelToPlaylist() {
        const name = document.getElementById('newChannelName').value.trim();
        const url = document.getElementById('newChannelUrl').value.trim();
        const logo = document.getElementById('newChannelLogo').value.trim();
        const group = document.getElementById('newChannelGroupInput').value.trim();
        const res = document.getElementById('newChannelResInput').value.trim();
        const lang = document.getElementById('newChannelLangInput').value.trim();

        if (!name || !url) {
            this.showNotification('Channel Name and URL are required.', 'error');
            return;
        }

        const channel = {
            name,
            url,
            logo: logo || `https://picsum.photos/seed/${Math.random().toString(36).substring(7)}/200/200.jpg`,
            group: group || 'General',
            quality: res,
            language: lang,
            id: Math.random().toString(36).substring(7)
        };

        this.newPlaylistChannels.push(channel);
        this.renderNewPlaylistPreview();

        // Clear form fields
        document.getElementById('newChannelName').value = '';
        document.getElementById('newChannelUrl').value = '';
        document.getElementById('newChannelLogo').value = '';

        this.showNotification('Channel added to playlist', 'success');
    }

    renderNewPlaylistPreview() {
        const listContainer = document.getElementById('newPlaylistChannelsList');
        const emptyState = document.getElementById('emptyChannelList');
        const channelCount = document.getElementById('channelCount');
        const saveBtn = document.getElementById('saveNewPlaylistBtn');

        if (this.newPlaylistChannels.length === 0) {
            listContainer.style.display = 'none';
            emptyState.style.display = 'block';
            saveBtn.disabled = true;
        } else {
            listContainer.style.display = 'block';
            emptyState.style.display = 'none';
            saveBtn.disabled = false;
            channelCount.textContent = this.newPlaylistChannels.length;

            listContainer.innerHTML = '';
            this.newPlaylistChannels.forEach((channel, index) => {
                const item = document.createElement('div');
                item.className = 'playlist-item';
                item.innerHTML = `
                    <div class="playlist-info">
                        <img src="${channel.logo}" alt="${channel.name}" class="channel-logo-preview">
                        <div>
                            <div class="playlist-name">${channel.name}</div>
                            <div class="playlist-meta">${channel.group} | ${channel.quality || 'Auto'} | ${channel.language || 'Unknown'}</div>
                        </div>
                    </div>
                    <div class="playlist-actions">
                        <button class="btn btn-secondary" data-index="${index}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                item.querySelector('.btn-secondary').addEventListener('click', () => this.removeChannelFromPreview(index));
                listContainer.appendChild(item);
            });
        }
    }

    removeChannelFromPreview(index) {
        this.newPlaylistChannels.splice(index, 1);
        this.renderNewPlaylistPreview();
        this.showNotification('Channel removed from playlist', 'info');
    }

    saveNewPlaylist() {
        if (this.newPlaylistChannels.length === 0) {
            this.showNotification('Cannot save an empty playlist.', 'error');
            return;
        }

        const playlistName = document.getElementById('newPlaylistName').value.trim() || `Custom Playlist ${new Date().toLocaleString()}`;
        let m3uContent = '#EXTM3U\n';

        this.newPlaylistChannels.forEach(channel => {
            // Construct the EXTINF line
            let extinfLine = `#EXTINF:-1 tvg-logo="${channel.logo}" group-title="${channel.group}" tvg-id="${channel.id}"`;
            if (channel.language) extinfLine += ` tvg-language="${channel.language}"`;
            if (channel.quality) extinfLine += ` tvg-resolution="${channel.quality}"`;
            extinfLine += `,${channel.name}\n`;

            m3uContent += extinfLine;
            m3uContent += `${channel.url}\n`;
        });

        const playlist = {
            name: playlistName,
            content: m3uContent,
            created: new Date().toISOString()
        };

        if (this.editingPlaylistIndex >= 0) {
            // Update existing playlist
            this.playlists[this.editingPlaylistIndex] = playlist;
            this.showNotification(`Playlist "${playlistName}" updated successfully!`, 'success');
        } else {
            // Add new playlist
            this.playlists.push(playlist);
            this.showNotification(`Playlist "${playlistName}" saved successfully!`, 'success');
        }

        localStorage.setItem('playlists', JSON.stringify(this.playlists));

        // Reset the creator
        this.resetPlaylistCreator();
        this.switchPage('playlistsPage');
        this.loadPlaylists();
    }

    /**
     * Edit an existing playlist
     * @param {number} index - Index of playlist to edit
     */
    editPlaylist(index) {
        const playlist = this.playlists[index];
        if (!playlist) return;

        this.editingPlaylistIndex = index;

        // Update page title
        document.getElementById('createM3UPageTitle').textContent = 'Edit M3U Playlist';

        // Show cancel button
        document.getElementById('cancelEditBtn').style.display = 'inline-block';

        // Load playlist data into form
        document.getElementById('newPlaylistName').value = playlist.name;

        // Parse M3U content to extract channels
        this.newPlaylistChannels = this.parseM3U(playlist.content);
        this.renderNewPlaylistPreview();

        // Switch to create/edit page
        this.switchPage('createM3UPage');
    }

    /**
     * Reset the playlist creator to its initial state
     */
    resetPlaylistCreator() {
        this.editingPlaylistIndex = -1;
        this.newPlaylistChannels = [];
        document.getElementById('newPlaylistName').value = '';
        document.getElementById('createM3UPageTitle').textContent = 'Create Custom M3U Playlist';
        document.getElementById('cancelEditBtn').style.display = 'none';
        this.renderNewPlaylistPreview();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => this.switchPage(item.dataset.page));
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.switchPage(item.dataset.page);
                }
            });
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.renderChannels();
        });

        // Playlist buttons
        document.getElementById('loadBuiltinBtn').addEventListener('click', async () => {
            await this.loadM3UPlaylist();
            this.renderCategories();
            this.renderChannels();
            this.showNotification('Built-in playlist loaded successfully', 'success');
        });

        document.getElementById('sleepTimerBtn').addEventListener('click', () => this.showDialog('sleepTimerModal'));

        document.getElementById('scanBuiltinBtn').addEventListener('click', () => this.scanBuiltinPlaylist());
        document.getElementById('addPlaylist').addEventListener('click', () => {
            this.resetPlaylistCreator();
            this.switchPage('createM3UPage');
        });

        // --- NEW M3U CREATOR LISTENERS ---
        document.getElementById('addChannelToListBtn').addEventListener('click', () => this.addChannelToPlaylist());
        document.getElementById('saveNewPlaylistBtn').addEventListener('click', () => this.saveNewPlaylist());
        document.getElementById('cancelEditBtn').addEventListener('click', () => {
            this.resetPlaylistCreator();
            this.switchPage('playlistsPage');
        });

        // More page items
        document.getElementById('favoritesItem').addEventListener('click', () => this.showFavorites());
        document.getElementById('exportItem').addEventListener('click', () => this.exportPlaylists());
        document.getElementById('aboutItem').addEventListener('click', () => this.showAboutDialog());

        // Add keyboard support for more items
        ['favoritesItem', 'exportItem', 'aboutItem'].forEach(id => {
            const element = document.getElementById(id);
            element.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    element.click();
                }
            });
        });

        // About dialog
        document.getElementById('closeAbout').addEventListener('click', () => this.hideDialog('aboutDialog'));
        document.getElementById('subscribeBtn').addEventListener('click', () => {
            window.open('https://www.youtube.com/@GamerArnabXYZ', '_blank');
        });

        // Scanner modal
        document.getElementById('closeScanner').addEventListener('click', () => this.hideDialog('scannerModal'));
        document.getElementById('startScan').addEventListener('click', () => this.startScan());
        document.getElementById('stopScan').addEventListener('click', () => this.stopScan());
        document.getElementById('loadWorking').addEventListener('click', () => this.loadWorkingChannels());

        // Custom Select Dropdown Logic
        this.setupCustomSelect('newChannelGroup', 'groupDropdown', 'newChannelGroupInput');
        this.setupCustomSelect('newChannelRes', 'resDropdown', 'newChannelResInput');
        this.setupCustomSelect('newChannelLang', 'langDropdown', 'newChannelLangInput');

        // Keyboard navigation for channels
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const activeCard = document.querySelector('.channel-card.active');
                if (activeCard) {
                    const cards = Array.from(document.querySelectorAll('.channel-card'));
                    const currentIndex = cards.indexOf(activeCard);
                    let nextIndex;

                    if (e.key === 'ArrowRight') {
                        nextIndex = (currentIndex + 1) % cards.length;
                    } else {
                        nextIndex = currentIndex === 0 ? cards.length - 1 : currentIndex - 1;
                    }

                    const nextCard = cards[nextIndex];
                    const channelId = nextCard.dataset.channelId;
                    const channel = this.channels.find(c => c.id === channelId);
                    if (channel) {
                        this.loadChannel(channel);
                    }
                }
            }
        });
    }

    setupCustomSelect(displayInputId, dropdownId, hiddenInputId) {
        const input = document.getElementById(displayInputId);
        const dropdown = document.getElementById(dropdownId);
        const options = dropdown.querySelectorAll('.custom-select-option');

        input.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other dropdowns first
            document.querySelectorAll('.custom-select-wrapper.active').forEach(wrapper => {
                if (wrapper !== input.parentElement) wrapper.classList.remove('active');
            });
            input.parentElement.classList.toggle('active');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            input.parentElement.classList.remove('active');
        });

        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const text = option.textContent;

                document.getElementById(hiddenInputId).value = value;
                input.value = text; // Show the readable text in the box

                input.parentElement.classList.remove('active');
            });
        });
    }

    switchPage(pageId) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageId);
            item.setAttribute('aria-selected', item.dataset.page === pageId ? 'true' : 'false');
        });
        document.querySelectorAll('.page-section').forEach(section => {
            section.classList.toggle('active', section.id === pageId);
        });
    }

    // Update the loadPlaylists method to ensure proper button handling
    loadPlaylists() {
        const playlistsList = document.getElementById('playlistsList');
        playlistsList.innerHTML = '';

        if (this.playlists.length === 0) {
            playlistsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list"></i>
                <h3>No playlists yet</h3>
                <p>Create your first playlist to get started</p>
            </div>
        `;
            return;
        }

        this.playlists.forEach((playlist, index) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.innerHTML = `
            <div class="playlist-info">
                <div class="playlist-name">${playlist.name}</div>
                <div class="playlist-meta">${playlist.content ? 'Local Custom Playlist' : 'Imported URL'}</div>
            </div>
            <div class="playlist-actions">
                <button class="btn btn-edit focusable" data-action="edit" data-index="${index}" aria-label="Edit playlist">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-scan focusable" data-action="scan" data-index="${index}" aria-label="Scan playlist">
                    <i class="fas fa-radar"></i>
                </button>
                <button class="btn btn-secondary focusable" data-action="delete" data-index="${index}" aria-label="Delete playlist">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn focusable" data-action="load" data-index="${index}" aria-label="Load playlist">
                    <i class="fas fa-play"></i>
                </button>
            </div>
        `;

            item.querySelector('[data-action="edit"]').addEventListener('click', () => this.editPlaylist(index));
            item.querySelector('[data-action="scan"]').addEventListener('click', () => this.scanPlaylist(index));
            item.querySelector('[data-action="delete"]').addEventListener('click', () => this.deletePlaylist(index));
            item.querySelector('[data-action="load"]').addEventListener('click', () => this.loadPlaylist(index));

            playlistsList.appendChild(item);
        });
    }

    deletePlaylist(index) {
        if (confirm('Are you sure you want to delete this playlist?')) {
            this.playlists.splice(index, 1);
            localStorage.setItem('playlists', JSON.stringify(this.playlists));
            this.loadPlaylists();
            this.showNotification('Playlist deleted', 'success');
        }
    }

    async loadPlaylist(index) {
        const playlist = this.playlists[index];
        try {
            let m3uContent = playlist.content;
            if (!m3uContent && playlist.url) {
                // If it's a URL-based playlist (legacy support)
                const response = await fetch(playlist.url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                m3uContent = await response.text();
            }

            this.channels = this.parseM3U(m3uContent);
            this.extractCategories();
            this.renderCategories();
            this.renderChannels();
            this.updateCounts();

            this.showNotification(`Loaded ${this.channels.length} channels from ${playlist.name}`, 'success');
            this.switchPage('homePage');

            if (this.channels.length > 0) {
                this.loadChannel(this.channels[0]);
            }
        } catch (error) {
            console.error('Failed to load playlist:', error);
            this.showNotification('Failed to load playlist: ' + error.message, 'error');
        }
    }

    /**
     * Scan built-in playlist for working channels
     */
    scanBuiltinPlaylist() {
        this.scanningPlaylistIndex = -1; // Special value for built-in playlist
        this.showScannerModal();
    }

    /**
     * Scan a specific playlist for working channels
     * @param {number} index - Index of playlist to scan
     */
    async scanPlaylist(index) {
        const playlist = this.playlists[index];
        if (!playlist || !playlist.content) {
            this.showNotification('Cannot scan this playlist', 'error');
            return;
        }

        this.scanningPlaylistIndex = index;
        this.showScannerModal();
    }

    showFavorites() {
        const favoriteChannels = this.channels.filter(c => this.favorites.includes(c.id));
        if (favoriteChannels.length === 0) {
            this.showNotification('No favorite channels yet', 'info');
            return;
        }

        this.currentCategory = 'favorites';
        document.querySelectorAll('.category-tab').forEach(tab => tab.classList.remove('active'));

        const channelsGrid = document.getElementById('channelsGrid');
        channelsGrid.innerHTML = '';
        favoriteChannels.forEach(channel => {
            const card = this.createChannelCard(channel);
            channelsGrid.appendChild(card);
        });

        this.switchPage('homePage');
    }

    exportPlaylists() {
        if (this.playlists.length === 0) {
            this.showNotification('No playlists to export', 'info');
            return;
        }
        let m3uContent = '#EXTM3U\n\n';
        this.playlists.forEach(playlist => {
            m3uContent += `# Playlist: ${playlist.name}\n`;
            if (playlist.content) {
                // Strip the header from individual contents if expanding
                m3uContent += playlist.content.replace('#EXTM3U', '') + '\n\n';
            }
        });

        const blob = new Blob([m3uContent], {
            type: 'text/plain'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'GAXIPTV_Export.m3u';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Playlists exported successfully', 'success');
    }

    showAboutDialog() {
        this.showDialog('aboutDialog');
    }

    showScannerModal() {
        this.showDialog('scannerModal');
    }

    showDialog(id) {
        document.getElementById(id).classList.add('active');
    }

    hideDialog(id) {
        document.getElementById(id).classList.remove('active');
    }

    /**
     * Check if a stream is working
     * @param {string} url - Stream URL
     * @returns {Promise<boolean>} Whether stream is working
     */
    async checkStreamWorking(url) {
        try {
            // Create a video element to test if stream loads
            const video = document.createElement('video');
            video.src = url;
            video.muted = true;

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    video.pause();
                    resolve(false);
                }, 5000); // 5 second timeout

                video.addEventListener('canplay', () => {
                    clearTimeout(timeout);
                    video.pause();
                    resolve(true);
                });

                video.load();
            });
        } catch (error) {
            return false;
        }
    }

    async startScan() {
        let channelsToScan = [];
        let playlistName = '';

        // Determine which playlist to scan
        if (this.scanningPlaylistIndex === -1) {
            // Scan built-in playlist
            channelsToScan = this.channels;
            playlistName = 'Built-in Playlist';
        } else {
            // Scan specific user playlist
            const playlist = this.playlists[this.scanningPlaylistIndex];
            if (!playlist || !playlist.content) {
                this.showNotification('No channels to scan', 'error');
                return;
            }
            channelsToScan = this.parseM3U(playlist.content);
            playlistName = playlist.name;
        }

        if (channelsToScan.length === 0) {
            this.showNotification('No channels to scan', 'error');
            return;
        }

        this.isScanning = true;
        this.workingChannels = [];
        this.updateScanUI('scanning', playlistName);

        const scanResults = document.getElementById('scanResults');
        scanResults.innerHTML = '';

        for (const [index, channel] of channelsToScan.entries()) {
            if (!this.isScanning) break;

            this.addScanItem(scanResults, channel, 'checking');
            this.updateScanProgress(index + 1, channelsToScan.length);

            const isWorking = await this.checkStreamWorking(channel.url);

            if (isWorking) {
                this.workingChannels.push(channel);
                this.updateScanItem(scanResults.children[index], channel, 'working');
            } else {
                this.updateScanItem(scanResults.children[index], channel, 'error');
            }

            // Small delay to prevent browser freeze
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.updateScanUI('complete', playlistName);
    }

    addScanItem(container, channel, status) {
        const item = document.createElement('div');
        item.className = 'scan-item';
        item.innerHTML = `
            <div class="scan-status ${status}"><i class="fas fa-${status === 'checking' ? 'spinner fa-spin' : 'question'}"></i></div>
            <div class="scan-info">
                <div class="scan-name">${channel.name}</div>
                <div class="scan-url">${channel.url.substring(0, 50)}...</div>
            </div>
            <div class="scan-badge ${status}">${status === 'checking' ? 'Checking' : '...'}</div>
        `;
        container.appendChild(item);
    }

    updateScanItem(item, channel, status) {
        const statusEl = item.querySelector('.scan-status');
        const badgeEl = item.querySelector('.scan-badge');

        statusEl.className = `scan-status ${status}`;
        badgeEl.className = `scan-badge ${status}`;

        if (status === 'working') {
            statusEl.innerHTML = '<i class="fas fa-check"></i>';
            badgeEl.textContent = 'Working';
        } else if (status === 'error') {
            statusEl.innerHTML = '<i class="fas fa-times"></i>';
            badgeEl.textContent = 'Error';
        }
    }

    updateScanProgress(scanned, total) {
        const percent = Math.round((scanned / total) * 100);
        document.getElementById('scanProgress').style.width = `${percent}%`;
        document.getElementById('scanPercent').textContent = `${percent}%`;
        document.getElementById('scanStatus').textContent = `Scanning ${scanned}/${total} channels`;
    }

    updateScanUI(state, playlistName) {
        const startBtn = document.getElementById('startScan');
        const stopBtn = document.getElementById('stopScan');
        const loadBtn = document.getElementById('loadWorking');
        const statusText = document.getElementById('scanStatus');

        if (state === 'scanning') {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'inline-block';
            loadBtn.style.display = 'none';
            statusText.textContent = `Scanning ${playlistName}...`;
        } else { // complete
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            loadBtn.style.display = this.workingChannels.length > 0 ? 'inline-block' : 'none';
            statusText.textContent = `Scan complete: ${this.workingChannels.length}/${this.scanningPlaylistIndex === -1 ? this.channels.length : this.parseM3U(this.playlists[this.scanningPlaylistIndex].content).length} channels working`;
            this.isScanning = false;
        }
    }

    stopScan() {
        this.isScanning = false;
        this.updateScanUI('complete', '');
        document.getElementById('scanStatus').textContent = 'Scan stopped';
    }

    loadWorkingChannels() {
        if (this.workingChannels.length === 0) {
            this.showNotification('No working channels found', 'info');
            return;
        }
        this.channels = this.workingChannels;
        this.extractCategories();
        this.renderCategories();
        this.renderChannels();
        this.updateCounts();
        this.hideDialog('scannerModal');
        this.showNotification(`Loaded ${this.workingChannels.length} working channels`, 'success');
        this.switchPage('homePage');
        if (this.channels.length > 0) {
            this.loadChannel(this.channels[0]);
        }
    }

    updateCounts() {
        document.getElementById('builtinCount').textContent = `${this.channels.length} channels`;
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
            <span>${message}</span>
            <i class="fas fa-times notification-close"></i>
        `;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 5000);
        notification.querySelector('.notification-close').addEventListener('click', () => notification.remove());
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new GAXIPTV();

    // Handle fullscreen changes for zoom
    document.addEventListener('fullscreenchange', () => {
        const isFull = !!document.fullscreenElement;
        if (isFull && window.app) {
            const fsVideo = document.fullscreenElement.querySelector('video') || document.fullscreenElement;
            if (fsVideo) {
                fsVideo.style.objectFit = window.app.zoomModes[window.app.zoomIndex];
            }
        }
    });
});       fsVideo.style.objectFit = window.app.zoomModes[window.app.zoomIndex];
            }
        }
    });
}); 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        grid.innerHTML = '';
        
        this.recentlyPlayed.forEach(channel => {
            const card = this.createChannelCard(channel);
            grid.appendChild(card);
        });
    }

    clearRecentlyPlayed() {
        if (confirm('Are you sure you want to clear recently played channels?')) {
            this.recentlyPlayed = [];
            localStorage.setItem('recentlyPlayed', JSON.stringify(this.recentlyPlayed));
            this.renderRecentlyPlayed();
            this.showNotification('Recently played cleared', 'info');
        }
    }

    /**
     * --- SLEEP TIMER LOGIC ---
     */
    setSleepTimer(minutes) {
        this.clearSleepTimer();
        
        const ms = minutes * 60 * 1000;
        this.sleepTimerEnd = Date.now() + ms;
        
        this.sleepTimer = setTimeout(() => {
            this.video.pause();
            this.showNotification('Sleep timer ended. Playback paused.', 'info');
            this.clearSleepTimer();
        }, ms);
        
        document.getElementById('cancelTimerBtn').style.display = 'block';
        this.updateTimerStatus();
        this.showNotification(`Sleep timer set for ${minutes} minutes`, 'success');
        this.hideDialog('sleepTimerModal');
    }

    clearSleepTimer() {
        if (this.sleepTimer) {
            clearTimeout(this.sleepTimer);
            this.sleepTimer = null;
            this.sleepTimerEnd = null;
        }
        document.getElementById('cancelTimerBtn').style.display = 'none';
        document.getElementById('timerStatus').textContent = 'Set a timer to automatically pause playback.';
    }

    updateTimerStatus() {
        if (!this.sleepTimerEnd) return;
        
        const remainingMs = this.sleepTimerEnd - Date.now();
        if (remainingMs <= 0) {
            this.clearSleepTimer();
            return;
        }
        
        const remainingMins = Math.ceil(remainingMs / 60000);
        document.getElementById('timerStatus').textContent = `Playback will pause in approximately ${remainingMins} minutes.`;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new GAXIPTV();

    // Handle fullscreen changes for zoom
    document.addEventListener('fullscreenchange', () => {
        const isFull = !!document.fullscreenElement;
        if (isFull && window.app) {
            const fsVideo = document.fullscreenElement.querySelector('video') || document.fullscreenElement;
            if (fsVideo) {
                fsVideo.style.objectFit = window.app.zoomModes[window.app.zoomIndex];
            }
        }
    });
});       fsVideo.style.objectFit = window.app.zoomModes[window.app.zoomIndex];
            }
        }
    });
});