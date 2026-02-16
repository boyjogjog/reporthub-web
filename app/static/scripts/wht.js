/**
 * WhiteboardManager - Handles the report editor, data loading, and saving.
 */
export default class WhiteboardManager {
    constructor() {
        this.selection = null;
        this.editor = document.getElementById('editor');
        this.headerSpan = document.querySelector('.header-left span:last-child');
        this.btns = {
            save: document.getElementById('btn-save'),
            attach: document.getElementById('btn-attach'),
            send: document.getElementById('btn-send'),
            import: document.getElementById('btn-import'),
            export: document.getElementById('btn-export')
        };

        this.decisionModal = document.getElementById('decision-modal');
        this.btnDetach = document.getElementById('btn-detach-confirm');
        this.btnDelete = document.getElementById('btn-delete-confirm');
        this.btnCancel = document.getElementById('btn-cancel-confirm');

        // Callback registry for external logic
        this.callbacks = {};

        this.highlighter = null;
        this.activeLi = null;

        this._attachmentQueue = [];
        this._isProcessingQueue = false;

        // Make sure this ID matches your HTML exactly
        this.whiteboard = document.getElementById('whiteboard');

        if (!this.whiteboard) {
            console.error("Whiteboard element not found during initialization!");
        }
        // ... other initializations

        this._initListeners();
    }

    /**
     * External hook to register listeners for button clicks
     * @param {string} btnKey - 'save', 'attach', 'send', 'import', 'export'
     * @param {function} fn - The function to run
     */
    onButtonClick(btnKey, fn) {
        if (this.btns[btnKey]) {
            this.callbacks[btnKey] = fn;
        }
    }

    _initListeners() {
        // Internal Editor Logic
        this.editor.addEventListener('click', () => setTimeout(() => this.moveHighlighter(), 0));
        this.editor.addEventListener('input', () => {
            this.isDirty = true; // Any change makes it dirty
            this.moveHighlighter();
        });
        this.editor.addEventListener('keydown', (e) => this._handleKeyDown(e));

        document.addEventListener('mousedown', (e) => {
            if (!this.editor.contains(e.target) && this.highlighter) {
                this.highlighter.style.opacity = "0";
            }
        });


        // Loop through all buttons and assign click handlers that trigger internal + external logic
        Object.keys(this.btns).forEach(key => {
            const btn = this.btns[key];
            if (!btn) return;

            btn.onclick = async () => {
                // 1. Run Internal logic (e.g., auto-save on specific buttons)
                if (key === 'save') {
                    await this._saveReport();
                }

                // 2. Trigger External logic if a callback was registered
                if (this.callbacks[key]) {
                    // Pass the current state (activeLi, selection) to the external function
                    this.callbacks[key]({
                        activeLi: this.activeLi,
                        selection: this.selection,
                        items: this._scrapeEditorItems()
                    });
                }
            };
        });


        if (this.highlighter) {
            this.highlighter.onclick = () => {
                if (!this.activeLi) return;

                this.activeLi.focus();
                const range = document.createRange();
                const sel = window.getSelection();

                // Focus the text node (index 0) and set caret to its end
                const textNode = this.activeLi.childNodes[0];
                if (textNode && textNode.nodeType === 3) {
                    range.setStart(textNode, textNode.length);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            };
        }

        this.btns.import.onclick = () => {
            if (!this.pendingItems || this.pendingItems.length === 0) return;

            const listElement = this.editor.querySelector('ul, ol');
            if (!listElement) return;

            // --- EMPTY STATE CHECK ---
            // Check if there is only one item and it has no text or placeholder text
            const currentItems = listElement.querySelectorAll('li');
            if (currentItems.length === 1) {
                const firstItemText = currentItems[0].textContent.trim();
                const placeholder = "Type your job here mano...";

                if (firstItemText === "" || firstItemText === placeholder) {
                    listElement.innerHTML = ""; // Clear the default empty <li>
                }
            }

            // --- APPEND PENDING ITEMS ---
            this.pendingItems.forEach(item => {
                const li = this._createListItem(item, true); // true = centered
                listElement.appendChild(li);
            });

            // --- RESET UI ---
            this.pendingItems = [];
            this._updateImportBadge(0);
            this.isDirty = true;
        };

        this.btns.export.addEventListener('click', async () => {
            // 1. Visual Feedback
            const originalText = this.btns.export.innerText;
            this.btns.export.innerText = "Generating...";
            this.btns.export.disabled = true;
            document.body.style.cursor = 'wait';

            try {
                // 2. Fetch the stream from your FastAPI endpoint
                const response = await fetch(`/export-2weekly-report/2026-01-01-15`);

                if (!response.ok) throw new Error('Network response was not ok');

                // 3. Convert the stream to a Blob
                const blob = await response.blob();

                // 4. Create a temporary local URL for this file
                const fileUrl = window.URL.createObjectURL(blob);

                // 5. Trigger the download/open
                const link = document.createElement('a');
                link.href = fileUrl;
                link.download = `Weekly_Report_${this.currentRange}.docx`;

                document.body.appendChild(link);
                link.click();

                // 6. Cleanup
                document.body.removeChild(link);
                window.URL.revokeObjectURL(fileUrl);

            } catch (error) {
                console.error('Export Error:', error);
                alert("Failed to generate report.");
            } finally {
                // 7. Reset UI
                this.btns.export.innerText = originalText;
                this.btns.export.disabled = false;
                document.body.style.cursor = 'default';
            }
        });

        this.btns.send.addEventListener('click', async () => {
            // 1. Define the local path (Use forward slashes for safety in JS strings)
            const filePath = "N:/14. REPORTS/DAILY REPORTS/2026/1 January 2026/Daily activities report 01.01.26.docx";

            // 2. Construct the URL with the path encoded
            // encodeURIComponent handles the ":" and "/" so the URL stays valid
            const url = `http://127.0.0.1:5005/open-file?path=${encodeURIComponent(filePath)}`;

            try {
                // 3. Send the request to your Python Helper
                const response = await fetch(url);

                // 4. Parse the JSON response from Python
                const result = await response.json();

                if (result.status === "success") {
                    console.log("Success! Word should be opening now.");
                } else {
                    console.error("Helper Error:", result.message);
                    alert("Could not open file: " + result.message);
                }
            } catch (error) {
                // 5. Handle cases where the Python Helper isn't running
                console.error("Connection failed:", error);
                alert("The Report Helper is not running. Please start the background service.");
            }
        });
    }

    /**
     * Entry point from Calendar/Mode managers
     */
    async updateView(selection) {
        // 1. Save current work BEFORE selection changes
        if (this.isDirty && this.selection) {
            this.stashCurrentProgress();
        }

        this.selection = selection;
        const { mode, value } = this.selection;


        this._updateHeader(mode, value);

        // 2. Prepare the parameters for loadReport
        let type = '';
        let identifier = '';

        switch (mode) {
            case 0: // Daily
                type = 'daily';
                identifier = value.toISOString().split('T')[0];
                break;

            case 1: // 2-Weekly
                type = 'weekly';
                identifier = this._getSemiMonthlyRangeString(value[0]);
                console.log(identifier);
                break;

            case 2: // Common
                type = 'common';
                identifier = 'global'; // Shared key for common items
                break;
        }

        // 3. Centralized load call
        await this.loadReport(type, identifier);
    }

    _getSemiMonthlyRangeString(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const monthIndex = d.getMonth(); // 0-11
        const month = String(monthIndex + 1).padStart(2, '0');
        const day = d.getDate();

        // February logic: 1-14 and 15-End
        if (monthIndex === 1) {
            if (day <= 14) {
                return `${year}-${month}-01-14`;
            } else {
                const lastDay = new Date(year, monthIndex + 1, 0).getDate();
                return `${year}-${month}-15-${lastDay}`;
            }
        }

        // Standard logic for all other months: 1-15 and 16-End
        if (day <= 15) {
            return `${year}-${month}-01-15`;
        } else {
            const lastDay = new Date(year, monthIndex + 1, 0).getDate();
            return `${year}-${month}-16-${lastDay}`;
        }
    }

    _updateHeader(mode, value) {
        if (!this.headerSpan) return;

        // Reset buttons
        Object.values(this.btns).forEach(btn => { if (btn && btn.id !== 'btn-save') btn.style.display = 'none'; });

        if (mode === 0) {
            this.headerSpan.textContent = `Daily Activities Report - ${value.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })}`;
            if (this.btns.attach) this.btns.attach.style.display = 'inline-flex';
            if (this.btns.send) this.btns.send.style.display = 'inline-flex';
        } else if (mode === 1) {
            const range = value;
            const month = range[0].toLocaleString('default', { month: 'long' });
            this.headerSpan.textContent = `2-Weekly Report: ${month} ${range[0].getDate()} - ${range[1].getDate()}, ${range[0].getFullYear()}`;
            if (this.btns.attach) this.btns.attach.style.display = 'inline-flex';
            if (this.btns.import) this.btns.import.style.display = 'inline-flex';
            if (this.btns.export) this.btns.export.style.display = 'inline-flex';
        } else if (mode === 2) {
            this.headerSpan.textContent = "Common Activity Items";
        }
    }

    //========================================================================================================
    //  SCRAPING & SAVING
    //========================================================================================================

    _scrapeEditorItems() {
        const listItems = this.editor.querySelectorAll('li');
        return Array.from(listItems).map((li, index) => {
            const imgElements = li.querySelectorAll('.li-image-scroll img');
            return {
                uuid: li.getAttribute('data-uuid'),
                // Use textContent of the first child to avoid grabbing image wrapper text
                text: li.childNodes[0].textContent.trim(),
                sort_order: index,
                image_uuids: Array.from(imgElements).map(img => img.getAttribute('data-uuid'))
            };
        }).filter(item => item.text !== "" && !item.text.includes("Type your job here"));
    }


    async _saveReport() {
        const { mode, value } = this.selection;

        const items = this._scrapeEditorItems();

        let endpoint = '';

        if (Number(mode) === 0) {
            const dateStr = value.toISOString().split('T')[0];
            endpoint = `/save-daily-report/${dateStr}`;
        }
        else if (Number(mode) === 1) {
            const rangeStr = this._getSemiMonthlyRangeString(value[0]);
            endpoint = `/save-2weekly-report/${encodeURIComponent(rangeStr)}`;
        }
        else if (Number(mode) === 2) {
            endpoint = `/save-common-report`;
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items),
                credentials: 'include'
            });

            if (response.ok) {
                this.isDirty = false;
                this.showSnackbar("✅ Saved successfully");
            } else {
                this.showSnackbar("❌ Save failed");
            }

        } catch (err) {
            this.showSnackbar("⚠️ Network error");
        }
    }


    //========================================================================================================
    //  LOADING
    //========================================================================================================

    async loadDailyReport(dateStr) {
        const response = await fetch(`/load-daily-report/${dateStr}`);
        const data = await response.json();
        console.log(data);
        this._renderList(data, false);
        this.isDirty = false;
    }

    async load2WeeklyReport(rangeStr) {
        const response = await fetch(`/load-2weekly-report/${rangeStr}`);
        const items = await response.json(); // it's already an array

        this._renderList(items, false, true);
        this.isDirty = false;

        const compareRes = await fetch(`/extract-imaged-reports/${rangeStr}`);
        const compareItems = await compareRes.json();

        const currentUuids = new Set(items.map(i => i.uuid));

        this.pendingItems = compareItems.filter(
            item => !currentUuids.has(item.uuid)
        );

        this._updateImportBadge(this.pendingItems.length);
    }


    async loadCommonReport() {
        const response = await fetch(`/load-common-report`);
        const data = await response.json();
        this._renderList(data.items, false);
        this.isDirty = false;
    }

    _scrapeEditorItems() {
        const items = [];

        const list = this.editor.querySelector('ol, ul');
        if (!list) return items;

        const listItems = list.querySelectorAll('li');

        listItems.forEach(li => {

            let text = '';

            li.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent;
                }
                else if (
                    node.nodeType === Node.ELEMENT_NODE &&
                    !node.classList.contains('li-image-scroll')
                ) {
                    text += node.innerText;
                }
            });

            text = text.trim();

            const image_uuids = [];
            const imageWrappers = li.querySelectorAll('.li-image-scroll [data-img-uuid]');

            imageWrappers.forEach(wrapper => {
                const uuid = wrapper.getAttribute('data-img-uuid');
                if (uuid) image_uuids.push(uuid);
            });

            if (text !== '' || image_uuids.length > 0) {
                items.push({
                    text_content: text,
                    image_uuids: image_uuids
                });
            }
        });

        return items;
    }


    async _renderList(items, ordered, imagesCentered = false) {
        const { mode } = this.selection;

        const is2Weekly = (Number(mode) === 1);

        const listTag = (ordered || is2Weekly) ? 'ol' : 'ul';
        const listElement = document.createElement(listTag);

        if (listTag === 'ol') {
            listElement.style.listStyleType = 'decimal';
            listElement.style.paddingLeft = '2.5rem';
            listElement.style.marginLeft = '1rem';
        }

        

        if (items && items.length > 0) {
            items.forEach(item => {
                listElement.appendChild(this._createListItem(item, imagesCentered));
            });
        }
        else if (is2Weekly) {
            listElement.appendChild(
                this._createListItem({ text_content: "" }, imagesCentered)
            );
        }
        else {
            try {
                const response = await fetch('/load-common-report', {
                    credentials: 'include'
                });
                const data = await response.json();

                if (Array.isArray(data) && data.length > 0) {
                    data.forEach(cItem => {
                        const li = this._createListItem(cItem, imagesCentered);
                        listElement.appendChild(li);
                    });
                } else {
                    listElement.appendChild(
                        this._createListItem(
                            { text_content: "Type your job here mano..." },
                            imagesCentered
                        )
                    );
                }
            } catch (e) {
                listElement.appendChild(
                    this._createListItem(
                        { text_content: "Type your job here mano..." },
                        imagesCentered
                    )
                );
            }
        }

        this.editor.innerHTML = '<div id="li-highlighter" class="li-highlighter"></div>';
        this.editor.appendChild(listElement);
        this.highlighter = document.getElementById('li-highlighter');
        this.isDirty = false;
    }


    _createListItem(itemData = {}, centered = false) {
        const li = document.createElement('li');
        li.setAttribute('data-uuid', itemData.uuid || uuidv4());
        li.contentEditable = "true";

        const textNode = document.createTextNode(itemData.text_content || "");
        li.appendChild(textNode);

        if (itemData.image_uuids?.length > 0) {
            const scrollDiv = document.createElement('div');
            scrollDiv.className = 'li-image-scroll';
            scrollDiv.contentEditable = "false";

            if (centered) {
                scrollDiv.style.display = 'flex';
                scrollDiv.style.justifyContent = 'center';
                scrollDiv.style.flexWrap = 'wrap';
                scrollDiv.style.gap = 'inherit';
            }

            itemData.image_uuids.forEach(imgUuid => {
                scrollDiv.appendChild(this._createImageWrapper(imgUuid));
            });

            li.appendChild(scrollDiv);
        }

        return li;
    }


    // Helper for the image + delete button structure
    _createImageWrapper(uuid) {
        const wrapper = document.createElement('div');
        wrapper.className = 'li-img-wrapper';
        wrapper.setAttribute('data-img-uuid', uuid);

        const img = document.createElement('img');
        img.src = `/image-bucket/get-image/${uuid}?thumb=true`;
        img.dataset.uuid = uuid;
        img.className = 'report-img';
        img.loading = 'lazy';
        img.alt = 'Report Image';

        const overlay = document.createElement('div');
        overlay.className = 'img-delete-overlay';
        overlay.textContent = '✕';

        overlay.onclick = (e) => {
            e.stopPropagation();
            this._handleImageRemoval(uuid, wrapper);
        };

        wrapper.appendChild(img);
        wrapper.appendChild(overlay);

        return wrapper;
    }


    async _handleImageRemoval(uuid, element) {
        this.decisionModal.style.display = 'flex';

        const action = await new Promise((resolve) => {

            const cleanup = () => {
                this.btnDetach.onclick = null;
                this.btnDelete.onclick = null;
                this.btnCancel.onclick = null;
                this.decisionModal.onclick = null;
            };

            this.btnDetach.onclick = () => {
                cleanup();
                resolve('detach');
            };

            this.btnDelete.onclick = () => {
                cleanup();
                resolve('delete');
            };

            this.btnCancel.onclick = () => {
                cleanup();
                resolve('cancel');
            };

            this.decisionModal.onclick = (e) => {
                if (e.target === this.decisionModal) {
                    cleanup();
                    resolve('cancel');
                }
            };
        });

        this.decisionModal.style.display = 'none';

        if (action === 'detach') {
            element.remove();
            this._cleanupEmptyImageContainer(element);
            this.isDirty = true;
            this.showSnackbar("Image removed from report");
        }
        else if (action === 'delete') {
            try {
                const res = await fetch(`/image-bucket/delete/${uuid}`, { method: 'DELETE' });
                if (res.ok) {
                    element.remove();
                    this._cleanupEmptyImageContainer(element);
                    this.isDirty = true;
                    this.showSnackbar("Deleted from server forever");
                }
            } catch (err) {
                this.showSnackbar("Server error");
            }
        }

        this.moveHighlighter();
    }

    _cleanupEmptyImageContainer(imageWrapper) {
        const container = imageWrapper.closest('.li-image-scroll');
        if (!container) return;

        if (container.children.length === 0) {
            container.remove();
        }
    }



    async attachImagesToActiveLi(uuids) {
        if (!uuids || uuids.length === 0) return;

        const targetLi = this.activeLi;
        if (!targetLi) return;

        let scrollContainer = targetLi.querySelector('.li-image-scroll');

        if (!scrollContainer) {
            scrollContainer = this._createImageContainer();
            targetLi.appendChild(scrollContainer);
        }

        uuids.forEach(uuid => {
            scrollContainer.appendChild(this._createImageWrapper(uuid));
            this.isDirty = true;
        });

        this.moveHighlighter();
        this.moveHighlighter();

        if (typeof this.showSnackbar === "function") {
            this.showSnackbar(`${uuids.length} images attached.`);
        }
    }

    _createImageContainer() {
        const container = document.createElement('div');
        container.className = 'li-image-scroll';
        container.contentEditable = "false";

        if (this.selection?.imagesCentered) {
            container.style.display = 'flex';
            container.style.justifyContent = 'center';
            container.style.flexWrap = 'wrap';
            container.style.gap = 'inherit';
        }

        return container;
    }



    async attachImageToActiveLi(uuid) {
        if (!uuid) return;

        this._attachmentQueue.push(uuid);

        if (!this._isProcessingQueue) {
            await this._processAttachmentQueue();
        }
    }

    async _processAttachmentQueue() {
        this._isProcessingQueue = true;

        while (this._attachmentQueue.length > 0) {
            const uuid = this._attachmentQueue.shift();
            await this._executeSingleAttachment(uuid);
            await new Promise(r => setTimeout(r, 40));
        }

        this._isProcessingQueue = false;
    }

    async _executeSingleAttachment(uuid) {
        const targetLi = this.activeLi;
        if (!targetLi) return;

        let container = targetLi.querySelector('.li-image-scroll');
        if (!container) {
            container = this._createImageContainer();
            targetLi.appendChild(container);
        }

        container.appendChild(this._createImageWrapper(uuid));
        this.isDirty = true;

        this.moveHighlighter();
        this.moveHighlighter();
    }


    async _executeSearch(query) {
        if (!query.trim()) return;

        const resultsArea = document.getElementById('search-results-area');
        resultsArea.innerHTML = '<div class="search-loading">Searching history...</div>';

        try {
            const response = await fetch(`/search-reports?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (!data.items || data.items.length === 0) {
                resultsArea.innerHTML = `
                    <div class="search-placeholder">
                        <p>No results found for "${query}"</p>
                    </div>`;
                return;
            }

            // Render the results
            resultsArea.innerHTML = data.items.map(item => `
                <div class="search-result-item" data-uuid="${item.uuid}" style="
                    padding: 15px;
                    border-bottom: 1px solid #eee;
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    <div style="font-weight: bold; color: #36618e; margin-bottom: 5px;">
                        ${item.report_dateStr}
                    </div>
                    <div style="font-size: 14px; color: #444; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        ${item.text}
                    </div>
                </div>
            `).join('');

            // Add click listeners to results to "jump" to that report
            resultsArea.querySelectorAll('.search-result-item').forEach(el => {
                el.onclick = () => {
                    const uuid = el.getAttribute('data-uuid');
                    this._loadHistoricalReport(uuid);
                };
            });

        } catch (err) {
            resultsArea.innerHTML = '<div class="search-error">Search failed. Check connection.</div>';
            console.error("Search Error:", err);
        }
    }

    //========================================================================================================
    //  UI HELPERS
    //========================================================================================================

    _renderSearchUI() {
        // 1. Clear the whiteboard
        this.whiteboard.innerHTML = `
            <div class="search-view-container" style="display: flex; flex-direction: column; height: 100%;">
                <div class="whiteboard-header">
                    <div class="header-left">
                        <div class="search-input-wrapper">
                            <span class="material-symbols-rounded">search</span>
                            <input type="text" id="global-search-input" placeholder="Search across all history...">
                            <button id="btn-exit-search" title="Close Search">✕</button>
                        </div>
                    </div>
                    <div class="header-buttons">
                        </div>
                </div>
                <div id="search-results-area" class="whiteboard-content">
                    <div class="search-placeholder">
                        <span class="material-symbols-rounded" style="font-size: 48px; opacity: 0.2;">history_edu</span>
                        <p>Enter keywords to search past reports</p>
                    </div>
                </div>
            </div>
        `;

        const input = document.getElementById('global-search-input');
        input.focus();

        // Event Listeners
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._executeSearch(input.value);
        });

        document.getElementById('btn-exit-search').onclick = () => {
            // Switch back to Daily Mode (Mode 0) or whatever was previous
            this.updateView({ mode: 0, value: "Daily Activities" });
        };
    }

    _restoreEditorUI() {
        // Re-inject the original HTML structure for the editor
        this.whiteboard.innerHTML = `
            <h3 class="whiteboard-header">
                <div class="header-left">
                    <span class="icon">📝</span>
                    <span id="header-text"></span>
                </div>
                <div class="header-buttons">
                    <button id="btn-import">Import</button>
                    <button id="btn-export">Export</button>
                    <button id="btn-send">Send to Real Report</button>
                    <button id="btn-attach">Attach Image</button>
                    <button id="btn-save">Save</button>
                </div>
            </h3>
            <div class="whiteboard-content" contenteditable="true" id="editor">
                <div id="li-highlighter" class="li-highlighter"></div>
            </div>
        `;
        // Re-cache elements because the old references are now dead
        this.editor = document.getElementById('editor');
        this.headerSpan = document.getElementById('header-text');
        // ... re-bind buttons if necessary
    }

    moveHighlighter() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && this.highlighter) {
            const node = selection.anchorNode;
            this.activeLi = node.nodeType === 3 ? node.parentElement.closest('li') : node.closest('li');

            if (this.activeLi && this.editor.contains(this.activeLi)) {
                const liRect = this.activeLi.getBoundingClientRect();
                const editorRect = this.editor.getBoundingClientRect();
                this.highlighter.style.top = `${liRect.top - editorRect.top + this.editor.scrollTop}px`;
                this.highlighter.style.height = `${liRect.height}px`;
                this.highlighter.style.opacity = "1";
            } else {
                this.highlighter.style.opacity = "0";
            }
        }
    }

    _handleKeyDown(e) {
        if (e.key === 'Enter') {
            this.isDirty = true;
            e.preventDefault();
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            const newLi = this._createListItem();

            if (this.activeLi) {
                this.activeLi.after(newLi);
                const newRange = document.createRange();
                newRange.setStart(newLi, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                setTimeout(() => this.moveHighlighter(), 0);
            }
        } else {
            setTimeout(() => this.moveHighlighter(), 0);
        }
    }

    stashCurrentProgress() {
        const key = this._getCacheKey();
        const html = document.getElementById('editor').innerHTML;
        localStorage.setItem(key, html);
        this.isDirty = false;
        this.showSnackbar("Temporary store unsaved changes to cache.");
    }

    _getCacheKey() {
        const { mode, value } = this.selection;
        let id = "";
        if (mode === 0) id = value.toISOString().split('T')[0];
        else if (mode === 1) id = this._getSemiMonthlyRangeString(value[0]);
        else id = "common";

        return `editor_stash_${mode}_${id}`;
    }

    async loadReport(type, identifier) {
        const cacheKey = `editor_stash_${this.selection.mode}_${identifier}`;
        const stashedHTML = localStorage.getItem(cacheKey);

        if (stashedHTML) {
            // RESTORE FROM CACHE
            this.editor.innerHTML = stashedHTML;
            localStorage.removeItem(cacheKey);
            this.isDirty = true;
            this.highlighter = document.getElementById('li-highlighter');
        } else {
            // FETCH FROM SERVER
            // We reuse your existing specific load functions here
            if (type === 'daily') {
                await this.loadDailyReport(identifier);
            } else if (type === 'weekly') {
                await this.load2WeeklyReport(identifier);
            } else if (type === 'common') {
                await this.loadCommonReport();
            }

            this.isDirty = false;
        }
    }

    _updateImportBadge(count) {
        const btn = this.btns.import;
        let badge = btn.querySelector('.btn-badge');

        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'btn-badge';

                // Positioning logic
                btn.style.position = 'relative';
                badge.style.position = 'absolute';
                badge.style.top = '-5px';
                badge.style.right = '-5px';

                // Colors: Strong Dark Red, NO BORDER
                badge.style.backgroundColor = '#b71c1c'; // Stronger, deeper red
                badge.style.color = 'white';
                badge.style.border = 'none';             // Removed white border

                // Shape: Oval / Pill
                badge.style.minWidth = '22px';
                badge.style.height = '18px';
                badge.style.padding = '0 6px';
                badge.style.borderRadius = '20px';       // Smooth oval corners

                // Layout
                badge.style.display = 'flex';
                badge.style.alignItems = 'center';
                badge.style.justifyContent = 'center';
                badge.style.fontSize = '11px';
                badge.style.fontWeight = '500';          // Extra bold number
                //badge.style.boxShadow = '0 2px 2px rgba(0,0,0,0.4)';
                badge.style.pointerEvents = 'none';

                btn.appendChild(badge);
            }
            badge.textContent = count;
            badge.style.display = 'flex';
        } else if (badge) {
            badge.style.display = 'none';
        }
    }

    showSnackbar(message) {
        const snack = document.getElementById("snackbar");
        if (!snack) return;
        snack.textContent = message;
        snack.className = "show";
        setTimeout(() => { snack.className = snack.className.replace("show", ""); }, 3000);
    }
}