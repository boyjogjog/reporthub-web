/**
 * ImageBucketManager
 * Modes: 0 - Explorer, 1 - Attach
 */
export default class ImageManager {
    constructor(config = {}) {
        this.selectedUuids = [];
        this.callbacks = { attach: null, close: null };

        // Dependency Injection for statelessness
        this.handlers = {
            onFetchFolders: config.onFetchFolders || (async () => []),
            onFetchImages: config.onFetchImages || (async () => [])
        };

        // Modal DOM Cache
        this.modal = document.getElementById('gallery-modal');
        this.grid = document.getElementById('image-grid');
        this.folderList = document.getElementById('folder-list');
        this.statusText = document.getElementById('selection-status');

        // Modal Buttons
        this.closeBtn = this.modal?.querySelector('.close-btn');
        this.attachBtn = this.modal?.querySelector('.btn-attach');
        this.copyBtn = this.modal?.querySelector('.btn-copy');
        this.deleteBtn = this.modal?.querySelector('.btn-delete');

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

    setDepartment(depart) {
        this.department = depart;
    }

    _initInternalListeners() {
        if (this.sidebarWidget) {
            this.sidebarWidget.style.cursor = 'pointer';
            this.sidebarWidget.onclick = () => this.open(0);
        }

        if (this.closeBtn) this.closeBtn.onclick = () => this.close();
        if (this.attachBtn) this.attachBtn.onclick = () => this.handleAction('attach');
        if (this.copyBtn) this.copyBtn.onclick = () => this.handleAction('copy');
        if (this.deleteBtn) this.deleteBtn.onclick = () => this.handleAction('delete');

        this.modal.onclick = (e) => {
            if (e.target === this.modal) this.close();
        };


        this.grid.addEventListener('contextmenu', (e) => {
            const card = e.target.closest('.img-card');
            if (card) {
                e.preventDefault();
                this.magnifyImage(Array.from(this.grid.querySelectorAll('.img-card')).map(c => c.dataset.uuid), card.dataset.uuid);
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

    /**
     * Opens the modal and returns a promise that resolves with selected UUIDs
     */
    async open(mode = 0) {
        this._applyMode(mode);
        this.modal.style.display = 'flex';
        this.grid.innerHTML = '<div class="loader">Accessing bucket...</div>';

        try {
            const folders = await this.handlers.onFetchFolders();
            this._renderFolders(folders);
        } catch (err) {
            console.error("ImageManager Fetch Error:", err);
            this.grid.innerHTML = '<div class="error-state">Failed to reach server.</div>';
        }

        // Only return a Promise if we are in "Attach" mode
        if (mode === 1) {
            return new Promise((resolve) => {
                this.callbacks.attach = (uuids) => resolve(uuids);
                this.callbacks.close = () => resolve([]);
            });
        }

        // Mode 0 (Explorer) just finishes here
        return null;
    }

    _applyMode(mode) {
        const isAttach = mode === 1;
        if (this.attachBtn) this.attachBtn.style.display = isAttach ? 'inline-flex' : 'none';
        if (this.copyBtn) this.copyBtn.style.display = isAttach ? 'none' : 'inline-flex';
        if (this.deleteBtn) this.deleteBtn.style.display = isAttach ? 'none' : 'inline-flex';
    }

    handleAction(type) {
        if (this.selectedUuids.length === 0) {
            alert("Please select images first.");
            return;
        }

        if (type === 'copy') {
            this._downloadCopySelectedImages();
        }
        else if (type === 'delete') {
            this._deleteSelectedImages();
        }
        else if (this.callbacks[type]) {
            this.callbacks[type]([...this.selectedUuids]);
        }

        if (type === 'attach') this.close();
    }

    close() {
        this.modal.style.display = 'none';

        // Trigger resolution of the 'open' promise if it hasn't been already
        if (this.callbacks.close) {
            this.callbacks.close();
        }

        // Cleanup
        this.callbacks.attach = null;
        this.callbacks.close = null;
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
            const uuids = await this.handlers.onFetchImages(folderPath);

            if (!uuids?.length) {
                this.grid.innerHTML = '<div class="empty-state">No images here.</div>';
                return;
            }

            // 1. Added draggable="true" to the card
            this.grid.innerHTML = uuids.map(uuid => `
            <div class="img-card" data-uuid="${uuid}" draggable="true" title="Drag to desktop or Right-click to magnify">
                <img src="/image-bucket/get-image/${uuid}?thumb=true" loading="eager" draggable="false">
                <div class="select-badge">✓</div>
            </div>
        `).join('');

            this.grid.querySelectorAll('.img-card').forEach(card => {
                // --- Keep your existing selection logic ---
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

                // --- New Drag and Drop Logic ---
                card.addEventListener('dragstart', (e) => {
                    const uuid = card.dataset.uuid;
                    const fullResUrl = `${window.location.origin}/image-bucket/get-image/${uuid}`;
                    const fileName = `${uuid}.jpg`;

                    // The 'DownloadURL' MUST be in this exact format with the exact mime-type
                    // format -> mime:fileName:absoluteURL
                    const downloadData = `image/jpeg:${fileName}:${fullResUrl}`;

                    e.dataTransfer.setData('DownloadURL', downloadData);
                    e.dataTransfer.setData('text/uri-list', fullResUrl);

                    // Some older grids look for the file name in the 'text/plain' slot
                    e.dataTransfer.setData('text/plain', fullResUrl);
                });

                card.addEventListener('dragend', () => {
                    card.style.opacity = '1';
                });
            });
        } catch (e) {
            this.grid.innerHTML = '<div class="error-state">Network Error</div>';
        }
    }
    // --- Magnifier Logic ---

    magnifyImage(targetMagnifiableUuids, uuid) {
        this.isMagnified = true;
        this.currentMagnifiableUuids = targetMagnifiableUuids;
        this.currentIndex = this.currentMagnifiableUuids.indexOf(uuid);

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

        window.addEventListener('mousemove', (e) => {
            if (!this.magState.isPanning || !this.isMagnified) return;
            let nx = e.clientX - this.magState.startX;
            let ny = e.clientY - this.magState.startY;
            const bounds = this._getBounds(img, viewport);
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
        const overflowX = Math.max(0, (iRect.width - vRect.width) / 2);
        const overflowY = Math.max(0, (iRect.height - vRect.height) / 2);
        return { minX: -overflowX, maxX: overflowX, minY: -overflowY, maxY: overflowY };
    }

    _snapBack(img, viewport) {
        const bounds = this._getBounds(img, viewport);
        if (this.magState.targetX < bounds.minX) this.magState.targetX = bounds.minX;
        if (this.magState.targetX > bounds.maxX) this.magState.targetX = bounds.maxX;
        if (this.magState.targetY < bounds.minY) this.magState.targetY = bounds.minY;
        if (this.magState.targetY > bounds.maxY) this.magState.targetY = bounds.maxY;
    }

    _updateMagnifierContent() {
        const uuid = this.currentMagnifiableUuids[this.currentIndex];
        const magImg = document.getElementById('mag-img');
        if (!magImg) return;

        const thumbElement = this.grid.querySelector(`[data-uuid="${uuid}"] img`);
        if (thumbElement) {
            magImg.src = thumbElement.src;
            magImg.style.opacity = '1';
            magImg.style.filter = 'blur(4px)';
        } else {
            magImg.style.opacity = '0';
        }

        this.magState = {
            scale: 1, targetScale: 1,
            x: 0, targetX: 0,
            y: 0, targetY: 0,
            isPanning: false, startX: 0, startY: 0
        };

        const highResUrl = `/image-bucket/get-image/${uuid}`;
        const highResLoader = new Image();
        highResLoader.onload = () => {
            if (this.currentMagnifiableUuids[this.currentIndex] === uuid) {
                magImg.src = highResUrl;
                magImg.style.filter = 'none';
                magImg.style.opacity = '1';
            }
        };
        highResLoader.src = highResUrl;
    }

    navigateMagnifier(direction) {
        const newIdx = this.currentIndex + direction;
        if (newIdx >= 0 && newIdx < this.currentMagnifiableUuids.length) {
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
            if (this.isMagnified) {
                const img = document.getElementById('mag-img');
                if (img && this.magState) {
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

    async _downloadCopySelectedImages() {

        try {
            const uuids = [...this.selectedUuids];

            if (!window.pywebview) {
                this._notify("Desktop environment not detected.");
                return;
            }

            this._notify("Preparing images...");

            const result = await window.pywebview.api
                .download_copy_to_clipboard(uuids, this.department.toLowerCase());

            if (result.status === "success") {
                this._notify(
                    `${result.count} images ready. Press Ctrl + V to paste.`
                );
                this.showSnackbar(`✅ ${result.count} images ready. Press Ctrl + V to paste anywhere.`);
            } else {
                this._notify(result.message || "Operation failed.");
            }

        } catch (err) {
            alert(err);
            console.error("Clipboard operation failed:", err);
            this._notify("Something went wrong.");
        }
    }

    async _deleteSelectedImages() {
        const uuids = [...this.selectedUuids];

        if (!confirm(`Delete ${uuids.length} image(s)?`)) return;

        this._notify("Validating and deleting images...");

        let deletedCount = 0;

        for (const uuid of uuids) {
            try {
                const res = await fetch(`/image-bucket/delete-image/${uuid}`, {
                    method: 'DELETE'
                });

                // If the backend says NO (e.g., image is in a report)
                if (res.status === 400) {
                    const data = await res.json();

                    // Alert the user and STOP the entire loop
                    alert(`Cannot complete deletion: ${data.detail || 'One or more images are in use.'}`);
                    this._notify("Deletion halted: Safety constraint met.");
                    break;
                }

                if (res.ok) {
                    deletedCount++;
                } else {
                    console.error(`Failed to delete ${uuid}: ${res.statusText}`);
                }

            } catch (err) {
                console.error("Network or system error:", err);
                this._notify("An error occurred during deletion.");
                break;
            }
        }

        // UI Updates
        if (deletedCount > 0) {
            this._notify(`${deletedCount} image(s) deleted.`);

            // Only reset selection and refresh if something actually happened
            this.selectedUuids = [];
            this._updateFooter();

            const activeFolder = this.folderList.querySelector('.folder-item.active');
            if (activeFolder) {
                await this._fetchImages(activeFolder.dataset.path);
            }
        }
    }

    _notify(msg) {
        if (this.statusText) this.statusText.innerText = msg;
        setTimeout(() => this._updateFooter(), 3000);
    }

    // Callbacks for external usage
    onCopy(cb) { this.callbacks.copy = cb; }
    onDelete(cb) { this.callbacks.delete = cb; }

    showSnackbar(message) {
        const snack = document.getElementById("snackbar");
        if (!snack) return;
        snack.textContent = message;
        snack.className = "show";
        setTimeout(() => { snack.className = snack.className.replace("show", ""); }, 3000);
    }
}