export default class CalendarManager {
    constructor(config) {
        // DOM Elements
        this.container = document.querySelector('.widget.calendar');
        this.grid = document.getElementById('calendarGrid');
        this.label = document.getElementById('monthYear');
        this.prevBtn = document.getElementById('prevMonth');
        this.nextBtn = document.getElementById('nextMonth');
        
        // Internal State
        this.mode = 0; 
        this.viewDate = new Date(); 
        this.selectedDate = new Date();
        this.selectedRange = this._calculateInitialRange(new Date());
        
        // 1. MOUNT CALLBACK IMMEDIATELY
        // We store it so we can call it later
        this.onSelectionChange = config.onSelectionChange || null;

        // 2. Initialize controls and initial UI
        this._bindInternalControls();

        this._render();
        
        // Optional: Trigger initial selection so the app loads data on startup
        this._triggerCallback();
    }

    /**
     * Set the current mode (0: Daily, 1: 2-Weekly, 2: Common)
     */
    setMode(index) {
        this.mode = index;
        this._render();
        this._triggerCallback();
    }

    /**
     * Internal: Attaches listeners to the prev/next buttons
     */
    _bindInternalControls() {
        if (this.prevBtn) {
            this.prevBtn.onclick = () => {
                this.viewDate.setMonth(this.viewDate.getMonth() - 1);
                this._render();
            };
        }
        if (this.nextBtn) {
            this.nextBtn.onclick = () => {
                this.viewDate.setMonth(this.viewDate.getMonth() + 1);
                this._render();
            };
        }
    }

    /**
     * Returns the current selection based on mode
     */
    _getSelection() {
        const selection = { mode: this.mode, value: null };
        
        if (this.mode === 0) {
            selection.value = this.selectedDate;
        } else if (this.mode === 1) {
            selection.value = this.selectedRange;
        }
        
        return selection;
    }

    _render() {
        this.grid.innerHTML = "";
        
        if (this.mode > 1) {
            this.container.style.pointerEvents = "none";
            this.container.style.userSelect = "none";
        } else {
            this.container.style.pointerEvents = "auto";
            this.container.style.userSelect = "auto";
        }

        const year = this.viewDate.getFullYear();
        const month = this.viewDate.getMonth();

        if (this.label) {
            this.label.textContent = this.viewDate.toLocaleString("default", { 
                month: "long", year: "numeric" 
            });
        }

        const firstDay = new Date(year, month, 1).getDay();
        const lastDate = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < firstDay; i++) {
            this.grid.appendChild(document.createElement("div"));
        }

        for (let day = 1; day <= lastDate; day++) {
            const cell = document.createElement("div");
            const cellDate = new Date(year, month, day);
            cell.className = "cal-day";
            cell.textContent = day;

            if (this.mode < 2 && cellDate.toDateString() === new Date().toDateString()) {
                cell.classList.add("today");
            }

            if (this.mode === 0 && cellDate.toDateString() === this.selectedDate.toDateString()) {
                cell.classList.add("selected");
            }

            if (this.mode === 1 && this.selectedRange) {
                if (cellDate >= this.selectedRange[0] && cellDate <= this.selectedRange[1]) {
                    cell.classList.add("selected");
                }
            }

            cell.onclick = () => this._handleDayClick(day);
            this.grid.appendChild(cell);
        }
    }

    _handleDayClick(day) {
        const clickedDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), day);

        if (this.mode === 0) {
            this.selectedDate = clickedDate;
        } else if (this.mode === 1) {
            this.selectedRange = this._calculateInitialRange(clickedDate);
        }

        this._render();
        this._triggerCallback();
    }

    _calculateInitialRange(date) {
        const y = date.getFullYear();
        const m = date.getMonth(); // 0 = Jan, 1 = Feb...
        const d = date.getDate();

        // Determine the split day: 14 for February, 15 for all other months
        const splitDay = (m === 1) ? 14 : 15;

        if (d <= splitDay) {
            return [new Date(y, m, 1), new Date(y, m, splitDay)];
        } else {
            const lastDay = new Date(y, m + 1, 0).getDate();
            return [new Date(y, m, splitDay + 1), new Date(y, m, lastDay)];
        }
    }

    _triggerCallback() {
        if (this.onSelectionChange) {
            this.onSelectionChange(this._getSelection());
        }
    }
}