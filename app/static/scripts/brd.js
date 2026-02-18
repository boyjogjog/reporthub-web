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
            this.setDirty(true); // Any change makes it dirty
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
            this.setDirty(true);
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

        // 1. Define a helper function for copying
        const copyToClipboard = (text) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text);
            } else {
                // Fallback for non-HTTPS / IP address access
                const textArea = document.createElement("textarea");
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                } catch (err) {
                    console.error('Fallback copy failed', err);
                }
                document.body.removeChild(textArea);
                return Promise.resolve();
            }
        };

        this.btns.send.addEventListener('click', async () => {
            // 1. Dirty Check
            if (this.isDirty) {
                alert("You have unsaved changes! Please save your work before sending.");
                return;
            }

            const { mode, value: dateStr } = this.selection;
            const identifier = dateStr.toISOString().split('T')[0];
            // 2. Mode Check
            if (mode !== 0) return;

            try {
                // 3. Call Backend to Load Report Data
                // Replace 'YOUR_BACKEND_URL' with your actual API URL (e.g., http://your-vm-ip:8000)
                const loadResponse = await fetch(`/load-daily-report/${identifier}`);
                const reports = await loadResponse.json();

                if (reports && reports.length > 0) {
                    // 4. Extract text_content and format as bulleted list
                    const clipboardText = reports
                        .map(r => `${r.text_content}`)
                        .join('\n');

                    // 5. Copy to Clipboard
                    await copyToClipboard(clipboardText);
                    console.log("Copied to clipboard via fallback.");
                } else {
                    console.warn("No reports found for this date. Clipboard remains unchanged.");
                }

                // 6. Build File Path for Word Doc
                const dateObj = new Date(dateStr);
                const year = dateObj.getFullYear();
                const monthFull = dateObj.toLocaleString('en-US', { month: 'long' });
                const monthNum = dateObj.getMonth() + 1;

                const dd = String(dateObj.getDate()).padStart(2, '0');
                const mm = String(monthNum).padStart(2, '0');
                const yy = String(year).slice(-2);

                const filePath = `N:/14. REPORTS/DAILY REPORTS/${year}/${monthNum} ${monthFull} ${year}/Daily activities report ${dd}.${mm}.${yy}.docx`;

                // 7. Call Python Helper to open Word
                const openUrl = `http://127.0.0.1:5005/open-file?path=${encodeURIComponent(filePath)}`;
                const openResponse = await fetch(openUrl);
                const openResult = await openResponse.json();

                if (openResult.status === "success") {
                    console.log("Success! Word is opening. You can now paste (Ctrl+V).");
                } else {
                    alert("Helper Error: " + openResult.message);
                }

            } catch (error) {
                console.error("Workflow failed:", error);
                alert("Error during report sync. Ensure both Backend and Local Helper are running.");
            }
        });
    }

    /**
     * Entry point from Calendar/Mode managers
     */
    async updateView(selection) {
        // 1. Save current work BEFORE selection changes
        if (this.isDirty && this.selection) {
            this._saveReport();
        }

        this.selection = selection;
        const { mode, value } = this.selection;

        console.log("Current Mode:", mode);

        // --- Header Toggle Logic ---
        // Mode 3 shows the search input sibling; others show the standard header
        this._toggleSearchHeader(mode === 3);

        // Only update standard header text if we aren't in search mode
        if (mode !== 3) {
            this._updateHeader(mode, value);
        }

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
                break;

            case 2: // Common
                type = 'common';
                identifier = 'global';
                break;

            case 3: // Search History (Special Case)
                type = 'history';
                // Here 'value' is the flowInstanceId passed from the search selection
                identifier = value;
                break;
        }

        // 3. Centralized load call
        if (type && identifier) {
            await this.loadReport(type, identifier);
        }
    }

    /**
     * Toggles visibility between standard header and search input siblings
     */
    _toggleSearchHeader(isSearchMode) {
        const standardHeader = document.getElementById('header-standard');
        const searchHeader = document.getElementById('header-search');
        const headerParent = document.querySelector('.whiteboard-header');
        const editor = document.getElementById('editor');

        if (isSearchMode) {
            // --- 1. UI Toggle ---
            standardHeader.style.display = 'none';
            searchHeader.style.display = 'flex';
            headerParent.classList.add('search-active');

            // --- 2. Clear & Disable Editor for Search Results ---
            // We clear everything except the highlighter div
            editor.innerHTML = '<div id="li-highlighter" class="li-highlighter"></div>';
            editor.setAttribute('contenteditable', 'false');
            editor.classList.add('search-results-view'); // Useful for custom CSS

            // --- 3. Focus Input ---
            const input = document.getElementById('history-search-input');
            if (input) {
                input.value = ''; // Reset search text
                input.focus();
            }
        } else {
            // --- 1. UI Toggle ---
            standardHeader.style.display = 'flex';
            searchHeader.style.display = 'none';
            headerParent.classList.remove('search-active');

            // --- 2. Re-enable Editor ---
            editor.setAttribute('contenteditable', 'true');
            editor.classList.remove('search-results-view');

            // Note: content will be re-filled by the subsequent this.loadReport() 
            // call in your updateView function.
        }
    }

    setupSearchListeners(onSearchRequested) {
        const input = document.getElementById('history-search-input');
        if (!input) return;

        input.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const query = input.value.trim();
                if (!query) return;

                // 1. Clear the UI inside the class to prepare for results
                const editor = document.getElementById('editor');
                editor.innerHTML = '<div id="li-highlighter" class="li-highlighter"></div>';

                // 2. Execute the external callback
                if (typeof onSearchRequested === 'function') {
                    onSearchRequested(query);
                }
            }
        });

        // Optional: Add close button listener to clear input
        document.getElementById('btn-close-search')?.addEventListener('click', () => {
            input.value = '';
            // You could trigger a view reset here too
        });
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
                this.setDirty(false);
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
        this.setDirty(false);
    }

    async load2WeeklyReport(rangeStr) {
        const response = await fetch(`/load-2weekly-report/${rangeStr}`);
        const items = await response.json(); // it's already an array

        this._renderList(items, false, true);
        this.setDirty(false);

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
        this.setDirty(false);
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
                    uuid: li.getAttribute('data-uuid'),
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
        // Inside _renderList, after appending the listElement
        listElement.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li) {
                this.activeLi = li;
                this.moveHighlighter();
            }
        });
        this.setDirty(false);
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
            scrollDiv.contentEditable = "false"; // This is why the caret jumps!

            // --- ADD THIS SECTION ---
            scrollDiv.onclick = (e) => {
                // Prevent the browser from focusing the very start of the LI
                e.preventDefault();

                // Focus the LI so it's active
                li.focus();

                // Move caret to the end of the text node
                const range = document.createRange();
                const selection = window.getSelection();

                // Target the textNode we created above
                range.setStartAfter(textNode);
                range.collapse(true);

                selection.removeAllRanges();
                selection.addRange(range);

                // Sync your highlighter
                this.moveHighlighter();
            };
            // -------------------------

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

    onSearchMatch(match) {
        const editor = document.getElementById('editor');
        if (!editor) return;

        // 1. Create the item
        const matchElement = this._createSearchMatchItem(match);

        // 2. Append it to the editor
        editor.appendChild(matchElement);

        // 3. Optional: Remove the "Waiting..." message if you added one
        const statusMsg = document.getElementById('search-status-msg');
        if (statusMsg) statusMsg.remove();
    }

    _createSearchMatchItem(itemData = {}) {
        const container = document.createElement('div');
        container.className = 'search-match-card';

        // Professional Card Styling
        container.style.cssText = `
        margin: 8px 16px;
        padding: 20px;
        background: #ffffff;
        border: 1px solid #eef2f6;
        border-radius: 12px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        cursor: pointer;
        transition: all 0.2s ease-in-out;
        display: flex;
        flex-direction: column;
        gap: 8px;
    `;

        // 2. Date Header with Badge Style
        const dateHeader = document.createElement('div');
        dateHeader.style.cssText = `
        font-size: 0.75rem;
        font-weight: 700;
        color: #3b82f6;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: #eff6ff;
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: 20px;
        margin-bottom: 4px;
    `;
        dateHeader.textContent = itemData.date || "Unknown Date";
        container.appendChild(dateHeader);

        // 3. Text Content
        const content = document.createElement('div');
        content.className = 'match-text';
        content.style.cssText = `
        color: #334155;
        font-size: 0.95rem;
        line-height: 1.6;
        white-space: pre-wrap;
        margin-bottom: 8px;
    `;
        content.textContent = itemData.text_content || "";
        container.appendChild(content);

        // 4. Images Section (Visual Strip)
        if (itemData.image_uuids?.length > 0) {
            const scrollDiv = document.createElement('div');
            scrollDiv.className = 'li-image-scroll';

            // Refined image strip container
            scrollDiv.style.cssText = `
            display: flex;
            gap: 10px;
            overflow-x: auto;
            padding-bottom: 8px;
            scrollbar-width: thin;
        `;

            itemData.image_uuids.forEach(imgUuid => {
                const imgWrapper = this._createImageWrapper(imgUuid);

                // Cleanup the wrapper for read-only view
                const overlay = imgWrapper.querySelector('.img-delete-overlay');
                if (overlay) overlay.remove();

                // Add a subtle border to thumbnails
                const img = imgWrapper.querySelector('img');
                if (img) img.style.borderRadius = '6px';

                scrollDiv.appendChild(imgWrapper);
            });
            container.appendChild(scrollDiv);
        }

        // 5. Click Action
        //container.onclick = () => {
        //    this.updateView({ mode: 0, value: new Date(itemData.date) });
        //};

        return container;
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
            this.setDirty(true);
            this.showSnackbar("Image removed from report");
        }
        else if (action === 'delete') {
            try {
                const res = await fetch(`/image-bucket/delete/${uuid}`, { method: 'DELETE' });
                if (res.ok) {
                    element.remove();
                    this._cleanupEmptyImageContainer(element);
                    this.setDirty(true);
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
            this.setDirty(true);
        });

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
        this.setDirty(true);

        this.moveHighlighter();
    }


    //========================================================================================================
    //  UI HELPERS
    //=======================================================================================================

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
            this.setDirty(true);
            e.preventDefault();

            const selection = window.getSelection();
            const newLi = this._createListItem();

            if (this.activeLi) {
                this.activeLi.after(newLi);

                const newRange = document.createRange();
                newRange.setStart(newLi, 0);
                newRange.collapse(true);

                selection.removeAllRanges();
                selection.addRange(newRange);

                // Use setTimeout to ensure the DOM has updated before calculating positions
                setTimeout(() => {
                    this.moveHighlighter();

                    // --- AUTO SCROLL LOGIC ---
                    newLi.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest'
                    });
                }, 0);
            }
        } else {
            setTimeout(() => this.moveHighlighter(), 0);
        }
    }

    stashCurrentProgress() {
        const key = this._getCacheKey();
        const html = document.getElementById('editor').innerHTML;
        localStorage.setItem(key, html);
        this.setDirty(false);
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
            this.setDirty(true);
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

            this.setDirty(false);
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

    setDirty(bol) {
        const saveBtn = this.btns.save;
        if (!saveBtn) return;

        if (bol) {
            saveBtn.classList.add('is-dirty');
            console.log("dirt");
        } else {
            saveBtn.classList.remove('is-dirty');
        }
        this.isDirty = bol;
    }

    showSnackbar(message) {
        const snack = document.getElementById("snackbar");
        if (!snack) return;
        snack.textContent = message;
        snack.className = "show";
        setTimeout(() => { snack.className = snack.className.replace("show", ""); }, 3000);
    }
}