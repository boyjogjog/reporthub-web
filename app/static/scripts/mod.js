/**
 * ModeManager - Handles the navigation state and visual transitions.
 * One file, one class.
 */
export default class ModeManager {
    constructor(config) {
        // DOM Elements
        this.segmentedButtons = document.querySelectorAll('.segmented button');
        this.slider = document.getElementById('segmented-slider');
        this.searchBtn = document.querySelector('.search-btn');
        
        // Callback passed from main.js
        this.onModeChange = config.onModeChange || null;

        this._bindEvents();
    }

    /**
     * Internal: Attach listeners to the DOM elements
     */
    _bindEvents() {
        // Handle Segmented Buttons (Daily, 2-Weekly, Common)
        this.segmentedButtons.forEach((btn, index) => {
            btn.onclick = () => this.updateMode(index);
        });

        // Handle Search History Button separately (Mode index 3)
        if (this.searchBtn) {
            this.searchBtn.onclick = () => this.updateMode(3);
        }
    }

    /**
     * Updates UI state and notifies the rest of the app
     */
    updateMode(index) {
        // 1. Update Segmented Buttons Visuals
        this.segmentedButtons.forEach((btn, i) => {
            btn.classList.toggle('active', i === index);
        });

        // 2. Handle the Slider (Only moves for the first 3 buttons)
        if (this.slider) {
            if (index < 3) {
                this.slider.style.opacity = "1";
                this.slider.style.transform = `translateX(${index * 100}%)`;
            } else {
                this.slider.style.opacity = "0"; // Hide slider if Search is active
            }
        }

        // 3. Update Search Button Visual (Optional styling)
        if (this.searchBtn) {
            this.searchBtn.classList.toggle('active-search', index === 3);
        }

        // 4. Notify Main Dashboard
        if (typeof this.onModeChange === 'function') {
            this.onModeChange(index);
        }
    }
}