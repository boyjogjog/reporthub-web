/**
 * ConnectivityManager: The central hub for all Server-Side communication.
 * Handles: SSE Streams, Session Heartbeats, Centralized API Fetching,
 * and Account Session UI (Logout Menu).
 */
export default class ConnectivityManager {
    constructor(options = {}) {
        // Configuration
        this.pingUrl = "/ping";
        this.intervalMs = 5 * 60 * 1000;

        // State
        this.code = null;
        this.evtSource = null;
        this.lastPingTime = 0;
        this.autoLogoutTimer = null;
        this.isStarted = false;
        this.isPinging = false;


        this.containerId = "qrcode-canvas";
        this.accountHeaderId = "account-header";
        this.accountMenuId = "logout-menu";
        this.logoutBtnId = "btn-logout";


        this.callbacks = {
            onNewImage: options.onNewImage || (() => { }),
            onSearchMatch: options.onSearchMatch || (() => { }),
            onSearchProgress: options.onSearchProgress || (() => { }),
            onSearchComplete: options.onSearchComplete || (() => { }),
            onError: options.onError || ((err) => console.error("CM Error:", err)),
        };

        // Account Menu Configuration (NEW)
        this.accountMenuConfig = {
            headerId: this.accountHeaderId || null,
            menuId: this.accountMenuId || null,
            logoutBtnId: this.logoutBtnId || null,
        };

        // Bound handlers (so we can properly remove them)
        this.throttledHandler = this.handleActivity.bind(this);
        this.boundToggleMenu = null;
        this.boundCloseMenu = null;
        this.boundLogout = null;

        this.department;
    }

    // --- INITIALIZATION ---

    /**
     * Starts the SSE connection and the activity listeners for session management.
     */
    init() {
        if (this.isStarted) return;
        this.isStarted = true;

        this.connectSSE();
        this.setupActivityListeners();
        this.setupAccountMenu(); // ✅ Integrated here
        this.executePing(); // Initial sync

        console.log("Connectivity Manager: Online");
    }

    // --- ACCOUNT MENU INTEGRATION ---

    setupAccountMenu() {
        const { headerId, menuId, logoutBtnId } = this.accountMenuConfig;

        if (!headerId || !menuId || !logoutBtnId) return;

        const header = document.getElementById(headerId);
        const menu = document.getElementById(menuId);
        const logoutBtn = document.getElementById(logoutBtnId);

        if (!header || !menu || !logoutBtn) return;

        // --- 1. Update Department Text from Cookie ---
        const getCookie = (name) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        };

        const userDept = getCookie('user_dept');
        if (userDept) {
            // Find the span inside the header we already located
            const deptNameSpan = header.querySelector('.dept-name');
            if (deptNameSpan) {
                // Decodes URI characters (like %20 for spaces) and adds "Department"
                deptNameSpan.innerText = decodeURIComponent(userDept) + " Department";
            }

            this.department = userDept;
        }

        // --- 2. Existing Menu Logic ---
        this.boundToggleMenu = (e) => {
            e.stopPropagation();
            menu.classList.toggle('active');
        };

        this.boundCloseMenu = () => {
            menu.classList.remove('active');
        };

        this.boundLogout = () => {
            this.logout();
        };

        header.addEventListener('click', this.boundToggleMenu);
        window.addEventListener('click', this.boundCloseMenu);
        logoutBtn.addEventListener('click', this.boundLogout);
    }

    // --- SSE LOGIC ---

    connectSSE() {
        if (this.evtSource) this.evtSource.close();

        this.evtSource = new EventSource("/sse_subscribe");

        this.evtSource.addEventListener("INIT", (event) => {
            const data = JSON.parse(event.data);
            this.code = data.code;
            this.renderQRCode();
        });

        this.evtSource.addEventListener("NEW_IMAGE", (event) => {
            const data = this.safeParse(event.data);
            if (data?.['image-uuid']) this.callbacks.onNewImage(data);
        });

        this.evtSource.addEventListener("SEARCH_MATCH", (event) => {
            const payload = JSON.parse(event.data);
            this.callbacks.onSearchMatch(payload);
        });

        this.evtSource.addEventListener("SEARCH_PROGRESS", (event) => {
            const payload = JSON.parse(event.data);
            this.callbacks.onSearchProgress(payload.date);
        });

        this.evtSource.addEventListener("SEARCH_COMPLETE", () => {
            this.callbacks.onSearchComplete();
        });

        this.evtSource.onerror = () => {
            console.warn("SSE disconnected. Retrying...");
            this.evtSource.close();
        };
    }

    renderQRCode() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        container.innerHTML = "";
        const portalUrl = `${window.location.origin}/rip?c=${this.code}`;

        new QRCode(container, {
            text: portalUrl,
            width: 180,
            height: 180
        });

        console.log(portalUrl);
    }

    // --- API & FETCH WRAPPER (Centralized) ---

    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http')
            ? endpoint
            : `${window.location.origin}${endpoint}`;

        // Extract our custom flag so it doesn't get sent to the native fetch
        const { isLogoutRequest, ...fetchOptions } = options;

        const defaultOptions = {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            ...fetchOptions // Use the cleaned options here
        };

        try {
            const response = await fetch(url, defaultOptions);

            if (response.status === 401) {
                // Check the flag: if we are already trying to logout, 
                // don't call logout() again (which would trigger another request)
                if (!isLogoutRequest) {
                    this.logout();
                }
                throw new Error("Unauthorized");
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `API Error: ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            // Only trigger the global error callback if it's NOT a 401 on a logout
            // to keep the console clean during exit.
            if (!(isLogoutRequest && err.message === "Unauthorized")) {
                this.callbacks.onError(err);
            }
            throw err;
        }
    }

    // --- SESSION MANAGEMENT ---

    setupActivityListeners() {
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        events.forEach(name =>
            window.addEventListener(name, this.throttledHandler, { passive: true })
        );
    }

    handleActivity() {
        const now = Date.now();
        if (!this.isPinging && (now - this.lastPingTime > this.intervalMs)) {
            this.lastPingTime = now;
            this.executePing();
        }
    }

    async executePing(checkOnly = false) {
        if (this.isPinging || !this.code) return;

        this.isPinging = true;

        if (this.autoLogoutTimer) clearTimeout(this.autoLogoutTimer);

        try {
            const params = new URLSearchParams({ sse_code: this.code });
            if (checkOnly) params.append('check_only', 'true');

            const data = await this.request(`${this.pingUrl}?${params.toString()}`);

            if (data.ttl_ms > 5000) {
                this.autoLogoutTimer = setTimeout(
                    () => this.confirmAndLogout(),
                    data.ttl_ms + 1000
                );
            } else {
                this.logout();
            }
        } catch (err) {
            console.warn("Ping failed, will retry on next user activity.");
        } finally {
            this.isPinging = false;
        }
    }

    async confirmAndLogout() {
        await this.executePing(true);
    }

    async logout() {
        // 1. Prevent multiple simultaneous logout calls
        if (this.isLoggingOut) return;
        this.isLoggingOut = true;

        try {
            // 2. Call the server but mark it as a logout request
            // This prevents the 401 loop
            await this.request(`/request-logout?code=${this.code || ''}`, {
                method: 'POST',
                isLogoutRequest: true
            });
        } catch (err) {
            // We don't care if this fails (e.g., if the token was already dead)
            console.log("Cleanup: Server session already gone or unreachable.");
        } finally {
            // 3. Always clean up the client and redirect
            this.destroy();
            window.location.href = '/';
        }
    }

    // --- UTILS ---

    safeParse(data) {
        try {
            let parsed = JSON.parse(data);
            return typeof parsed === 'string'
                ? JSON.parse(parsed)
                : parsed;
        } catch (e) {
            return null;
        }
    }

    destroy() {
        this.isStarted = false;

        if (this.evtSource) this.evtSource.close();
        if (this.autoLogoutTimer) clearTimeout(this.autoLogoutTimer);

        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        events.forEach(name =>
            window.removeEventListener(name, this.throttledHandler)
        );

        // Remove account menu listeners (NEW cleanup)
        const { headerId, menuId, logoutBtnId } = this.accountMenuConfig;

        const header = document.getElementById(headerId);
        const menu = document.getElementById(menuId);
        const logoutBtn = document.getElementById(logoutBtnId);

        if (header && this.boundToggleMenu)
            header.removeEventListener('click', this.boundToggleMenu);

        if (logoutBtn && this.boundLogout)
            logoutBtn.removeEventListener('click', this.boundLogout);

        if (this.boundCloseMenu)
            window.removeEventListener('click', this.boundCloseMenu);
    }
}
