import { describe, it, expect } from 'vitest';
import { base62ToHex } from '../../lib/utils/spotifyUtils';

// Spotify ids → the hex GID the native-script lookup also files metadata under.
describe('base62ToHex', () => {
    it('matches librespot\'s published test vector (digits, lowercase, uppercase alphabet)', () => {
        // librespot core/src/spotify_id.rs, CONV_VALID[0]
        expect(base62ToHex('5sWHDYs0csV6RS48xBl0tH')).toBe('b39fe8081e1f4c54be38e8d6f9f12bb9');
        expect(BigInt('0x' + base62ToHex('5sWHDYs0csV6RS48xBl0tH'))).toBe(238762092608182713602505436543891614649n);
    });

    it('returns null for characters outside the alphabet', () => {
        expect(base62ToHex('abc-def')).toBeNull();
    });
});
