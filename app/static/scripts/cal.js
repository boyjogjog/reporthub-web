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
        
        // --- Store selection as Strings now ---
        const today = new Date();
        this.selectedDate = this._formatISO(today); 
        this.selectedRange = this._calculateInitialRange(today);
        
        this.onSelectionChange = config.onSelectionChange || null;

        this._bindInternalControls();
        this._render();
        this._triggerCallback();
    }

    /**
     * Helper to get YYYY-MM-DD without timezone shifts
     */
    _formatISO(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    setMode(index) {
        this.mode = index;
        this._render();
        this._triggerCallback();
    }

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

    _getSelection() {
        const selection = { mode: this.mode, arg: null };
        
        if (this.mode === 0) {
            selection.arg = this.selectedDate; // Returns "2026-02-18"
        } else if (this.mode === 1) {
            selection.arg = this.selectedRange; // Returns "2026-02-01-14"
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
            const cellDateStr = this._formatISO(cellDate);
            
            cell.className = "cal-day";
            cell.textContent = day;

            // Highlight Today
            if (this.mode < 2 && cellDateStr === this._formatISO(new Date())) {
                cell.classList.add("today");
            }

            // Highlight Selected Day (Mode 0)
            if (this.mode === 0 && cellDateStr === this.selectedDate) {
                cell.classList.add("selected");
            }

            // Highlight Selected Range (Mode 1)
            if (this.mode === 1 && this.selectedRange) {
                // Parse the range string (YYYY-MM-DD-DD) to check if cell falls within it
                const parts = this.selectedRange.split('-');
                const startDay = parseInt(parts[2]);
                const endDay = parseInt(parts[3]);
                const rangeMonth = parseInt(parts[1]) - 1;
                const rangeYear = parseInt(parts[0]);

                if (month === rangeMonth && year === rangeYear && day >= startDay && day <= endDay) {
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
            this.selectedDate = this._formatISO(clickedDate);
        } else if (this.mode === 1) {
            this.selectedRange = this._calculateInitialRange(clickedDate);
        }

        this._render();
        this._triggerCallback();
    }

    /**
     * Now returns string like "2026-02-01-14"
     */
    _calculateInitialRange(date) {
        const y = date.getFullYear();
        const m = date.getMonth(); 
        const d = date.getDate();
        const monthStr = String(m + 1).padStart(2, '0');

        const splitDay = (m === 1) ? 14 : 15;

        if (d <= splitDay) {
            return `${y}-${monthStr}-01-${String(splitDay).padStart(2, '0')}`;
        } else {
            const lastDay = new Date(y, m + 1, 0).getDate();
            return `${y}-${monthStr}-${String(splitDay + 1).padStart(2, '0')}-${lastDay}`;
        }
    }

    _triggerCallback() {
        if (this.onSelectionChange) {
            this.onSelectionChange(this._getSelection());
        }
    }
}