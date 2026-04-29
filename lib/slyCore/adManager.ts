// Port of: lyric-test/modules/core/ad-manager.js

export interface SlyAdManager {
  messages: string[];
  getAdMessage(): string;
}

declare global {
  interface Window {
    slyAdManager: SlyAdManager;
  }
}

/**
 * Registry of humorous messages displayed in the status HUD during ad breaks.
 */
export const slyAdManager: SlyAdManager = {
  messages: [
    "🎵 Ads hitting different... without lyrics.",
    "💸 Spotify Premium: lyrics during ads.",
    "⏸️ Ad break. Lyrics on pause.",
    "🎤 Even ads need a moment of silence.",
    "📻 Commercial break. Karaoke resumes shortly.",
    "🎶 Hold tight. The music (and lyrics) will return.",
    "🛑 Ad detected. Suspending lyric sync.",
    "☕ Good time for a coffee. Lyrics coming back soon.",
  ],

  getAdMessage(): string {
    return this.messages[Math.floor(Math.random() * this.messages.length)];
  },
};

window.slyAdManager = slyAdManager;
