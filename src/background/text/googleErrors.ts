/** Google asked us to slow down (429, or a redirect to its "unusual traffic" CAPTCHA page). */
export class RateLimited extends Error {}
