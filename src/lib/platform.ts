/**
 * Platform capabilities, for gating features that only exist on one side.
 *
 * Two separate concerns, deliberately kept apart:
 *   - LAYOUT is done with CSS breakpoints (md:), so a narrow desktop window reflows
 *     the same way a phone does and there's no JS to get wrong.
 *   - CAPABILITIES are gated with the flags below, because they're about what the OS
 *     can do, not how wide the window is: Android has no drag-drop source, no native
 *     pasteboard to read paths from, no file manager to reveal into, and no multicast
 *     lock for mDNS.
 *
 * Detected from the user agent rather than an async backend call so the very first
 * render is already correct — a flash of desktop-only buttons on a phone would be
 * worse than the slight inelegance of a UA sniff.
 */
const UA = typeof navigator === 'undefined' ? '' : navigator.userAgent;

/** Running inside the Android WebView. */
export const IS_ANDROID = /\bAndroid\b/i.test(UA);

/** Any mobile target (iOS isn't shipped, but keep the seam honest). */
export const IS_MOBILE = IS_ANDROID || /\b(iPhone|iPad|iPod)\b/.test(UA);

/**
 * Real filesystem paths can be dragged in, pasted from the OS clipboard, and
 * revealed in a file manager. All three are desktop-only: Android hands apps
 * `content://` URIs through the share sheet or picker instead.
 */
export const CAN_USE_FILE_PATHS = !IS_MOBILE;

/** Folder sends need a picker that returns a path; SAF only offers tree URIs. */
export const CAN_PICK_FOLDERS = !IS_MOBILE;

/** Nearby/LAN discovery needs a multicast lock Android doesn't grant us yet. */
export const CAN_USE_NEARBY = !IS_MOBILE;

/** Multiple windows, a menu bar, and ⌘-accelerators. */
export const CAN_USE_WINDOWS = !IS_MOBILE;

/**
 * The product name to show the user. "Croc Desktop" is a lie on a phone, and it
 * leaked into the About screen, the Settings footer and the update banner — so it
 * lives here rather than being spelled out per screen.
 */
export const APP_NAME = IS_MOBILE ? 'Croc Mobile' : 'Croc Desktop';
