export default class SSEPortal {
    constructor({ containerId = "qrcode-canvas", onImages, onError } = {}) {
        this.container = document.getElementById(containerId);
        this.evtSource = null;
        this.code = null;
        this.onImages = onImages || ((uuids) => {});
        this.onError = onError || ((err) => console.error(err));
    }

    init() {
        try {
            // --- STEP 1: START SSE SUBSCRIPTION ---
            if (this.evtSource) this.evtSource.close();

            console.log("SSE: Connecting to /sse_subscribe...");
            this.evtSource = new EventSource("/sse_subscribe");

            this.evtSource.onopen = () => console.log("SSE: Connection Established!");
            
            this.evtSource.addEventListener("init", (event) => {
                console.log("INIT EVENT RECEIVED:", event.data);
                try {
                    const data = JSON.parse(event.data);
                    this.code = data.code;
                    //sse_code = this.code;

                    // --- STEP 2: RENDER QR CODE ---
                    this.container.innerHTML = "";
                    const portalUrl = `${window.location.origin}/rip?c=${this.code}`;
                    console.log(portalUrl);
                    new QRCode(this.container, {
                        text: portalUrl,
                        width: 180,
                        height: 180,
                    });
                } catch (err) {
                    console.error(err);
                    this.onError(err);
                }
            });

            // --- NE EVENT ---
            this.evtSource.addEventListener("new_image", (event) => {
                try {
                    let data = JSON.parse(event.data);

                    // Handle double-stringification if necessary
                    if (typeof data === 'string') {
                        data = JSON.parse(data);
                    }

                    // Logic check: We expect an object with the 'image-uuid' key now
                    if (data && typeof data === 'object' && data['image-uuid']) {
                        // Pass the dictionary directly to the handler
                        this.onImages(data);
                    } else {
                        console.error("Unexpected format. Expected dictionary with image-uuid, received:", data);
                    }
                } catch (err) {
                    this.onError(err);
                }
            });

            // --- 3. SEARCH MATCH EVENT (Integrated) ---
            this.evtSource.addEventListener("SEARCH_MATCH", (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    // payload.data contains: {uuid, date, text, image_uuids}
                    this.onSearchMatch(payload.data);
                } catch (err) {
                    console.error("Search Match Parse Error:", err);
                }
            });

            // --- 4. SEARCH PROGRESS EVENT (Integrated) ---
            this.evtSource.addEventListener("SEARCH_PROGRESS", (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    this.onSearchProgress(payload.date);
                } catch (err) {
                    console.error(err);
                }
            });

            // --- 5. SEARCH COMPLETE EVENT (Integrated) ---
            this.evtSource.addEventListener("SEARCH_COMPLETE", () => {
                this.onSearchComplete();
            });

            // --- ERROR HANDLING ---
            this.evtSource.onerror = () => {
                console.log("SSE disconnected (upload finished or network issue).");
                this.evtSource.close();
            };



        } catch (err) {
            console.error("PortalStreamer Error:", err);
            this.container.innerHTML = "<p class='err'>Sync Error</p>";
            this.onError(err);
        }
    }

    close() {
        if (this.evtSource) {
            this.evtSource.close();
            this.evtSource = null;
        }
    }

    getCode() {
        return this.code;
    }
}
