// Spotify Lyrics Extension - Utils Module

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const Utils = {
        isProcessing: false,
        processingTimeout: null,

        /**
         * Executes a callback while ignoring mutation observer events.
         * Used to prevent infinite loops when we modify the DOM.
         * @param {Function} callback 
         */
        ignoreMutations: function (callback) {
            this.isProcessing = true;
            try {
                callback();
            } finally {
                // Ensure we reset after a minimal delay to let the stack clear
                if (this.processingTimeout) clearTimeout(this.processingTimeout);
                this.processingTimeout = setTimeout(() => {
                    this.isProcessing = false;
                }, 0);
            }
        },

        isMutationIgnored: function () {
            return this.isProcessing;
        },

        /**
         * Debounce function to limit the rate at which a function can fire.
         * @param {Function} func 
         * @param {number} wait 
         * @returns {Function}
         */
        debounce: function (func, wait) {
            let timeout;
            return function (...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), wait);
            };
        },

        /**
         * Throttle function to ensure a function is called at most once in a specified time period.
         * @param {Function} func 
         * @param {number} limit 
         * @returns {Function}
         */
        throttle: function (func, limit) {
            let inThrottle;
            return function (...args) {
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        }
    };

    window.SpotifyLyrics.Utils = Utils;
})();
