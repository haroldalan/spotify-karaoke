// Spotify Lyrics Extension - Shimmer Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const Shimmer = {
        /**
         * Adds a shimmer effect to the given element.
         * @param {HTMLElement} element 
         */
        add: function (element) {
            if (element && !element.classList.contains('lyrics-shimmer')) {
                element.classList.add('lyrics-shimmer');
            }
        },

        /**
         * Removes the shimmer effect from the given element.
         * @param {HTMLElement} element 
         */
        remove: function (element) {
            if (element && element.classList.contains('lyrics-shimmer')) {
                element.classList.remove('lyrics-shimmer');
            }
        }
    };

    window.SpotifyLyrics.Shimmer = Shimmer;
})();
