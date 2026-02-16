// Spotify Lyrics Extension - Constants

window.SpotifyLyrics = window.SpotifyLyrics || {};

(function () {
    const Constants = {
        LYRICS_CONTAINER: '[style^=--lyrics]',
        LYRIC_SELECTOR: '[data-testid="lyrics-line"]',
        FULLSCREEN_CONTAINER: '[style^=--cinema]',
        SONG_TITLE: '[data-testid="now-playing-widget"]',
        TRANSLATED_LYRIC_CLASS: 'translated-lyric',
        ORIGINAL_LYRIC_CLASS: 'original-lyric',
        ROMANIZED_LYRIC_CLASS: 'romanized-lyric'
    };

    window.SpotifyLyrics.Constants = Constants;
})();
