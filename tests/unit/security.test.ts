// @vitest-environment node
import { describe, it, expect } from 'vitest';
import configObject from '../../wxt.config';

// The WXT defineConfig returns the config object (or a promise of one if async, but here it's sync)
// Since wxt.config.ts relies on the `wxt` import which is strictly parsed during build time,
// we just analyze the static exported properties we care about here.

describe('Security and Permissions Audit', () => {
    it('should not contain any broad root host permissions (like *://*/*)', () => {
        // We expect the manifest to be present in our config object
        const manifest = (configObject as any).manifest;
        expect(manifest).toBeDefined();

        const hosts = manifest.host_permissions || [];

        // Test that broad permissions like *://*/* or <all_urls> do NOT exist
        expect(hosts).not.toContain('<all_urls>');
        expect(hosts).not.toContain('*://*/*');
        expect(hosts).not.toContain('http://*/*');
        expect(hosts).not.toContain('https://*/*');
    });

    it('should only ask for strictly necessary permissions', () => {
        const manifest = (configObject as any).manifest;
        const permissions = manifest.permissions || [];

        // The only permission this extension needs is storage 
        // to save user preferences.
        expect(permissions).toHaveLength(1);
        expect(permissions).toContain('storage');

        // Explicitly deny sensitive permissions
        expect(permissions).not.toContain('tabs');
        expect(permissions).not.toContain('history');
        expect(permissions).not.toContain('cookies');
        expect(permissions).not.toContain('webRequest');
        expect(permissions).not.toContain('webRequestBlocking');
    });

    it('should not inject scripts into unapproved domains', () => {
        const webAccessible = (configObject as any).manifest.web_accessible_resources || [];
        expect(webAccessible.length).toBe(1);

        // The fetch interceptor MUST ONLY match open.spotify.com
        const interceptorObj = webAccessible[0];
        expect(interceptorObj.matches).toEqual(['*://open.spotify.com/*']);
    });
});
