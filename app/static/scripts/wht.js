/**
 * WhiteboardManager - Handles the report editor, data loading, and saving.
 * * CORE CONCEPT:
 * This class manages a contentEditable list where each <li> represents a database record.
 * It handles "Daily", "2-Weekly", and "Common" modes, adjusting the UI and buttons 
 * based on the active report type.
 */
export default class WhiteboardManager {

    /**
     * CONSTRUCTOR
     * 1. Maps all UI elements (buttons, editor, modals) to the class instance.
     * 2. Initializes the attachment queue for handling image uploads.
     * 3. Triggers the listener setup.
     */
    constructor(handlers) {
        this.context = null;
        this.handlers = handlers;

        // UI Element Mapping
        this.editor = document.getElementById('editor');
        this.headerSpan = document.querySelector('.header-left span:last-child');
        this.btns = {
            save: document.getElementById('btn-save'),
            attach: document.getElementById('btn-attach'),
            send: document.getElementById('btn-send'),
            import: document.getElementById('btn-import'),
            export: document.getElementById('btn-export')
        };

        // State Tracking
        this.highlighter = null; // Visual bar indicating active row
        this.activeLi = null;    // Reference to the currently focused <li>
        this._attachmentQueue = [];
        this._isProcessingQueue = false;

        this.whiteboard = document.getElementById('whiteboard');

        this._initListeners();
    }

    /**
     * ENTRY POINT FOR LISTENERS
     * Distinguishes between internal editor behavior (typing/clicking) 
     * and external toolbar behavior (button clicks).
     */
    _initListeners() {
        this._initEditorListeners();
        this._initButtonListeners();
    }

    /**
     * EDITOR INTERACTION LISTENERS
     * Syncs the "Highlighter" position with the user's cursor.
     * Marks the document as "dirty" (unsaved) whenever text changes.
     */
    _initEditorListeners() {
        // Sync highlighter on click
        this.editor.addEventListener('click', () =>
            setTimeout(() => this._moveHighlighter(), 0)
        );

        // Track changes and mark as unsaved
        this.editor.addEventListener('input', () => {
            this._setDirty(true);
            this._moveHighlighter();
        });

        this.editor.addEventListener('paste', (e) => {
            this._setDirty(true);
            this._handlePaste(e);
            setTimeout(() => this._moveHighlighter(), 0);
        });

        // Redirect keyboard inputs (Enter/Shift+Enter logic)
        this.editor.addEventListener('keydown', e =>
            this._handleKeyDown(e)
        );

    }

    /**
     * TOOLBAR BUTTON LISTENERS
     * Maps the visual buttons to the "handlers" passed from the main app.
     * Each button builds a "payload" (current state of the editor) before executing.
     */
    _initButtonListeners() {
        this.btns.save?.addEventListener('click', async () => {
            if (!this.handlers.onSave) return;
            const payload = this._getPayload();
            if (await this.handlers.onSave(this.context, payload)) {
                this._setDirty(false);
                this._clearCache(this.context); // Draft is no longer needed
                this.showSnackbar("✅ Report saved successfully.");
            } else {
                this.showSnackbar("❌ Report save failed.");
            }
        });

        this.btns.send?.addEventListener('click', async () => {
            if (!this.handlers.onSend) return;
            if (!this.isDirty) {
                const payload = this._getPayload();
                await this.handlers.onSend(this.context, payload);
            }
        });

        this.btns.import?.addEventListener('click', async () => {
            if (!this.handlers.onImport) return;
            const importables = await this.handlers.onImport();
            if (!importables || importables === 0) return;

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
            importables.forEach(item => {
                const li = this._createListItem(item, true); // true = centered
                listElement.appendChild(li);
            });

            this._updateImportBadge(0);
            this._setDirty(true);
        });

        this.btns.export?.addEventListener('click', async () => {
            if (!this.handlers.onExport) return;
            await this.handlers.onExport(this.context);
        });

        this.btns.attach?.addEventListener('click', async () => {
            if (!this.activeLi) {
                this.showSnackbar("⚠️ Please click a report item first.");
                return;
            }
            const imageUuids = await this.handlers.onAttach?.();
            this.attachImagesToActiveLi(imageUuids);
        });
    }

    /**
     * CONTEXT SWITCHER (The "Brain")
     * Switches between Daily, 2-Weekly, and Common modes.
     * 1. Toggles between standard view and "Search Mode".
     * 2. Updates the header title.
     * 3. Shows/Hides specific buttons based on mode (e.g., Import only in 2-Weekly).
     * 4. Triggers data loading from the backend.
     */
    async changeContext(context) {
        // --- DRAFT SAVING LOGIC ---
        // If the current view is dirty, save it to localStorage before switching
        if (this.isDirty && this.context && this.context.mode !== 3) {
            const payload = this._getPayload();
            this._saveToCache(this.context, payload);
            this._setDirty(false); // Reset dirty flag as it's now "locally saved"
        }

        this._setDirty(false);
        this.context = context;
        const standardHeader = document.getElementById('header-standard');
        const searchHeader = document.getElementById('header-search');
        const headerParent = document.querySelector('.whiteboard-header');
        const editor = document.getElementById('editor');

        // SEARCH MODE LOGIC
        if (this.context.mode == 3) {
            standardHeader.style.display = 'none';
            searchHeader.style.display = 'flex';
            headerParent.classList.add('search-active');
            editor.innerHTML = '<div id="li-highlighter" class="li-highlighter"></div>';
            editor.setAttribute('contenteditable', 'false');
            editor.classList.add('search-results-view');
            const input = document.getElementById('history-search-input');
            if (input) {
                input.value = '';
                input.focus();
                // CATCH ENTER KEY
                input.onkeydown = async (e) => {
                    if (e.key === 'Enter') {
                        const query = e.target.value.trim();

                        if (query.length > 0) {
                            // --- CLEAR WHITEBOARD HERE ---
                            // We keep the highlighter div so it doesn't break future interactions,
                            // and add a placeholder to let the user know the search started.
                            this.editor.innerHTML = "";

                            // Re-assign the highlighter reference since we just wiped the innerHTML
                            this.highlighter = document.getElementById('li-highlighter');

                            // Trigger the "drop and forget" handler
                            this.handlers.onSearch(query);
                        }
                    }
                };
            }
        }
        // REPORT EDITING MODES
        else {
            function formatDateRange(dateStr, full) {
                if (!dateStr) return "";
                const parts = dateStr.split('-');
                const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                const year = parts[0];
                const monthIndex = parseInt(parts[1]) - 1;
                const month = full ? fullMonths[monthIndex] : `${shortMonths[monthIndex]}.`;
                const day1 = parts[2];
                if (parts.length === 4) {
                    const day2 = parts[3];
                    return `${month} (${day1}-${day2}), ${year}`;
                }
                return `${month} ${day1}, ${year}`;
            }

            standardHeader.style.display = 'flex';
            searchHeader.style.display = 'none';
            headerParent.classList.remove('search-active');
            editor.setAttribute('contenteditable', 'true');
            editor.classList.remove('search-results-view');

            if (!this.headerSpan) return;

            // Reset button visibility
            Object.values(this.btns).forEach(btn => {
                if (btn && btn.id !== 'btn-save') btn.style.display = 'none';
            });

            if (this.context.mode === 0) { // DAILY
                this.headerSpan.textContent = `Daily Report: ${formatDateRange(this.context.arg, true)}`;
                if (this.btns.attach) this.btns.attach.style.display = 'inline-flex';
                if (this.btns.send) this.btns.send.style.display = 'inline-flex';
            } else if (this.context.mode === 1) { // 2-WEEKLY
                this.headerSpan.textContent = `2-Weekly Report: ${formatDateRange(this.context.arg, false)}`;
                if (this.btns.attach) this.btns.attach.style.display = 'inline-flex';
                if (this.btns.import) this.btns.import.style.display = 'inline-flex';
                if (this.btns.export) this.btns.export.style.display = 'inline-flex';
            } else if (this.context.mode === 2) { // COMMON
                this.headerSpan.textContent = "Common Activity Items";
            }

            // --- DATA LOADING LOGIC ---
            // 1. Check if we have a local draft first
            const cachedData = this._loadFromCache(this.context);
            let reportList;

            if (cachedData) {
                reportList = cachedData;
                this.showSnackbar("📂 Loaded unsaved draft from browser.");
                // Since we loaded a draft, we should mark it as dirty 
                // so the user knows this still needs to be saved to the server.
                setTimeout(() => this._setDirty(true), 0);
            } else {
                // 2. Fallback to server if no local draft exists
                reportList = await this.handlers.onLoad(this.context);
            }

            this._renderList(reportList, this.context.mode === 1);

            if (context.mode === 1) {
                this._updateImportBadge(await this.handlers.onExtract(this.context.arg, this._getPayload()));
            }
        }

        this.activeLi = null;
    }

    /**
     * DATA RENDERER
     * Converts a JSON array of items into an HTML list (UL or OL).
     * 1. Uses OL (Numbered) for 2-Weekly, UL (Bullet) for others.
     * 2. Automatically pulls "Common Items" if a new daily report is empty.
     * 3. Attaches click listeners to the list to track the 'active' row.
     */
    async _renderList(items = [], is2Weekly) {
        const listTag = (is2Weekly) ? 'ol' : 'ul';
        const listElement = document.createElement(listTag);

        if (listTag === 'ol') {
            listElement.style.listStyleType = 'decimal';
            listElement.style.paddingLeft = '2.5rem';
            listElement.style.marginLeft = '1rem';
        }

        if (items && items.length > 0) {
            items.forEach(item => {
                listElement.appendChild(this._createListItem(item, is2Weekly));
            });
        }
        else if (is2Weekly) {
            listElement.appendChild(this._createListItem({ text_content: "" }, is2Weekly));
        }
        else {
            // Auto-populate with Common items if report is empty
            try {
                const data = await this.handlers.onLoad({ mode: 2 });
                if (Array.isArray(data) && data.length > 0) {
                    data.forEach(cItem => {
                        // CLONE the item but GIVE IT A NEW UUID
                        const newItem = {
                            ...cItem,
                            uuid: uuidv4() // Generate a fresh ID for this specific day
                        };
                        listElement.appendChild(this._createListItem(newItem, is2Weekly));
                    });
                } else {
                    listElement.appendChild(this._createListItem({ uuid: uuidv4(), text_content: "" }, is2Weekly));
                }
            } catch (e) {
                listElement.appendChild(this._createListItem({ uuid: uuidv4(), text_content: "" }, is2Weekly));
            }
        }

        this.editor.innerHTML = '<div id="li-highlighter" class="li-highlighter"></div>';
        this.editor.appendChild(listElement);
        this.highlighter = document.getElementById('li-highlighter');

        listElement.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li) {
                this.activeLi = li;
                this._moveHighlighter();
            }
        });
        this._setDirty(false);
    }

    _createListItem(itemData = {}, centered = false) {
        const li = document.createElement('li');
        li.setAttribute('data-uuid', itemData.uuid || uuidv4());
        li.className = 'report-item-li';
        li.contentEditable = "true";

        // 1. Text Area (Stays left-aligned by default)
        const textSpan = document.createElement('span');
        textSpan.className = 'item-text';
        textSpan.textContent = itemData.text_content || "";
        li.appendChild(textSpan);

        // 2. Image Gallery
        if (itemData.image_uuids?.length > 0) {
            const gallery = document.createElement('div');
            gallery.className = 'item-gallery';

            // Only the gallery gets the centering class
            if (centered) {
                gallery.classList.add('gallery-centered');
            }

            gallery.contentEditable = "false";

            itemData.image_uuids.forEach(uuid => {
                const imgWrapper = this._createImage(uuid);
                gallery.appendChild(imgWrapper);
            });
            li.appendChild(gallery);
        }

        return li;
    }

    _createImage(uuid) {
        const wrapper = document.createElement('div');
        wrapper.className = 'img-wrapper';
        wrapper.contentEditable = "false";

        const img = document.createElement('img');
        img.src = `/image-bucket/get-image/${uuid}?thumb=true`;
        img.className = 'report-img';
        img.setAttribute('data-img-uuid', uuid);

        // DELETE ICON
        const delBtn = document.createElement('div');
        delBtn.className = 'img-del-btn';
        delBtn.innerHTML = '&times;';
        delBtn.onclick = (e) => {
            e.stopPropagation();

            // 1. Reference the gallery before removing the image
            const gallery = wrapper.closest('.item-gallery');

            // 2. Remove the image wrapper
            wrapper.remove();

            // 3. Check if the gallery is now empty
            if (gallery && gallery.querySelectorAll('.img-wrapper').length === 0) {
                gallery.remove();
            }

            // 4. Update state and UI
            this._setDirty(true); // Changed from markAsDirty() to match your class method
            this._moveHighlighter();
        };

        // RIGHT CLICK (Context Menu) Logic
        wrapper.oncontextmenu = (e) => {
            e.preventDefault(); // Stop the standard browser menu
            e.stopPropagation();

            const gallery = wrapper.closest('.item-gallery');
            if (!gallery) return;

            // Find all sibling wrappers in this gallery
            const allWrappers = Array.from(gallery.querySelectorAll('.img-wrapper'));

            // Find the index of the current wrapper
            const currentIndex = allWrappers.indexOf(wrapper);

            // Map all wrappers to their image UUIDs
            const allUuids = allWrappers.map(w =>
                w.querySelector('img').getAttribute('data-img-uuid')
            );

            this.handlers.onMagnify(allUuids, currentIndex);
        };

        // Keep your standard click for simple focus/magnify if needed
        img.onclick = (e) => {
            e.preventDefault(); // Stop the standard browser menu
            e.stopPropagation();

            const gallery = wrapper.closest('.item-gallery');
            if (!gallery) return;

            // Find all sibling wrappers in this gallery
            const allWrappers = Array.from(gallery.querySelectorAll('.img-wrapper'));

            // Find the index of the current wrapper
            const currentIndex = allWrappers.indexOf(wrapper);

            // Map all wrappers to their image UUIDs
            const allUuids = allWrappers.map(w =>
                w.querySelector('img').getAttribute('data-img-uuid')
            );

            this.handlers.onMagnify(allUuids, currentIndex);
        };

        wrapper.appendChild(img);
        wrapper.appendChild(delBtn);
        return wrapper;
    }

    attachImagesToActiveLi(imageUuids) {
        if (imageUuids && imageUuids.length > 0) {
            // 1. Find or Create the gallery container inside this LI
            let gallery = this.activeLi.querySelector('.item-gallery');

            if (!gallery) {
                gallery = document.createElement('div');
                gallery.className = 'item-gallery';
                gallery.contentEditable = "false";
                this.activeLi.appendChild(gallery);
            }

            // 2. Append wrappers to the GALLERY, not the LI
            imageUuids.forEach(uuid => {
                const wrapper = this._createImage(uuid);
                gallery.appendChild(wrapper);
            });

            this._setDirty(true);
            this._moveHighlighter();
        }
    }

    //=====================================================================================================================
    //  SAVING SAVING SAVING
    //=====================================================================================================================

    _getPayload() {
        // Find all list items in the editor
        const items = this.editor.querySelectorAll('.report-item-li');

        return Array.from(items).map(li => {
            // 1. Get the UUID of the row
            const rowUuid = li.getAttribute('data-uuid');

            // 2. Get the text content from our specific text span
            const textContent = li.querySelector('.item-text')?.textContent || "";

            // 3. Get all image UUIDs from the gallery
            const imgElements = li.querySelectorAll('.report-img');
            const imageUuids = Array.from(imgElements).map(img =>
                img.getAttribute('data-img-uuid')
            );

            return {
                uuid: rowUuid,
                text_content: textContent,
                image_uuids: imageUuids
            };
        });
    }

    /**
     * KEYBOARD HANDLER
     * 1. ENTER: Prevents default browser behavior to insert a custom <li> via _createListItem.
     * 2. SHIFT + ENTER: Inserts a line break (<br>) within the same <li>.
     * 3. ALL OTHER KEYS: Updates the highlighter position as you type.
     */
    _handleKeyDown(e) {
        if (e.key === 'Enter') {
            this._setDirty(true);
            e.preventDefault();

            if (e.shiftKey) {
                this._insertNewLine();
                // Immediate sync for line breaks
                this._moveHighlighter();
            } else {
                const selection = window.getSelection();
                const newLi = this._createListItem();

                if (this.activeLi) {
                    this.activeLi.after(newLi);

                    // TARGET THE SPAN: Specifically target the .item-text span 
                    // so the cursor is inside the element that defines the height.
                    const targetNode = newLi.querySelector('.item-text') || newLi;

                    const newRange = document.createRange();
                    newRange.setStart(targetNode, 0);
                    newRange.collapse(true);

                    selection.removeAllRanges();
                    selection.addRange(newRange);

                    // Update the class reference immediately
                    this.activeLi = newLi;
                }
            }

            // Use requestAnimationFrame to wait for the browser to paint the new LI
            requestAnimationFrame(() => {
                this._moveHighlighter();
                if (!e.shiftKey) {
                    // Scroll to the activeLi (the new one) instead of trying to find the sibling
                    this.activeLi?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });

        } else if (e.ctrlKey && e.key === 'z') {
            if (this._lastSnapshot) {
                this.editor.innerHTML = this._lastSnapshot;
                this._lastSnapshot = null;
                this._moveHighlighter();
            }
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            setTimeout(() => {
                this._setDirty(true);
                this._moveHighlighter();
            }, 0);
        } else {
            // Debounce or delay slightly for standard typing
            setTimeout(() => this._moveHighlighter(), 0);
        }
    }

    /**
     * UTILITY: LINE BREAK
     * Uses execCommand for cross-browser stability to insert a <br>.
     * Includes a fallback to scroll to the cursor to ensure it doesn't disappear.
     */
    _insertNewLine() {
        document.execCommand('insertLineBreak');
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.collapse(true);
            const tempSpan = document.createElement('span');
            range.insertNode(tempSpan);
            tempSpan.scrollIntoView({ block: 'nearest' });
            tempSpan.remove();
        }
    }

    _getCacheKey(context) {
        // Generates a unique key like: "draft_0_2026-02-01"
        return `draft_${context.mode}_${context.arg || 'default'}`;
    }

    _saveToCache(context, data) {
        const key = this._getCacheKey(context);
        // Changed to sessionStorage
        sessionStorage.setItem(key, JSON.stringify(data));
    }

    _loadFromCache(context) {
        const key = this._getCacheKey(context);
        // Changed to sessionStorage
        const saved = sessionStorage.getItem(key);
        return saved ? JSON.parse(saved) : null;
    }

    _clearCache(context) {
        const key = this._getCacheKey(context);
        // Changed to sessionStorage
        sessionStorage.removeItem(key);
    }

    /**
     * VISUAL SYNC: HIGHLIGHTER
     * Calculates the exact pixel position and height of the current <li>.
     * Moves the 'li-highlighter' div to "follow" the user as they type or click.
     */
    _moveHighlighter() {
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

    _updateImportBadge(count) {
        const btn = this.btns.import;
        let badge = btn.querySelector('.btn-badge');
        console.log("count", count);
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

    /**
     * STATE MANAGER: IS DIRTY
     * Updates the 'Save' button styling to indicate if there are unsaved changes.
     */
    _setDirty(bol) {
        const saveBtn = this.btns.save;
        if (!saveBtn) return;

        if (bol) {
            saveBtn.classList.add('is-dirty');

            // ADD THIS: Silent backup to localStorage
            if (this.context && this.context.mode !== 3) {
                this._saveToCache(this.context, this._getPayload());
            }
        } else {
            saveBtn.classList.remove('is-dirty');
        }
        this.isDirty = bol;
    }

    onSearchMatch(match) {
        let resultsList = this.editor.querySelector('.search-results-list');

        // 1. Initial Setup: If this is the first match, clear "Searching..." text and create the UL
        if (!resultsList) {
            // Clear everything except the highlighter
            this.editor.innerHTML = '<div id="li-highlighter" class="li-highlighter"></div>';
            resultsList = document.createElement('ul');
            resultsList.className = 'search-results-list';
            this.editor.appendChild(resultsList);
        }

        // 2. Create the Card
        const card = document.createElement('li');
        card.className = 'search-result-card';
        card.contentEditable = "false"; // History is read-only

        // 3. Build Header (Date + UUID/Ref) - WITH INLINE STYLING
        const header = document.createElement('div');
        header.className = 'card-header';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'card-date';

        // --- Inline Styles ---
        dateSpan.style.fontSize = '0.85em';     // Slightly smaller
        dateSpan.style.color = '#757575';       // Muted grey
        dateSpan.style.fontStyle = 'italic';    // Italicized
        dateSpan.style.display = 'block';       // Ensures it doesn't fight for space
        dateSpan.style.marginBottom = '4px';    // Spacing from the body text

        dateSpan.textContent = this._formatDate(match.date);
        header.appendChild(dateSpan);
        card.appendChild(header);

        // 4. Build Body (Text Content)
        const body = document.createElement('div');
        body.className = 'card-text';
        body.textContent = match.text_content;
        card.appendChild(body);

        // 5. Build Gallery (if images exist)
        if (match.image_uuids && match.image_uuids.length > 0) {
            const gallery = document.createElement('div');
            gallery.className = 'item-gallery gallery-compact';

            match.image_uuids.forEach(uuid => {
                // Re-using your existing _createImage method!
                const imgWrapper = this._createImage(uuid);
                // Optional: Remove delete button for search results
                imgWrapper.querySelector('.img-del-btn')?.remove();
                gallery.appendChild(imgWrapper);
            });

            card.appendChild(gallery);
        }

        // 6. Append to list
        resultsList.appendChild(card);
    }

    /** * Simple Helper for Search Dates 
     */
    _formatDate(dateStr) {
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateStr).toLocaleDateString(undefined, options);
    }

    _handlePaste(e) {
    e.preventDefault();
    this._setDirty(true);

    // 1. Get plain text (prevents the 'next line' <div> issue)
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');

    // 2. Get the current selection
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    // --- FIX HERE: selection.deleteFromDocument(), NOT range ---
    selection.deleteFromDocument(); 

    // 3. Get the range (the exact spot where the cursor is)
    const range = selection.getRangeAt(0);

    // 4. Create the new text node
    const textNode = document.createTextNode(text);

    // 5. SAFETY CHECK: Ensure we stay inside the .item-text span
    let container = range.commonAncestorContainer;
    if (container.nodeType === 3) container = container.parentNode;

    // If for some reason the cursor is outside the span, force it back in
    if (!container.classList.contains('item-text') && this.activeLi) {
        const span = this.activeLi.querySelector('.item-text');
        if (span) {
            span.appendChild(textNode);
            this._moveCursorToEnd(span, selection);
            return;
        }
    }

    // 6. Insert the text exactly where the cursor was
    range.insertNode(textNode);

    // 7. Move the blinking cursor to the end of what was just pasted
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    this._moveHighlighter();
}

/** Helper to keep the cursor in the right spot **/
_moveCursorToEnd(el, selection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}



    showSnackbar(message) {
        const snack = document.getElementById("snackbar");
        if (!snack) return;
        snack.textContent = message;
        snack.className = "show";
        setTimeout(() => { snack.className = snack.className.replace("show", ""); }, 3000);
    }
}
