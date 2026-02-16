// Spotify Lyrics Extension - UI Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const State = window.SpotifyLyrics.State;
    const Processor = window.SpotifyLyrics.Processor; // Will be available when called

    const UI = {
        injectionTimeout: null,

        createControls: function () {
            const container = document.createElement('div');
            container.className = 'spotify-lyrics-controls';
            container.className = 'spotify-lyrics-controls';

            const labels = [
                { name: 'Original', id: 'original' },
                { name: 'Romanized', id: 'romanized' },
                { name: 'Translated', id: 'translated' }
            ];

            labels.forEach((item) => {
                const btn = document.createElement('button');
                btn.className = 'spotify-lyrics-btn';
                btn.innerText = item.name;
                btn.dataset.mode = item.id;

                if (item.id === State.currentMode) btn.classList.add('active');

                btn.addEventListener('click', () => {
                    console.log(`[Spotify Lyrics Extension] Switched to ${item.name}`);
                    this.switchMode(item.id);
                });

                container.appendChild(btn);
            });

            return container;
        },

        switchMode: function (newMode) {
            State.saveMode(newMode);
            this.updateButtons(newMode);

            // Re-apply logic
            if (window.SpotifyLyrics.Processor) {
                window.SpotifyLyrics.Processor.applyModeToAll();
            }

            if (window.SpotifyLyrics.Attribution) {
                window.SpotifyLyrics.Attribution.update();
            }
        },

        updateButtons: function (activeMode) {
            const buttons = document.querySelectorAll('.spotify-lyrics-btn');
            buttons.forEach(btn => {
                if (btn.dataset.mode === activeMode) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        },

        injectControls: function () {
            const lyricsLines = document.querySelectorAll('[data-testid="lyrics-line"]');
            if (lyricsLines.length === 0) return;

            const firstLine = lyricsLines[0];
            const lyricsContainer = firstLine.parentElement;

            if (!lyricsContainer) return;

            // Try to inject into the parent of the lyrics container
            const targetContainer = lyricsContainer.parentElement || lyricsContainer;

            if (document.querySelector('.spotify-lyrics-controls')) return;

            console.log("[Spotify Lyrics Extension] Injecting controls...");
            const controls = this.createControls();

            if (targetContainer !== lyricsContainer) {
                targetContainer.insertBefore(controls, lyricsContainer);
            } else {
                targetContainer.insertBefore(controls, targetContainer.firstChild);
            }

            // After injection, we should ensure the Observer is started (if not already)
            if (window.SpotifyLyrics.Observer) {
                window.SpotifyLyrics.Observer.startLyricsObserver();
            }

            // Re-apply logic
            if (window.SpotifyLyrics.Processor) {
                window.SpotifyLyrics.Processor.applyModeToAll();
            }
        },

        scheduleInjection: function () {
            if (this.injectionTimeout) return;
            this.injectionTimeout = setTimeout(() => {
                this.injectControls();
                this.injectionTimeout = null;
            }, 1000); // 1-second throttle
        }
    };

    window.SpotifyLyrics.UI = UI;
})();
