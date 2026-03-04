import ModeManager from './mod.js';
import CalendarManager from './cal.js';
import WhiteboardManager from './wht.js';
import ImageManager from './img.js';
import ConnectivityManager from './con.js';
import SmoothStreamer from './stm.js';

let importables;

function bootstrap() {

    // ==============================
    // 1️⃣ Instantiate Everything
    // ==============================




    const connectivity = new ConnectivityManager({
        containerId: "qrcode-canvas",
        accountHeaderId: "account-header",
        accountMenuId: "logout-menu",
        logoutBtnId: "btn-logout",

        onNewImage: (data) => {
            whiteboard.attachImagesToActiveLi([data['image-uuid']]);
        },

        onSearchMatch: (match) => {
            whiteboard.onSearchMatch(match);
        },

        onSearchProgress: (date) => {
        },

        onSearchComplete: () => {
            console.log("Search complete");
        },

        onError: (err) => {
            console.error("Connectivity error:", err);
        }
    });

    const imageManager = new ImageManager({
        onFetchFolders: async () => {
            return await connectivity.request('/image-bucket/get-folders');
        },
        onFetchImages: async (folderPath) => {
            const endpoint = `/image-bucket/get-list/${encodeURIComponent(folderPath)}`;
            return await connectivity.request(endpoint);
        }
    });

    const whiteboard = new WhiteboardManager({

        // works for mode 0 = daily, 1 = 2-weekly, 2 = common
        onLoad: async (context) => {
            let endpoint = '';
            if (context.mode === 0)
                endpoint = `/reports/load-daily/${context.arg}`;
            else if (context.mode === 1)
                endpoint = `/reports/load-2weekly/${context.arg}`;
            else if (context.mode === 2)
                endpoint = `/reports/load-common`;

            return await connectivity.request(endpoint, {
                method: 'GET'
            });
        },

        // works for mode 0 = daily, 1 = 2-weekly, 2 = common
        onSave: async (context, payload) => {
            let endpoint = '';
            if (context.mode === 0)
                endpoint = `/reports/save-daily/${context.arg}`;
            else if (context.mode === 1)
                endpoint = `/reports/save-2weekly/${context.arg}`;
            else if (context.mode === 2)
                endpoint = `/reports/save-common`;

            console.log("payload", payload);
            return await connectivity.request(endpoint, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        },

        // only works for mode 1 = daily
        onSend: async (context, reports) => {
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

            try {
                // 1. Manual Parsing to prevent "Day Behind" timezone bug
                // context.arg is "2026-02-19"
                const [year, month, day] = context.arg.split('-').map(Number);

                // Note: JS Months are 0-indexed (January is 0)
                const dateObj = new Date(year, month - 1, day);

                // 2. Extract components safely
                const monthFull = dateObj.toLocaleString('en-US', { month: 'long' });
                const monthNum = month; // We already have this from the split

                const dd = String(day).padStart(2, '0');
                const mm = String(monthNum).padStart(2, '0');
                const yy = String(year).slice(-2);

                // 3. Build File Path
                const filePath = `N:/14. REPORTS/DAILY REPORTS/${year}/${monthNum} ${monthFull} ${year}/Daily activities report ${dd}.${mm}.${yy}.docx`;
                // 4. Clipboard Logic
                if (reports && reports.length > 0) {
                    const clipboardText = reports.map(r => r.text_content).join('\n');
                    await copyToClipboard(clipboardText);
                    showSnackbar("✅ Reports copied to clipboard.")
                }

                if (window.pywebview) {
                    const result = await window.pywebview.api.open_file(filePath);
                    if (result.status !== "success") {
                        alert("Helper Error: " + result.message);
                    }
                }

                const openResult = await openResponse.json();

                if (openResult.status !== "success") {
                    alert("Helper Error: " + openResult.message);
                }

            } catch (error) {
                console.error("Workflow failed:", error);
            }
        },

        onExtract: async (rangeStr, payload) => {
            const compareItems = await connectivity.request(`/reports/extract-imaged/${rangeStr}`);
            const currentUuids = new Set(payload.map(i => i.uuid));
            importables = compareItems.filter(item => !currentUuids.has(item.uuid));
            console.log(importables.length);
            return importables.length;
        },

        // only works for mode 1 = 2-weekly
        onImport: async () => {
            return importables;
        },

        /*
        onExport: async (context) => {
            const overlay = document.getElementById('loading-overlay');

            try {
                overlay.style.display = 'flex';

                const rangeStr = context.arg;

                const response = await fetch(
                    `/reports/generate-report-docx/${encodeURIComponent(rangeStr)}`
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText);
                }

                const blob = await response.blob();

                const url = window.URL.createObjectURL(blob);

                const a = document.createElement("a");
                a.href = url;
                a.download = `2-Weekly_Report_${rangeStr}.docx`;
                document.body.appendChild(a);
                a.click();

                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

            } catch (err) {
                console.error("Export error:", err);
                alert("Export failed.");
            } finally {
                overlay.style.display = 'none';
            }
        },
        */
        
        // only works for mode 1 = 2-weekly
        onExport: async (context) => {
            const overlay = document.getElementById('loading-overlay');

            try {
                // 1. Show the overlay
                overlay.style.display = 'flex';

                // 2. Call the Python wrapper
                // We use a small delay so the overlay definitely appears before the request starts
                await new Promise(resolve => setTimeout(resolve, 100));

                const result = await pywebview.api.generate_and_open_report(
                    context.arg,
                    "", // You can make this dynamic based on context if needed
                    connectivity.department.toLowerCase()
                );

                // 3. Handle result
                if (result.status === "success") {
                    console.log("Report opened successfully");
                } else {
                    alert("Export failed: " + result.message);
                }

            } catch (err) {
                console.error("Critical Error:", err);
                alert("An unexpected error occurred during generation.");
            } finally {
                // 4. Always hide the overlay at the end
                overlay.style.display = 'none';
            }
        },
        

        // works for mode 0 = daily, mode 1 = 2-weekly
        onAttach: async () => {
            // open(1) now returns the promise that resolves 
            // when either handleAction('attach') or close() is called.
            const selectedUuids = await imageManager.open(1);
            return selectedUuids;
        },

        onMagnify: async (allUuids, currentIndex) => {
            imageManager.magnifyImage(allUuids, allUuids[currentIndex]);
        },

        // only works for mode 3 = search history
        onSearch: async (query) => {
            console.log(query);
            try {
                // 'connectivity' is your instance of ConnectivityManager
                const params = new URLSearchParams({
                    query: query,
                    code: connectivity.code // Uses the SSE session code
                });

                // Fire and forget (the results come back via SSE listeners)
                await connectivity.request(`/reports/history-search?${params.toString()}`, {
                    method: 'POST'
                });

            } catch (err) {
                console.error("Search trigger failed:", err);
                whiteboard.showSnackbar("❌ Could not start search.");
            }
        },

        onError: (err) => { },
        showSnackbar: (message) => { }
    });

    const calendar = new CalendarManager({

        onSelectionChange: (selection) => {
            whiteboard.changeContext(selection);
        }

    });

    new ModeManager({
        onModeChange: (index) => {
            calendar.setMode(index);
        }
    });

    new SmoothStreamer('/image-bucket/next-image');

    // ==============================
    // 3️⃣ Initialize Last
    // ==============================

    connectivity.init();
    imageManager.setDepartment(connectivity.department);
}

function showSnackbar(message) {
    const snack = document.getElementById("snackbar");
    if (!snack) return;
    snack.textContent = message;
    snack.className = "show";
    setTimeout(() => { snack.className = snack.className.replace("show", ""); }, 3000);
}

bootstrap();


