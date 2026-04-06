/**
 * Developer Console Welcome Banner
 * Displays ASCII art and platform info when the app loads
 * Similar to ChatGPT, OpenAI, and other major platforms
 */

const SCHOOLS24_ASCII = `
 ███████╗ ██████╗██╗  ██╗ ██████╗  ██████╗ ██╗     ███████╗██████╗ ██╗  ██╗
 ██╔════╝██╔════╝██║  ██║██╔═══██╗██╔═══██╗██║     ██╔════╝╚════██╗██║  ██║
 ███████╗██║     ███████║██║   ██║██║   ██║██║     ███████╗ █████╔╝███████║
 ╚════██║██║     ██╔══██║██║   ██║██║   ██║██║     ╚════██║██╔═══╝ ╚════██║
 ███████║╚██████╗██║  ██║╚██████╔╝╚██████╔╝███████╗███████║███████╗     ██║
 ╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚══════╝     ╚═╝
`;

const SECURITY_WARNING = `
⚠️  SECURITY WARNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This browser feature is intended for developers. If someone told you
to copy-paste something here, it's likely a scam. Pasting malicious
code could give attackers access to your account.

Never share your authentication tokens or paste code you don't understand.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

const PLATFORM_INFO = `
📚 Schools24 - Education Management Platform

🔗 Quick Links:
   • Documentation: https://docs.schools24.com
   • Support: support@schools24.com

💡 Tip: Use %cSchools24.debug()%c in console to toggle debug mode.

© 2026 Schools24 Education Systems. All rights reserved.
`;

let isInitialized = false;

export function initConsoleWelcome(): void {
    // Prevent double initialization
    if (isInitialized || typeof window === 'undefined') return;
    isInitialized = true;

    // Clear console for clean presentation
    console.clear();

    // ASCII Banner with white styling
    console.log(
        '%c' + SCHOOLS24_ASCII,
        'color: #ffffff; ' +
        'font-family: monospace; ' +
        'font-size: 10px; ' +
        'font-weight: bold;'
    );

    // Security Warning in red
    console.log(
        '%c' + SECURITY_WARNING,
        'color: #ef4444; font-weight: bold; font-size: 12px; font-family: system-ui;'
    );

    // Platform Info with styled inline elements
    console.log(
        '%c' + PLATFORM_INFO,
        'color: #64748b; font-size: 11px; font-family: system-ui;',
        'color: #ffffff; font-family: monospace; background: #1c1917; padding: 2px 6px; border-radius: 3px;',
        'color: #64748b; font-size: 11px;'
    );

    // Add global debug helper
    (window as any).Schools24 = {
        debug: () => {
            const current = localStorage.getItem('Schools24_debug') === 'true';
            localStorage.setItem('Schools24_debug', (!current).toString());
            console.log(`%c🔧 Debug mode ${!current ? 'enabled' : 'disabled'}`, 'color: #ffffff; font-weight: bold;');
            return !current;
        },
        version: () => {
            console.log('%c📦 Schools24 v1.0.0', 'color: #ffffff; font-weight: bold;');
            console.log('%c   Build: Production', 'color: #64748b;');
            console.log('%c   Environment: ' + (process.env.NODE_ENV || 'development'), 'color: #64748b;');
        },
        help: () => {
            console.log('%c📖 Available Commands:', 'color: #ffffff; font-weight: bold; font-size: 13px;');
            console.log('%c   Schools24.debug()   - Toggle debug mode', 'color: #64748b;');
            console.log('%c   Schools24.version() - Show version info', 'color: #64748b;');
            console.log('%c   Schools24.help()    - Show this help', 'color: #64748b;');
        }
    };
}
