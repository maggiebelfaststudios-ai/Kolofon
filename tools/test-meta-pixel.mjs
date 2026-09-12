/**
 * Checks meta-pixel.js under a stubbed browser.
 *
 * The property that matters legally is that nothing reaches Meta before someone
 * chooses "Accepter" - no script tag, no fbq, no cookie. That is what most of
 * these assert, by watching whether a script element is ever added.
 *
 * Usage: node tools/test-meta-pixel.mjs
 */
import { readFileSync } from 'node:fs';

const source = readFileSync('meta-pixel.js', 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

/**
 * Loads the module with a fake page. `pixelId` stands in for the constant that
 * is filled in once Meta's dataset ID is known; `stored` is a previous answer.
 */
function load({ pixelId = '', stored = null } = {}) {
    const scripts = [];
    const store = new Map();
    if (stored) store.set('kolofon_consent', stored);

    const makeEl = tag => ({
        tagName: tag,
        _children: [],
        _listeners: {},
        className: '',
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        set innerHTML(html) { this._html = html; },
        get innerHTML() { return this._html || ''; },
        appendChild(child) { this._children.push(child); return child; },
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        remove() { this._removed = true; },
        // Clicking one of the banner's buttons: the handler reads data-consent
        click(choice) {
            (this._listeners.click || []).forEach(fn => fn({ target: { getAttribute: k => (k === 'data-consent' ? choice : null) } }));
        },
    });

    const body = makeEl('body');
    const head = {
        appendChild(el) { scripts.push(el); return el; },
    };

    const doc = {
        readyState: 'complete',
        body,
        head,
        createElement: makeEl,
        addEventListener() {},
        querySelector: sel => (sel === '.consent-bar' ? (body._children.find(c => c.className === 'consent-bar' && !c._removed) || null) : null),
    };

    const win = {};
    const sandbox = {
        window: win,
        document: doc,
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
        console: { log() {}, warn() {} },
    };

    // Substitute whatever the constant currently holds, so every scenario -
    // including "switched off" - stays testable after a real ID ships.
    const prepared = source.replace(/const PIXEL_ID = '[^']*';/, `const PIXEL_ID = '${pixelId}';`);
    const keys = Object.keys(sandbox);
    new Function(...keys, prepared)(...keys.map(k => sandbox[k]));

    const banner = () => body._children.find(c => c.className === 'consent-bar' && !c._removed) || null;
    const metaScripts = () => scripts.filter(el => String(el.src || '').includes('connect.facebook.net'));
    return { win, body, banner, metaScripts, store, doc };
}

const ID = '123456789012345';

console.log('\nno pixel configured (switched off)');
{
    const t = load();
    ok('shows no banner', t.banner() === null);
    ok('loads nothing from Meta', t.metaScripts().length === 0);
    ok('defines no fbq', typeof t.win.fbq === 'undefined');
    t.win.KolofonPixel.track('Purchase', { value: 950 });
    ok('track() is harmless', typeof t.win.fbq === 'undefined' && t.metaScripts().length === 0);
    ok('stores nothing', t.store.size === 0, [...t.store.keys()].join(','));
}

console.log('\nfirst visit, pixel configured');
{
    const t = load({ pixelId: ID });
    ok('asks for a choice', t.banner() !== null);
    ok('loads nothing from Meta yet', t.metaScripts().length === 0);
    ok('defines no fbq yet', typeof t.win.fbq === 'undefined');
    ok('offers both answers', /data-consent="declined"/.test(t.banner().innerHTML) && /data-consent="accepted"/.test(t.banner().innerHTML));
    t.win.KolofonPixel.track('ViewContent', { value: 950 });
    ok('an event before the choice sends nothing', typeof t.win.fbq === 'undefined');
}

console.log('\nvisitor declines');
{
    const t = load({ pixelId: ID });
    t.banner().click('declined');
    ok('banner goes away', t.banner() === null);
    ok('remembers the refusal', t.store.get('kolofon_consent') === 'declined');
    ok('still loads nothing from Meta', t.metaScripts().length === 0);
    t.win.KolofonPixel.track('Purchase', { value: 950 });
    ok('later events send nothing', typeof t.win.fbq === 'undefined');
}

console.log('\nvisitor accepts');
{
    const t = load({ pixelId: ID });
    t.banner().click('accepted');
    ok('banner goes away', t.banner() === null);
    ok('remembers the consent', t.store.get('kolofon_consent') === 'accepted');
    ok('loads Meta once', t.metaScripts().length === 1, t.metaScripts().length + ' scripts');
    const calls = t.win.fbq.queue;
    ok('initialises with the dataset id', calls.some(c => c[0] === 'init' && c[1] === ID), JSON.stringify(calls));
    ok('reports the page', calls.some(c => c[0] === 'track' && c[1] === 'PageView'));

    t.win.KolofonPixel.track('Purchase', { value: 950, currency: 'DKK' }, { eventID: 'KOL-1' });
    const purchase = t.win.fbq.queue.find(c => c[1] === 'Purchase');
    ok('reports a purchase with its value', purchase && purchase[2].value === 950 && purchase[2].currency === 'DKK', JSON.stringify(purchase));
    ok('passes the order id for de-duplication', purchase && purchase[3] && purchase[3].eventID === 'KOL-1', JSON.stringify(purchase && purchase[3]));
}

console.log('\nreturning visitor');
{
    const accepted = load({ pixelId: ID, stored: 'accepted' });
    ok('who accepted: no banner, pixel loads', accepted.banner() === null && accepted.metaScripts().length === 1);

    const declined = load({ pixelId: ID, stored: 'declined' });
    ok('who declined: no banner, nothing loads', declined.banner() === null && declined.metaScripts().length === 0);
}

console.log('\nchanging your mind');
{
    const t = load({ pixelId: ID, stored: 'declined' });
    t.win.KolofonPixel.choose();
    ok('asks again', t.banner() !== null);
    ok('forgets the old answer', !t.store.has('kolofon_consent'));
}

console.log('\nthe file as it ships');
{
    const shipped = (source.match(/const PIXEL_ID = '([^']*)';/) || [])[1];
    ok('has a dataset id set', /^[0-9]{15,20}$/.test(shipped || ''),
        shipped === '' ? 'empty - the pixel is switched off' : 'value: ' + shipped);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
