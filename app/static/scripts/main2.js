import ModeManager from './mod.js';
import CalendarManager from './cal.js';
import WhiteboardManager from './wht.js';
import ImageManager from './img.js';
import ConnectivityManager from './con.js';

function bootstrap() {

    // ==============================
    // 1️⃣ Instantiate Everything
    // ==============================

    const imageManager = new ImageManager();
    const calendar = new CalendarManager();
    const modeManager = new ModeManager();


    const connectivity = new ConnectivityManager({
        containerId: "qrcode-canvas",
        accountHeaderId: "account-header",
        accountMenuId: "logout-menu",
        logoutBtnId: "btn-logout",

        onNewImage: (data) => {
            console.log("New image received:", data);
            whiteboard.attachImageToActiveLi(data['image-uuid']);
        },

        onSearchMatch: (match) => {
            whiteboard.onSearchMatch(match);
        },

        onSearchProgress: (date) => {
            console.log("Search progress:", date);
        },

        onSearchComplete: () => {
            console.log("Search complete");
        },

        onError: (err) => {
            console.error("Connectivity error:", err);
        }
    });

    const whiteboard = new WhiteboardManager({
        request: connectivity.request.bind(connectivity),
        onSaveClick: async (payload) => {
            connectivity.request()
        },
        onSendClick: async (payload) => {},
        onImportClick: async (payload) => {},
        onExportClick: async (payload) => {},
        onAttachClick: (payload) => {},
        onSearchEnter: (query) => {},
        onImageDelete: async (uuid) => {},
        onError: (err) => {},
        showSnackbar: (message) => {}
    });

    // ==============================
    // 2️⃣ Wire Dependencies
    // ==============================

    // Whiteboard → Connectivity (search trigger)
    whiteboard.setupSearchListeners(async (query) => {
        if (!connectivity.code) return;

        console.log(`Starting background search for: ${query}`);

        try {
            // Use centralized request wrapper instead of raw fetch
            await connectivity.request(
                `/history-search?query=${encodeURIComponent(query)}&code=${connectivity.code}`,
                { method: 'POST' }
            );
        } catch (err) {
            console.error("Could not trigger search task.", err);
        }
    });

    // Whiteboard buttons
    whiteboard.onButtonClick('attach', ({ activeLi }) => {
        if (activeLi) {
            imageManager.open(1);
        }
    });

    whiteboard.onButtonClick('import', () => {
        alert("Importing data from last report...");
    });

    // Mode → Calendar
    modeManager.onModeChange((index) => {
        calendar.setMode(index);
    });

    // Calendar → Whiteboard
    calendar.onSelectionChange((selection) => {
        whiteboard.updateView(selection);
    });

    // ImageManager → Whiteboard
    imageManager.onAttach((selectedUuids) => {
        whiteboard.attachImagesToActiveLi(selectedUuids);
    });

    // ==============================
    // 3️⃣ Initialize Last
    // ==============================

    connectivity.init();
}

bootstrap();
