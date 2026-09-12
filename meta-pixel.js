/**
 * Meta Pixel, behind consent.
 *
 * The pixel sets cookies and sends browsing behaviour to Meta for advertising,
 * which under Danish cookie rules needs the visitor's consent first - so nothing
 * is loaded and no request reaches Meta until someone chooses "Accepter".
 *
 * While PIXEL_ID is empty this file does nothing at all: no banner, no cookies,
 * no network calls. Filling in the ID is what switches it on, and the privacy
 * policy has to be updated in the same breath, because it currently tells
 * visitors the site uses no cookies.
 */
(function () {
    'use strict';

    // The web dataset, from Events Manager. Sixteen digits. Anything starting
    // 120... is a campaign, ad set or ad id, not a dataset - installing one of
    // those is why the pixel first sat idle and Meta reported it inactive.
    const PIXEL_ID = '1037915002396072';

    // 'accepted' | 'declined'. Kept in localStorage rather than a cookie, so
    // remembering the answer does not itself require consent.
    const STORAGE_KEY = 'kolofon_consent';

    const remembered = () => {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    };
    const remember = value => {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* private mode */ }
    };

    let pixelLoaded = false;

    /** Loads Meta's script and reports the current page. Only ever called after consent. */
    function loadPixel() {
        if (pixelLoaded || !PIXEL_ID) return;
        pixelLoaded = true;

        // Meta's own snippet, with their global queue so events fired before the
        // script finishes downloading are not lost
        const fbq = window.fbq = window.fbq || function () {
            fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
        };
        if (!window._fbq) window._fbq = fbq;
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = '2.0';
        fbq.queue = fbq.queue || [];

        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://connect.facebook.net/en_US/fbevents.js';
        document.head.appendChild(script);

        fbq('init', PIXEL_ID);
        fbq('track', 'PageView');
    }

    /**
     * Reports one event, or does nothing if the visitor has not consented.
     *
     * `options.eventID` is worth setting on a purchase: if the same purchase is
     * ever also reported from the server, Meta uses that id to count it once.
     */
    function track(name, params, options) {
        if (!pixelLoaded || typeof window.fbq !== 'function') return;
        try {
            window.fbq('track', name, params || {}, options || undefined);
        } catch (e) {
            // Blocked by an extension, most likely. Never break the page for it.
        }
    }

    function removeBanner() {
        const bar = document.querySelector('.consent-bar');
        if (bar) bar.remove();
    }

    function showBanner() {
        if (document.querySelector('.consent-bar')) return;

        const bar = document.createElement('div');
        bar.className = 'consent-bar';
        bar.setAttribute('role', 'dialog');
        bar.setAttribute('aria-label', 'Samtykke til måling');
        bar.innerHTML = `
            <p class="consent-text">
                Må vi måle, om vores annoncer virker? Det sker med Meta Pixel, som sætter
                cookies og deler din adfærd på siden med Meta. Siden fungerer præcis ens,
                uanset hvad du vælger. <a href="privacy.html">Læs mere</a>
            </p>
            <div class="consent-actions">
                <button type="button" class="consent-btn" data-consent="declined">Afvis</button>
                <button type="button" class="consent-btn consent-btn--accept" data-consent="accepted">Accepter</button>
            </div>
        `;

        bar.addEventListener('click', event => {
            const choice = event.target.getAttribute('data-consent');
            if (!choice) return;
            remember(choice);
            removeBanner();
            if (choice === 'accepted') loadPixel();
        });

        document.body.appendChild(bar);
    }

    function init() {
        // Nothing to consent to until a pixel is configured
        if (!PIXEL_ID) return;

        const choice = remembered();
        if (choice === 'accepted') loadPixel();
        else if (choice !== 'declined') showBanner();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.KolofonPixel = {
        track,
        /** Whether events are being sent, for anything that wants to know. */
        get active() { return pixelLoaded; },
        /** Forgets the previous answer and asks again - for a link in the privacy policy. */
        choose() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            removeBanner();
            if (PIXEL_ID) showBanner();
        },
    };
})();
