/**
 * ImageBucketManager
 * Modes: 0 - Explorer, 1 - Attach
 */
export default class ImageBucketManager {
    constructor() {
        this.selectedUuids = [];
        this.callbacks = { attach: null, copy: null, delete: null };
        
        // Modal DOM Cache
        this.modal = document.getElementById('gallery-modal');
        this.grid = document.getElementById('image-grid');
        this.folderList = document.getElementById('folder-list');
        this.statusText = document.getElementById('selection-status');

        // Modal Buttons
        this.closeBtn = this.modal.querySelector('.close-btn');
        this.attachBtn = this.modal.querySelector('.btn-attach');
        this.copyBtn = this.modal.querySelector('.btn-copy');
        this.deleteBtn = this.modal.querySelector('.btn-delete');

        // The Sidebar Widget (Trigger)
        this.sidebarWidget = document.querySelector('.widget.image-bucket');

        this._initInternalListeners();

        this.magState = { 
            scale: 1, targetScale: 1, 
            x: 0, targetX: 0, 
            y: 0, targetY: 0,
            isPanning: false
        };

        this._startAnimationLoop();
    }

    _initInternalListeners() {
        // 1. Sidebar Widget Click
        if (this.sidebarWidget) {
            this.sidebarWidget.style.cursor = 'pointer';
            this.sidebarWidget.onclick = () => this.open(0); 
        }

        // 2. Modal Controls
        if (this.closeBtn)  this.closeBtn.onclick = () => this.close();
        if (this.attachBtn) this.attachBtn.onclick = () => this.handleAction('attach');
        if (this.copyBtn)   this.copyBtn.onclick = () => this.handleAction('copy');
        if (this.deleteBtn) this.deleteBtn.onclick = () => this.handleAction('delete');

        this.modal.onclick = (e) => {
            if (e.target === this.modal) this.close();
        };

        // 3. Right-Click Magnify delegation
        this.grid.addEventListener('contextmenu', (e) => {
            const card = e.target.closest('.img-card');
            if (card) {
                e.preventDefault(); // Stop standard menu
                this.magnifyImage(card.dataset.uuid);
            }
        });
        window.addEventListener('keydown', (e) => {
            if (this.isMagnified) {
                if (e.key === 'Escape') this.closeMagnifier();
                if (e.key === 'ArrowRight') this.navigateMagnifier(1);
                if (e.key === 'ArrowLeft') this.navigateMagnifier(-1);
            }
        });
    }

    async open(mode = 0) {
        this._applyMode(mode);
        this.modal.style.display = 'flex';
        this.grid.innerHTML = '<div class="loader">Accessing bucket...</div>';
        
        try {
            const response = await fetch('/image-bucket/get-folders');
            const folders = await response.json();
            this._renderFolders(folders);
        } catch (err) {
            this.grid.innerHTML = '<div class="error-state">Failed to reach server.</div>';
        }
    }

    _applyMode(mode) {
        const isAttach = mode === 1;
        if (this.attachBtn) this.attachBtn.style.display = isAttach ? 'inline-flex' : 'none';
        if (this.copyBtn)   this.copyBtn.style.display = isAttach ? 'none' : 'inline-flex';
        if (this.deleteBtn) this.deleteBtn.style.display = isAttach ? 'none' : 'inline-flex';
    }

    handleAction(type) {
        if (this.selectedUuids.length === 0) {
            alert("Please select images first.");
            return;
        }
        if (this.callbacks[type]) this.callbacks[type](this.selectedUuids);
        if (type === 'attach') this.close();
    }

    close() {
        this.modal.style.display = 'none';
        this.grid.innerHTML = '';
        this.folderList.innerHTML = '';
        this.selectedUuids = [];
        this._updateFooter();
    }

    _renderFolders(folders) {
        if (!folders?.length) {
            this.folderList.innerHTML = '<div class="sidebar-label">No Folders</div>';
            return;
        }

        this.folderList.innerHTML = folders.map((path, i) => `
            <div class="folder-item ${i === 0 ? 'active' : ''}" data-path="${path}">
                <span>📁</span> ${path}
            </div>
        `).join('');

        this.folderList.querySelectorAll('.folder-item').forEach(el => {
            el.onclick = () => {
                this.folderList.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
                el.classList.add('active');
                this._fetchImages(el.dataset.path);
            };
        });
        this._fetchImages(folders[0]);
    }

    async _fetchImages(folderPath) {
        this.grid.innerHTML = '<div class="loader">Loading images...</div>';
        this.selectedUuids = [];
        this._updateFooter();

        try {
            const res = await fetch(`/image-bucket/get-list/${encodeURIComponent(folderPath)}`);
            const uuids = await res.json();

            if (!uuids?.length) {
                this.grid.innerHTML = '<div class="empty-state">No images here.</div>';
                return;
            }

            // HTML remains clean; Logic is handled via JS listeners
            this.grid.innerHTML = uuids.map(uuid => `
                <div class="img-card" data-uuid="${uuid}" title="Right-click to magnify">
                    <img src="/image-bucket/get-image/${uuid}?thumb=true" loading="lazy">
                    <div class="select-badge">✓</div>
                </div>
            `).join('');

            // Click to Select Logic
            this.grid.querySelectorAll('.img-card').forEach(card => {
                card.onclick = () => {
                    const uuid = card.dataset.uuid;
                    const idx = this.selectedUuids.indexOf(uuid);
                    
                    if (idx > -1) {
                        this.selectedUuids.splice(idx, 1);
                        card.classList.remove('selected');
                    } else {
                        this.selectedUuids.push(uuid);
                        card.classList.add('selected');
                    }
                    this._updateFooter();
                };
            });
        } catch (e) {
            this.grid.innerHTML = '<div class="error-state">Network Error</div>';
        }
    }

    magnifyImage(uuid) {
        this.isMagnified = true;
        this.currentUuidsInFolder = Array.from(this.grid.querySelectorAll('.img-card')).map(c => c.dataset.uuid);
        this.currentIndex = this.currentUuidsInFolder.indexOf(uuid);

        let overlay = document.getElementById('image-magnifier');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'image-magnifier';
            overlay.innerHTML = `
                <div class="mag-nav mag-prev">‹</div>
                <div class="mag-nav mag-next">›</div>
                <div class="mag-close-icon">×</div>
                <div id="mag-viewport">
                    <img id="mag-img" src="" draggable="false">
                </div>
            `;
            document.body.appendChild(overlay);
            this._setupMagnifierControls(overlay);
        }

        overlay.style.display = 'flex';
        this._updateMagnifierContent();
    }

    _setupMagnifierControls(overlay) {
        const img = overlay.querySelector('#mag-img');
        const viewport = overlay.querySelector('#mag-viewport');

        overlay.onwheel = (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.85 : 1.15;
            this.magState.targetScale = Math.min(Math.max(1, this.magState.targetScale * factor), 6);
        };

        img.onmousedown = (e) => {
            this.magState.isPanning = true;
            this.magState.startX = e.clientX - this.magState.targetX;
            this.magState.startY = e.clientY - this.magState.targetY;
            img.style.cursor = 'grabbing';
        };

        // Attach to window so pan doesn't break if mouse leaves image
        window.addEventListener('mousemove', (e) => {
            if (!this.magState.isPanning || !this.isMagnified) return;

            let nx = e.clientX - this.magState.startX;
            let ny = e.clientY - this.magState.startY;

            const bounds = this._getBounds(img, viewport);
            
            // Elastic Resistance
            if (nx < bounds.minX) nx = bounds.minX + (nx - bounds.minX) * 0.3;
            if (nx > bounds.maxX) nx = bounds.maxX + (nx - bounds.maxX) * 0.3;
            if (ny < bounds.minY) ny = bounds.minY + (ny - bounds.minY) * 0.3;
            if (ny > bounds.maxY) ny = bounds.maxY + (ny - bounds.maxY) * 0.3;

            this.magState.targetX = nx;
            this.magState.targetY = ny;
        });

        window.addEventListener('mouseup', () => {
            if (!this.magState.isPanning) return;
            this.magState.isPanning = false;
            img.style.cursor = 'grab';
            this._snapBack(img, viewport);
        });

        overlay.querySelector('.mag-close-icon').onclick = () => this.closeMagnifier();
        overlay.querySelector('.mag-prev').onclick = (e) => { e.stopPropagation(); this.navigateMagnifier(-1); };
        overlay.querySelector('.mag-next').onclick = (e) => { e.stopPropagation(); this.navigateMagnifier(1); };
    }

    _getBounds(img, viewport) {
        const vRect = viewport.getBoundingClientRect();
        const iRect = img.getBoundingClientRect();
        
        // Calculate how much the image overflows the viewport
        const overflowX = Math.max(0, (iRect.width - vRect.width) / 2);
        const overflowY = Math.max(0, (iRect.height - vRect.height) / 2);

        return {
            minX: -overflowX, maxX: overflowX,
            minY: -overflowY, maxY: overflowY
        };
    }

    _snapBack(img, viewport) {
        const bounds = this._getBounds(img, viewport);
        if (this.magState.targetX < bounds.minX) this.magState.targetX = bounds.minX;
        if (this.magState.targetX > bounds.maxX) this.magState.targetX = bounds.maxX;
        if (this.magState.targetY < bounds.minY) this.magState.targetY = bounds.minY;
        if (this.magState.targetY > bounds.maxY) this.magState.targetY = bounds.maxY;
    }

    _updateMagnifierContent() {
        const uuid = this.currentUuidsInFolder[this.currentIndex];
        const magImg = document.getElementById('mag-img');
        if (!magImg) return;

        // 1. Find the thumbnail already rendered in your grid
        const thumbElement = this.grid.querySelector(`[data-uuid="${uuid}"] img`);
        
        // 2. Immediate Feedback: Use the thumb source right away
        if (thumbElement) {
            magImg.src = thumbElement.src;
            magImg.style.opacity = '1'; // Show immediately
            magImg.style.filter = 'blur(4px)'; // Optional: slight blur so pixelation looks intentional
        } else {
            magImg.style.opacity = '0';
        }

        // Reset state immediately so controls work even while loading high-res
        this.magState = { 
            scale: 1, targetScale: 1, 
            x: 0, targetX: 0, 
            y: 0, targetY: 0,
            isPanning: false,
            startX: 0, startY: 0
        };

        // 3. Load High-Res in background
        const highResUrl = `/image-bucket/get-image/${uuid}`;
        const highResLoader = new Image();
        
        highResLoader.onload = () => {
            // Only update if the user hasn't navigated away to a different image already
            if (this.currentUuidsInFolder[this.currentIndex] === uuid) {
                magImg.src = highResUrl;
                magImg.style.filter = 'none'; // Remove blur
                magImg.style.opacity = '1';
            }
        };
        
        highResLoader.src = highResUrl;
    }

    _applyMagTransform() {
        const img = document.getElementById('mag-img');
        if (img) {
            img.style.transform = `translate(${this.magState.x}px, ${this.magState.y}px) scale(${this.magState.scale})`;
        }
    }

    navigateMagnifier(direction) {
        const newIdx = this.currentIndex + direction;
        if (newIdx >= 0 && newIdx < this.currentUuidsInFolder.length) {
            this.currentIndex = newIdx;
            this._updateMagnifierContent();
        }
    }

    closeMagnifier() {
        const overlay = document.getElementById('image-magnifier');
        if (overlay) overlay.style.display = 'none';
        this.isMagnified = false;
    }

    _startAnimationLoop() {
        const animate = () => {
            // Only do work if we are actually looking at a magnified image
            if (this.isMagnified) {
                const img = document.getElementById('mag-img');
                if (img && this.magState) {
                    // Smoothly interpolate current values toward targets
                    this.magState.scale += (this.magState.targetScale - this.magState.scale) * 0.15;
                    this.magState.x += (this.magState.targetX - this.magState.x) * 0.15;
                    this.magState.y += (this.magState.targetY - this.magState.y) * 0.15;

                    img.style.transform = `translate(${this.magState.x}px, ${this.magState.y}px) scale(${this.magState.scale})`;
                }
            }
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    _updateFooter() {
        if (this.statusText) {
            this.statusText.innerText = `${this.selectedUuids.length} image${this.selectedUuids.length !== 1 ? 's' : ''} selected`;
        }
    }

    onAttach(cb) { this.callbacks.attach = cb; }
    onCopy(cb)   { this.callbacks.copy = cb; }
    onDelete(cb) { this.callbacks.delete = cb; }
}