/**
 * The address printed on the legal documents and in the landing page footer.
 *
 * A one-line module, for a bundling reason rather than a tidiness one. The
 * landing page needs this string and nothing else legal; importing it from
 * legalContent.ts pulled that module - and with it the privacy policy and terms
 * in BOTH languages - into the entry chunk, because the landing page is part of
 * the first screen while every other reader of those documents is lazy. That
 * was 14.6 kB of prose (7.4 kB over the wire) downloaded before anything could
 * render, so that a footer could say "support@…".
 *
 * Keep it importable without dragging prose along: nothing else belongs here.
 */
export const LEGAL_CONTACT_EMAIL = "support@equomu.com";
