// ActivitySession.js
export default class SessionManager {
    constructor(ssePortal) {
        this.pingUrl = `/ping`;
        this.intervalMs = (5 * 60 * 1000); // 5 minute
        this.lastPingTime = 0;
        this.autoLogoutTimer = null;
        this.isStarted = false; // Guard to prevent double-start
        this.isPinging = false; // Guard to prevent double-pings
        this.ssePortal = ssePortal;
        this.throttledHandler = this.handleActivity.bind(this);
    }

    start() {
        if (this.isStarted) return;
            this.isStarted = true;

        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        events.forEach(name => 
            window.addEventListener(name, this.throttledHandler, { passive: true })
        );

        console.log("Session Management Started.");
        this.executePing(); // First sync
    }

    handleActivity() {
        const now = Date.now();
        // Only ping if interval passed AND we aren't already pinging
        if (!this.isPinging && (now - this.lastPingTime > this.intervalMs)) {
            this.lastPingTime = now;
            this.executePing();
        }
    }

    async executePing(checkOnly = false) {
        if (this.isPinging) return;
        this.isPinging = true;
        if (this.autoLogoutTimer) clearTimeout(this.autoLogoutTimer);

        try {
            const url = checkOnly ? `${this.pingUrl}?sse_code=${this.ssePortal.getCode()}&check_only=true` : `${this.pingUrl}?sse_code=${this.ssePortal.getCode()}`;
            const response = await fetch(url, { credentials: 'include' });

            if (response.status === 401) {
                this.logout();
            } else {
                const data = await response.json();
                
                // If we were just checking and found session was refreshed elsewhere
                if (checkOnly && data.ttl_ms > 5000) {
                     this.autoLogoutTimer = setTimeout(() => this.confirmAndLogout(), data.ttl_ms + 1000);
                } 
                // If it was a normal activity ping
                else if (!checkOnly) {
                    this.autoLogoutTimer = setTimeout(() => this.confirmAndLogout(), data.ttl_ms + 1000);
                } else {
                    this.logout();
                }
            }
        } catch (err) {
            console.warn("Ping failed, retrying on activity.");
        } finally {
            this.isPinging = false;
        }
    }

    async confirmAndLogout() {
        // Calls executePing with the check_only flag
        await this.executePing(true);
    }

    logout() {
        this.destroy();
        window.location.href = '/login?expired=true';
    }

    destroy() {
        this.isStarted = false;
        if (this.autoLogoutTimer) clearTimeout(this.autoLogoutTimer);
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        events.forEach(name => window.removeEventListener(name, this.throttledHandler));
    }
}