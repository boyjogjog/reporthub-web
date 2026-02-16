import ModeManager from './mod.js';
import CalendarManager from './cal.js';
import WhiteboardManager from './wht.js';
import ImageBucketManager from './buc.js';
import ConnectivityManager from './con.js';


const whiteboard = new WhiteboardManager();
// 1. Listen for the 'Attach' button click
whiteboard.onButtonClick('attach', (data) => {
    if (data.activeLi) {
        bucketManager.open(1);
    }
});

// 2. Listen for 'Import'
whiteboard.onButtonClick('import', () => {
    alert("Importing data from last report...");
});

new ModeManager({
    onModeChange: (index) => {
        calendar.setMode(index);
    }
});

const calendar = new CalendarManager({
    onSelectionChange: (selection) => {
        whiteboard.updateView(selection);
    }
});

const cm = new ConnectivityManager({
    containerId: "qrcode-canvas",

    onImages: (data) => {
        console.log("New image received:", data);
        
        // Example: attach to report editor
        if (whiteboard) {
            whiteboard.attachImageToActiveLi(data['image-uuid']);
        }
    },

    onSearchMatch: (match) => {
        console.log("Search match:", match);
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

cm.init();

const bucketManager = new ImageBucketManager();

// Setup what happens on attachment
bucketManager.onAttach((selectedUuids) => {
    whiteboard.attachImagesToActiveLi(selectedUuids)
});


