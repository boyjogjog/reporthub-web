import ModeManager from './mod.js';
import CalendarManager from './cal.js';
import WhiteboardManager from './wht.js';
import ImageManager from './img.js';
import ConnectivityManager from './con.js';


const whiteboard = new WhiteboardManager();
whiteboard.setupSearchListeners(async (query) => {
    const code = cm.code;
    
    console.log(`Starting background search for: ${query}`);

    try {
        // Drop and forget: we don't await the actual search completion, 
        // just the confirmation that the task started.
        await fetch(`/history-search?query=${encodeURIComponent(query)}&code=${code}`, {
            method: 'POST'
        });
    } catch (err) {
        console.error("Connectivity error: could not trigger search task.");
    }
});
// 1. Listen for the 'Attach' button click
whiteboard.onButtonClick('attach', (data) => {
    if (data.activeLi) {
        imageManager.open(1);
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
        
        if (whiteboard) {
            whiteboard.attachImageToActiveLi(data['image-uuid']);
        }
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

cm.init();

const imageManager = new ImageManager();

// Setup what happens on attachment
imageManager.onAttach((selectedUuids) => {
    whiteboard.attachImagesToActiveLi(selectedUuids)
});

function setupAccountMenu() {
    const header = document.getElementById('account-header');
    const menu = document.getElementById('logout-menu');
    const logoutBtn = document.getElementById('btn-logout');

    // Toggle menu
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('active');
    });

    // Close menu when clicking anywhere else
    window.addEventListener('click', () => {
        menu.classList.remove('active');
    });

    // Logout action
    logoutBtn.addEventListener('click', () => {
        // You can use your ConnectivityManager to destroy the session first
        if (this.connectivityManager) {
            this.connectivityManager.logout();
        } else {
            window.location.href = '/login?logout=true';
        }
    });
}

setupAccountMenu();
