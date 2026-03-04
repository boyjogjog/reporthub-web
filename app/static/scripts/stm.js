export default class SmoothStreamer {
    constructor(url) {
        this.baseUrl = url;
        this.imgs = [document.getElementById('image-1'), document.getElementById('image-2')];
        this.container = document.getElementById('streamContainer');
        this.currentIndex = 0;
        this.intervalTime = 20000; // Refresh every 20 seconds
        this.init();
    }

    init() {
        this.updateImage();
        setInterval(() => this.updateImage(), this.intervalTime);
    }

    async updateImage() {
        const nextIndex = (this.currentIndex + 1) % 2;
        const currentImg = this.imgs[this.currentIndex];
        const nextImg = this.imgs[nextIndex];

        // 1. Pre-load the next image
        const temp = new Image();
        temp.src = `${this.baseUrl}?t=${Date.now()}`;

        temp.onload = () => {
            const vW = 254; // Viewport Width
            const vH = 180; // Viewport Height
            const buffer = 30; // Increased buffer for safety
            
            let startX = 0, startY = 0;
            let shiftX = 0, shiftY = 0;

            // 2. Calculation Logic
            if (temp.width / temp.height > vW / vH) {
                // LANDSCAPE: Slide Horizontally
                const targetH = vH + buffer;
                nextImg.style.height = `${targetH}px`;
                nextImg.style.width = "auto";
                
                const renderedWidth = (targetH * temp.width) / temp.height;
                
                startX = 0;
                startY = -(buffer / 2); 
                shiftX = -(renderedWidth - vW); 
                shiftY = startY; 
            } else {
                // PORTRAIT: Slide Vertically
                const targetW = vW + buffer;
                nextImg.style.width = `${targetW}px`;
                nextImg.style.height = "auto";
                
                const renderedHeight = (targetW * temp.height) / temp.width;
                
                startX = -(buffer / 2);
                startY = 0;
                shiftX = startX;
                shiftY = -(renderedHeight - vH);
            }

            // 3. APPLY COORDINATES
            // We set the shift variables for the CSS 'to' state
            nextImg.style.setProperty('--shift-x', `${Math.floor(shiftX)}px`);
            nextImg.style.setProperty('--shift-y', `${Math.floor(shiftY)}px`);
            
            // 4. RESET STATE & TRIGGER
            nextImg.src = temp.src;
            nextImg.classList.remove('animating');
            
            // CRITICAL: Force the starting position via inline style BEFORE adding 'animating'
            // This prevents the image from "snapping" from 0,0 to the start point
            nextImg.style.transform = `translate(${Math.floor(startX)}px, ${Math.floor(startY)}px)`;

            void nextImg.offsetWidth; // Force Reflow
            nextImg.classList.add('animating');

            // 5. CROSSFADE
            nextImg.classList.add('active');
            currentImg.classList.remove('active');

            this.currentIndex = nextIndex;

            // 6. CLEANUP
            setTimeout(() => { 
                if (!currentImg.classList.contains('active')) {
                    currentImg.src = ""; 
                    currentImg.classList.remove('animating');
                }
            }, 2000); // Wait for fade to finish
            
            temp.onload = null;
        };
    }
}