/**
 * Kolofon Main JavaScript
 * Handles navigation interactions and product logic.
 */

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initCarousel();
    initCartPage();
    initViewportFix();
    initSlider();
    initPageTransitions();
    initLanguage();
    initTheme();
    updateCartCount();
    initFooterYear();
    initContactPage();
    preloadModels();
    initHomeVideos();
});

function initHomeVideos() {
    const videos = document.querySelectorAll('.home-video-panel video, .text-panel-bg-video');
    if (!videos.length) return;

    videos.forEach(video => {
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.style.opacity = '0';

        const reveal = () => {
            video.style.opacity = '1';
            if (video.classList.contains('text-panel-bg-video')) {
                video.closest('.home-text-panel').classList.add('video-playing');
            }
        };

        // Attach listener before tryPlay so it catches the playing event
        video.addEventListener('playing', reveal, { once: true });

        // HTML autoplay may have already started the video before JS ran
        if (!video.paused) {
            reveal();
            return;
        }

        const tryPlay = () => {
            video.muted = true;
            const p = video.play();
            if (p !== undefined) {
                p.catch(() => {
                    // Autoplay blocked — retry on first user interaction
                    const resume = () => tryPlay();
                    document.addEventListener('touchstart', resume, { once: true });
                    document.addEventListener('click', resume, { once: true });
                });
            }
        };

        tryPlay();
    });
}

// --- SUPABASE CONFIGURATION ---
// Initialize globally so it can be used by Carousel, Cart, and Checkout
const supabaseUrl = 'https://jxprvsfrsnikzkophoty.supabase.co';
const supabaseKey = 'sb_publishable_PBq6r9zAfGDl77RxTzoGlw_NKLHIUP4';
let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
}

// --- CONFIGURATION ---
const SHIPPING_THRESHOLD = 1500;
const SHIPPING_COST_SHOP = 39;
const SHIPPING_COST_HOME = 59;

// --- TRANSLATIONS ---
const TRANSLATIONS = {
    da: {
        nav_home: "Hjem",
        nav_products: "Produkter",
        nav_about: "Om os",
        nav_contact: "Kontakt",
        index_title: "Velkommen til Kolofon.",
        index_text: "Vi forvandler digital præcision til fysisk nærvær og skaber premium akrylvægkunst, der ikke bare observeres, men opleves.",
        slider_text: "Swipe for at Udforske",
        cart_title: "Din Kurv",
        cart_empty: "Din kurv er tom.",
        cart_browse: "Se Kollektion",
        about_title: "Om Kolofon",
        about_text_1: "Kolofon repræsenterer krydsfeltet mellem digital præcision og fysisk nærvær. Vi tror på, at vægkunst ikke bare skal observeres, men opleves.",
        about_text_2: "Vores premium akrylværker er skabt til at fange lys og dybde, hvilket forvandler atmosfæren i ethvert rum. Født ud af et ønske om at bringe gallerikvalitet ind i det moderne hjem, er hvert stykke i vores kollektion et studie i form og funktion.",
        about_text_3: "Vi inviterer dig til at udforske vores kollektion og finde det værk, der resonerer med dit rum.",
        contact_title: "Kontakt Os",
        contact_text: "Har du spørgsmål om en ordre eller en speciel forespørgsel? Vi er her for at hjælpe.",
        contact_message: "Besked",
        contact_send: "Send Besked",
        contact_success: "Tak for din besked. Vi vender tilbage hurtigst muligt.",
        contact_error: "Der opstod en fejl. Prøv venligst igen.",

        // Dynamic strings
        stock_in: "På Lager",
        stock_out: "Ikke på lager",
        stock_left: "På lager ({qty} tilbage)",
        add_to_cart: "Læg i Kurv",
        added: "Tilføjet",
        out_of_stock_msg: "Beklager, denne vare er ikke på lager.",
        low_stock_msg: "Beklager, vi har kun {qty} enheder på lager.",
        checkout_title: "Gå til kassen",
        full_name: "Fulde Navn",
        email: "Email",
        phone: "Telefon",
        address: "Adresse",
        city: "By",
        zip: "Postnummer",
        total: "Total",
        complete_purchase: "Gennemfør Køb",
        cancel: "Annuller",
        processing: "Behandler...",
        thank_you: "Tak!",
        order_received: "Din ordre er modtaget.",
        continue_shopping: "Fortsæt med at handle",
        payment_error: "Der opstod en fejl ved behandlingen af din ordre. Prøv venligst igen.",
        subtotal: "Subtotal",
        shipping: "Fragt",
        shipping_calc: "Beregnes ved kassen",
        checkout_btn: "Gå til kassen",
        shipping_method: "Levering",
        ship_shop: "Pakkeshop (GLS) - 39 kr",
        ship_home: "Hjemmelevering - 59 kr",
        free_shipping: "Gratis fragt",
        select_shop: "Søg Pakkeshops",
        change_shop: "Søg Igen",
        shop_required: "Du skal vælge en pakkeshop for at fortsætte.",
        no_shop_selected: "Ingen pakkeshop valgt",
        loading_shops: "Søger...",
        no_shops_found: "Ingen pakkeshops fundet for dette postnummer.",
        enter_zip_first: "Indtast venligst et postnummer først.",
        shop_fetch_error: "Kunne ikke hente pakkeshops. Prøv igen.",
        remove: "Fjern",
        dimensions: "Dimensioner",
        material: "Materiale",
        footer_contact: "Kontakt",
        footer_follow: "Følg Os",
        footer_legal: "Juridisk",
        footer_terms: "Handelsbetingelser",
        footer_privacy: "Privatlivspolitik",
        footer_rights: "Alle rettigheder forbeholdes.",
        terms_agree: "Jeg accepterer",
        terms_link: "handelsbetingelserne",
        terms_and: "og",
        privacy_link: "privatlivspolitikken"
    },
    en: {
        nav_home: "Home",
        nav_products: "Products",
        nav_about: "About",
        nav_contact: "Contact",
        index_title: "Welcome to Kolofon.",
        index_text: "We transform digital precision into physical presence, creating premium acrylic wall art that is not just observed, but experienced.",
        slider_text: "Swipe to Explore",
        cart_title: "Your Cart",
        cart_empty: "Your cart is empty.",
        cart_browse: "Browse Collection",
        about_title: "About Kolofon",
        about_text_1: "Kolofon represents the intersection of digital precision and physical presence. We believe that wall art should not just be observed, but experienced.",
        about_text_2: "Our premium acrylic pieces are crafted to capture light and depth, transforming the atmosphere of any room. Born from a desire to bring gallery-quality aesthetics into the modern home, every piece in our collection is a study in form and function.",
        about_text_3: "We invite you to explore our collection and find the piece that resonates with your space.",
        contact_title: "Contact Us",
        contact_text: "Have a question about an order or a custom request? We're here to help.",
        contact_message: "Message",
        contact_send: "Send Message",
        contact_success: "Thank you for your message. We will get back to you shortly.",
        contact_error: "Something went wrong. Please try again.",

        // Dynamic strings
        stock_in: "In Stock",
        stock_out: "Out of Stock",
        stock_left: "In Stock ({qty} left)",
        add_to_cart: "Add to Cart",
        added: "Added",
        out_of_stock_msg: "Sorry, this item is out of stock.",
        low_stock_msg: "Sorry, we only have {qty} units of this item in stock.",
        checkout_title: "Checkout",
        full_name: "Full Name",
        email: "Email",
        phone: "Phone",
        address: "Address",
        city: "City",
        zip: "Zip Code",
        total: "Total",
        complete_purchase: "Complete Purchase",
        cancel: "Cancel",
        processing: "Processing...",
        thank_you: "Thank You!",
        order_received: "Your order has been placed successfully.",
        continue_shopping: "Continue Shopping",
        payment_error: "There was an issue processing your order. Please try again.",
        subtotal: "Subtotal",
        shipping: "Shipping",
        shipping_calc: "Calculated at checkout",
        checkout_btn: "Checkout",
        shipping_method: "Delivery",
        ship_shop: "Parcel Shop (GLS) - DKK 39",
        ship_home: "Home Delivery - DKK 59",
        free_shipping: "Free Shipping",
        select_shop: "Search Parcel Shops",
        change_shop: "Search Again",
        shop_required: "You must select a parcel shop to continue.",
        no_shop_selected: "No parcel shop selected",
        loading_shops: "Searching...",
        no_shops_found: "No parcel shops found for this zip code.",
        enter_zip_first: "Please enter a zip code first.",
        shop_fetch_error: "Could not load parcel shops. Please try again.",
        remove: "Remove",
        dimensions: "Dimensions",
        material: "Material",
        footer_contact: "Contact",
        footer_follow: "Follow Us",
        footer_legal: "Legal",
        footer_terms: "Terms and Conditions",
        footer_privacy: "Privacy Policy",
        footer_rights: "All rights reserved.",
        terms_agree: "I agree to the",
        terms_link: "terms and conditions",
        terms_and: "and",
        privacy_link: "privacy policy",

        // Product Descriptions (English overrides)
        desc_1770319091415: "A stringent and pattern-breaking interpretation of Orwell's timeless classic.",
        desc_1770319395363: "A deconstruction of Dostoevsky's great work, depicting the tension between the intellectual and the conscience."
    }
};

let currentLang = localStorage.getItem('kolofon_lang') || 'da';

function t(key, params = {}) {
    let text = TRANSLATIONS[currentLang][key] || key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v);
    }
    return text;
}

/**
 * Initialize Navigation Logic
 * Handles the mobile menu toggle and body scroll locking.
 */
function initNavigation() {
    const menuToggle = document.querySelector('.menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu-overlay');
    const body = document.body;

    if (!menuToggle || !mobileMenu) return;

    menuToggle.addEventListener('click', () => {
        // Clear any swipe-direction transform before opening
        mobileMenu.style.transform = '';
        const isActive = mobileMenu.classList.toggle('active');

        // Lock body scroll when menu is open
        if (isActive) {
            body.style.overflow = 'hidden';
        } else {
            body.style.overflow = '';
        }
    });

    // Close menu when a link is clicked
    const links = document.querySelectorAll('.mobile-link');
    links.forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.remove('active');
            body.style.overflow = '';
        });
    });

    // Close menu on swipe in any direction
    let touchStartX = 0;
    let touchStartY = 0;
    const SWIPE_THRESHOLD = 30;

    mobileMenu.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    mobileMenu.addEventListener('touchend', (e) => {
        if (!mobileMenu.classList.contains('active')) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) {
            // Determine swipe direction for exit animation
            let tx = '100%', ty = '0';
            if (Math.abs(dx) >= Math.abs(dy)) {
                tx = dx > 0 ? '100%' : '-100%';
                ty = '0';
            } else {
                tx = '0';
                ty = dy > 0 ? '100%' : '-100%';
            }
            mobileMenu.style.transform = `translate(${tx}, ${ty})`;
            mobileMenu.classList.remove('active');
            body.style.overflow = '';
        }
    }, { passive: true });
}

/**
 * Initialize Language Logic
 */
function initLanguage() {
    const langBtn = document.getElementById('lang-btn');
    if (!langBtn) return;

    // Set initial button text (If current is DA, button shows EN to switch, and vice versa)
    langBtn.textContent = currentLang === 'da' ? 'EN' : 'DA';

    langBtn.addEventListener('click', () => {
        const newLang = currentLang === 'da' ? 'en' : 'da';
        localStorage.setItem('kolofon_lang', newLang);
        
        // Fade out and reload to apply changes cleanly
        document.body.classList.add('page-fade-out');
        setTimeout(() => {
            window.location.href = window.location.pathname; // More robust reload than location.reload()
        }, 400);
    });
    
    // Apply translations to static elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (TRANSLATIONS[currentLang][key]) {
            el.textContent = TRANSLATIONS[currentLang][key];
        }
    });

    // Handle language-specific links (e.g., terms page)
    document.querySelectorAll('[data-i18n-link="terms"]').forEach(el => {
        el.textContent = t('footer_terms');
    });
}

/**
 * Initialize Theme (Dark/Light Mode) Toggle
 */
function initTheme() {
    const themeBtn = document.getElementById('theme-btn');
    if (!themeBtn) return;

    const moonIcon = themeBtn.querySelector('.icon-moon');
    const sunIcon = themeBtn.querySelector('.icon-sun');

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (moonIcon && sunIcon) {
            moonIcon.style.display = theme === 'dark' ? 'none' : '';
            sunIcon.style.display = theme === 'dark' ? '' : 'none';
        }
    }

    // Apply saved preference (or default to light)
    const savedTheme = localStorage.getItem('kolofon_theme') || 'light';
    applyTheme(savedTheme);

    themeBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem('kolofon_theme', next);
        applyTheme(next);
    });
}

function updateCartCount() {
    const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const bubbles = document.querySelectorAll('.cart-count-bubble');
    bubbles.forEach(bubble => {
        bubble.textContent = count;
        bubble.style.display = count > 0 ? 'flex' : 'none';
    });
}

/**
 * Preload 3D model files into browser cache on non-product pages.
 */
function preloadModels() {
    if (document.querySelector('#product-viewer')) return;
    if (!supabaseClient) return;

    supabaseClient.from('products').select('src').then(({ data }) => {
        if (!data) return;
        data.forEach(p => {
            if (p.src) fetch(p.src, { mode: 'cors' }).catch(() => {});
        });
    });
}

/**
 * Initialize Carousel Logic
 * Handles switching between 3D models and updating product details.
 */
async function initCarousel() {
    const viewer = document.querySelector('#product-viewer');
    const titleEl = document.querySelector('#product-title');
    const authorEl = document.querySelector('#product-author');
    const priceEl = document.querySelector('#product-price');
    const stockEl = document.querySelector('.stock-status');
    const descEl = document.querySelector('.product-description');
    const specValues = document.querySelectorAll('.spec-value'); // [0] is Dimensions, [1] is Material
    const photoEl = document.getElementById('product-photo');
    const photoWrap = document.getElementById('product-photo-wrap');
    const prevBtn = document.querySelector('#prev-btn');
    const nextBtn = document.querySelector('#next-btn');
    const addToCartBtn = document.querySelector('.btn-add-to-cart');
    const btnText = addToCartBtn ? addToCartBtn.querySelector('.btn-text') : null;
    const detailsContent = document.querySelector('.details-content');

    if (!viewer || !prevBtn || !nextBtn) return;

    let products = [];

    try {
        if (!supabaseClient) console.error("DEBUG: Supabase client is missing. Is the script tag in HTML?");

        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('products').select('*').order('id', { ascending: true });
            
            if (error) throw error;
            if (data) {
                // Normalize data (handle lowercase columns from DB)
                products = data.map(p => ({ ...p, stockQuantity: p.stockQuantity ?? p.stockquantity ?? 0 }));
            }
        }
    } catch (err) {
        console.error(
            "CRITICAL: Product fetch from Supabase failed. The public site will be empty. Error details below:",
            err
        );
        document.body.innerHTML += `<div style="position:fixed; top:10px; left:10px; background:red; color:white; padding:10px; z-index:9999;">Supabase connection failed. Check console (F12).</div>`;
    }

    // If no products found in DB, stop initialization
    if (products.length === 0) {
        if (titleEl) titleEl.textContent = "No products found";
        return;
    }

    let currentIndex = 0;

    // Preload all other models into browser cache
    products.forEach((p, i) => {
        if (i !== 0 && p.src) fetch(p.src, { mode: 'cors' }).catch(() => {});
    });

    // On mobile, reset the camera to the initial position after the user stops interacting.
    const resetCameraOnMobile = () => {
        // The breakpoint for desktop is 1024px in style.css
        if (window.innerWidth < 1024) {
            viewer.cameraOrbit = '0deg 75deg 95%';
            viewer.cameraTarget = 'auto auto auto';
            viewer.fieldOfView = 'auto';
        }
    };

    viewer.addEventListener('touchend', resetCameraOnMobile);

    const updateProduct = (index, direction = null) => {
        const product = products[index];
        
        const updateDOM = () => {
            viewer.src = product.src;
            viewer.cameraOrbit = '0deg 75deg 95%';
            titleEl.textContent = product.title;
            if (authorEl) authorEl.textContent = product.author ? `by ${product.author}` : '';
            
            // Format price: DKK 2.000 (Currency followed by sum, with dot separator)
            const priceNum = typeof product.price === 'number' 
                ? product.price 
                : parseFloat(String(product.price).replace(/[^0-9.,]/g, '').replace(',', '.'));
            priceEl.textContent = !isNaN(priceNum) ? `DKK ${priceNum.toLocaleString('da-DK')}` : product.price;
            
            // Update Stock Status
            if (stockEl) {
                const stockQty = product.stockQuantity !== undefined ? product.stockQuantity : 0;
                if (stockQty <= 0) {
                    stockEl.textContent = t('stock_out');
                    stockEl.classList.add('out-of-stock');
                    if (addToCartBtn) addToCartBtn.disabled = true;
                } else {
                    stockEl.textContent = t('stock_left', { qty: stockQty });
                    stockEl.classList.remove('out-of-stock');
                    if (addToCartBtn) addToCartBtn.disabled = false;
                }
            }
            
            // Update Description
            let descriptionText = product.description;
            if (currentLang === 'en') {
                // 1. Check for description_en in database
                if (product.description_en) {
                    descriptionText = product.description_en;
                }
                // 2. Fallback to hardcoded JS object (legacy support)
                else if (TRANSLATIONS.en[`desc_${product.id}`]) {
                    descriptionText = TRANSLATIONS.en[`desc_${product.id}`];
                }
            }
            if (descEl) descEl.textContent = descriptionText;

            // Update Specs (Dimensions & Material)
            if (specValues.length >= 2) {
                specValues[0].textContent = product.dimensions;
                specValues[1].textContent = product.material;
            }

            // Update product photo
            if (photoEl && photoWrap) {
                if (product.photo) {
                    photoEl.src = product.photo;
                    photoEl.alt = product.title;
                    photoWrap.style.display = 'block';
                } else {
                    photoWrap.style.display = 'none';
                    photoEl.src = '';
                }
            }
        };

        const loader = document.getElementById('model-loader');

        if (direction) {
            prevBtn.disabled = true;
            nextBtn.disabled = true;

            const enterClass = direction === 'next' ? 'viewer-enter-right' : 'viewer-enter-left';

            // Immediately hide the old model and show spinner
            if (detailsContent) detailsContent.classList.add('fade-out');
            viewer.style.visibility = 'hidden';
            viewer.style.opacity = '0';
            if (loader) loader.style.display = '';

            updateDOM();

            const onLoaded = () => {
                viewer.removeEventListener('load', onLoaded);

                // Hide spinner
                if (loader) loader.style.display = 'none';

                // Prepare for entry
                viewer.style.transition = 'none';
                viewer.classList.add(enterClass);
                viewer.style.visibility = '';
                viewer.style.opacity = '';
                void viewer.offsetWidth;

                // Animate in
                viewer.style.transition = '';
                viewer.classList.remove(enterClass);
                if (detailsContent) detailsContent.classList.remove('fade-out');

                prevBtn.disabled = false;
                nextBtn.disabled = false;
            };
            viewer.addEventListener('load', onLoaded);
        } else {
            updateDOM();
        }
    };

    prevBtn.addEventListener('click', () => {
        currentIndex = (currentIndex - 1 + products.length) % products.length;
        updateProduct(currentIndex, 'prev');
    });

    nextBtn.addEventListener('click', () => {
        currentIndex = (currentIndex + 1) % products.length;
        updateProduct(currentIndex, 'next');
    });

    // Initialize with the first product
    updateProduct(0);

    // Add to Cart Logic
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () => {
            const product = products[currentIndex];
            // Capture thumbnail from model-viewer before adding to cart
            let thumbnail = null;
            try {
                thumbnail = viewer.toDataURL('image/webp', 0.7);
            } catch (e) {
                try { thumbnail = viewer.toDataURL('image/png'); } catch (_) {}
            }
            if (addToCart(product, thumbnail)) {
                // Visual feedback
                if (btnText && getComputedStyle(btnText).display !== 'none') {
                    const originalText = btnText.textContent;
                    btnText.textContent = t('added');
                    setTimeout(() => { btnText.textContent = originalText; }, 2000);
                } else {
                    // Mobile Icon Feedback
                    addToCartBtn.style.backgroundColor = '#2E7D32'; // Green
                    addToCartBtn.style.transform = 'scale(1.1)';
                    setTimeout(() => { 
                        addToCartBtn.style.backgroundColor = ''; 
                        addToCartBtn.style.transform = '';
                    }, 1000);
                }
            }
        });
    }
}

/**
 * Add Item to Cart (LocalStorage)
 */
function addToCart(product, thumbnail) {
    const stockQty = product.stockQuantity !== undefined ? product.stockQuantity : 0;

    if (stockQty <= 0) {
        alert(t('out_of_stock_msg'));
        return false;
    }

    const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
    const existingItem = cart.find(item => item.id === product.id);

    if (existingItem) {
        if (existingItem.quantity + 1 > stockQty) {
            alert(t('low_stock_msg', { qty: stockQty }));
            return false;
        }
        existingItem.quantity += 1;
        if (thumbnail && !existingItem.thumbnail) existingItem.thumbnail = thumbnail;
    } else {
        // Parse price to number for storage
        const priceNum = typeof product.price === 'number'
            ? product.price
            : parseFloat(String(product.price).replace(/[^0-9.,]/g, '').replace(',', '.'));

        cart.push({
            id: product.id,
            title: product.title,
            priceDisplay: product.price,
            priceValue: isNaN(priceNum) ? 0 : priceNum,
            material: product.material,
            dimensions: product.dimensions,
            thumbnail: thumbnail || null,
            quantity: 1
        });
    }

    localStorage.setItem('kolofon_cart', JSON.stringify(cart));
    updateCartCount();
    return true;
}

/**
 * Initialize Cart Page
 * Renders items from LocalStorage into the cart page.
 */
function initCartPage() {
    const cartContainer = document.querySelector('.cart-container');
    if (!cartContainer) return; // Not on cart page

    // Supabase Edge Function endpoints
    const PICKUP_POINTS_URL = `${supabaseUrl}/functions/v1/pickup-points`;
    const CREATE_PAYMENT_URL = `${supabaseUrl}/functions/v1/create-payment`;

    // Handle return from PensoPay payment page
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
        // Payment confirmed — clear cart and show thank you
        localStorage.removeItem('kolofon_cart');
        updateCartCount();
        cartContainer.innerHTML = `
            <div style="text-align: center; padding: 4rem 0;">
                <h2 style="font-family: var(--font-serif); margin-bottom: 1rem; font-size: 2rem;">${t('thank_you')}</h2>
                <p style="color: #666; margin-bottom: 2rem;">${t('order_received')}</p>
                <a href="products.html" class="btn-primary" style="width: auto; display: inline-flex;">${t('continue_shopping')}</a>
            </div>
        `;
        // Clean URL without reloading
        history.replaceState(null, '', 'cart.html');
        return;
    }
    if (params.get('payment') === 'cancelled') {
        // Customer cancelled — clean URL and show cart normally
        history.replaceState(null, '', 'cart.html');
    }

    const renderCheckout = () => {
        const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
        const subtotal = cart.reduce((sum, item) => sum + (item.priceValue * item.quantity), 0);

        // Default to 'shop' (39 DKK) unless subtotal > 1500 (Free)
        let shippingCost = subtotal > SHIPPING_THRESHOLD ? 0 : SHIPPING_COST_SHOP;
        
        cartContainer.innerHTML = `
            <div class="checkout-form-container" style="max-width: 500px; margin: 0 auto;">
                <h2 style="margin-bottom: 1.5rem; font-family: var(--font-serif); text-align: center;">${t('checkout_title')}</h2>
                <form id="purchase-form">
                    <div class="form-group">
                        <label class="form-label">${t('full_name')}</label>
                        <input type="text" name="fullName" class="form-input" required placeholder="John Doe">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${t('email')}</label>
                        <input type="email" name="email" class="form-input" required placeholder="john@example.com">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${t('phone')}</label>
                        <input type="tel" name="phone" class="form-input" required placeholder="+45 12 34 56 78">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${t('address')}</label>
                        <input type="text" name="address" class="form-input" required placeholder="Street Address">
                    </div>
                    <div class="form-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="form-label">${t('city')}</label>
                            <input type="text" name="city" class="form-input" required placeholder="City">
                        </div>
                        <div>
                            <label class="form-label">${t('zip')}</label>
                            <input type="text" name="zip" class="form-input" required placeholder="Zip">
                        </div>
                    </div>

                    <div class="form-group" style="margin-top: 1.5rem;">
                        <label class="form-label">${t('shipping_method')}</label>
                        <div style="border: 1px solid var(--color-border); border-radius: 4px; overflow: hidden;">
                            <label style="display: flex; align-items: center; padding: 1rem; border-bottom: 1px solid var(--color-border); cursor: pointer; background: var(--color-bg-subtle);">
                                <input type="radio" name="shipping" value="shop" checked style="margin-right: 1rem;">
                                <span>${t('ship_shop')}</span>
                            </label>
                            <label style="display: flex; align-items: center; padding: 1rem; cursor: pointer; background: var(--color-bg-subtle);">
                                <input type="radio" name="shipping" value="home" style="margin-right: 1rem;">
                                <span>${t('ship_home')}</span>
                            </label>
                        </div>
                        
                        <div id="shop-selector-wrapper" style="display: block; margin-top: 1rem; padding: 1rem; background: var(--color-bg-subtle); border-radius: 4px;">
                            <p id="shop-selected-text" style="font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--color-text-muted); font-style: italic;">${t('no_shop_selected')}</p>
                            <button type="button" id="btn-select-shop" class="btn-primary" style="width: auto; font-size: 0.8rem; padding: 0.5rem 1rem;">${t('select_shop')}</button>
                            <div id="shop-list" style="margin-top: 0.75rem; max-height: 300px; overflow-y: auto;"></div>
                            <input type="hidden" name="service_point" id="input-service-point">
                        </div>
                    </div>
                    
                    <div class="summary-total" style="margin: 2rem 0;">
                        <div style="display:flex; justify-content:space-between; font-size: 0.9rem; margin-bottom: 0.5rem; font-weight: normal;"><span>${t('subtotal')}</span><span>DKK ${subtotal.toLocaleString('da-DK')}</span></div>
                        <div style="display:flex; justify-content:space-between; font-size: 0.9rem; margin-bottom: 0.5rem; font-weight: normal;"><span>${t('shipping')}</span><span id="shipping-display">DKK ${shippingCost}</span></div>
                        <div style="display:flex; justify-content:space-between; font-size: 1.25rem; font-weight: 500; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--color-border);"><span>${t('total')}</span><span id="total-display">DKK ${(subtotal + shippingCost).toLocaleString('da-DK')}</span></div>
                    </div>

                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; font-size: 0.875rem; color: var(--color-text-muted); line-height: 1.5;">
                            <input type="checkbox" id="terms-checkbox" required style="margin-top: 0.2rem; flex-shrink: 0;">
                            <span>${t('terms_agree')} <a href="Handelsbetingelser.pdf" target="_blank" style="color: var(--color-text);">${t('terms_link')}</a> ${t('terms_and')} <a href="privacy.html" target="_blank" style="color: var(--color-text);">${t('privacy_link')}</a>.</span>
                        </label>
                    </div>

                    <button type="submit" class="btn-primary full-width">${t('complete_purchase')}</button>
                    <button type="button" id="cancel-checkout" style="background:none; border:none; width:100%; padding:1rem; cursor:pointer; color: #666; text-transform:uppercase; font-size: 0.75rem; letter-spacing: 0.05em; margin-top: 0.5rem;">${t('cancel')}</button>
                </form>
            </div>
        `;

        // Handle Shipping Selection Logic
        const shippingInputs = document.querySelectorAll('input[name="shipping"]');
        const shippingDisplay = document.getElementById('shipping-display');
        const totalDisplay = document.getElementById('total-display');
        const shopWrapper = document.getElementById('shop-selector-wrapper');

        // Custom Shop Selector — fetches GLS pickup points via Supabase proxy
        const shopList = document.getElementById('shop-list');
        const searchBtn = document.getElementById('btn-select-shop');

        const selectShop = (point) => {
            const input = document.getElementById('input-service-point');
            const text = document.getElementById('shop-selected-text');

            const servicePoint = {
                id: point.id || point.number?.toString(),
                name: point.name,
                address: point.address,
                zipcode: point.zipcode,
                city: point.city
            };

            input.value = JSON.stringify(servicePoint);
            text.textContent = `${servicePoint.name}, ${servicePoint.address}, ${servicePoint.zipcode} ${servicePoint.city}`;
            text.style.fontStyle = 'normal';
            text.style.fontWeight = '500';
            searchBtn.textContent = t('change_shop');

            // Highlight selected, dim others
            shopList.querySelectorAll('.shop-option').forEach(el => {
                el.style.background = el.dataset.pointId === servicePoint.id ? 'var(--color-bg-subtle)' : '';
                el.style.borderColor = el.dataset.pointId === servicePoint.id ? 'var(--color-text)' : 'var(--color-border)';
            });
        };

        const fetchPickupPoints = async () => {
            const zip = document.querySelector('input[name="zip"]').value.trim();
            if (!zip || !/^\d{4}$/.test(zip)) {
                alert(t('enter_zip_first'));
                return;
            }

            searchBtn.textContent = t('loading_shops');
            searchBtn.style.opacity = '0.7';
            searchBtn.disabled = true;
            shopList.innerHTML = '';

            try {
                const res = await fetch(`${PICKUP_POINTS_URL}?zipcode=${encodeURIComponent(zip)}`);
                const data = await res.json();

                if (!res.ok || !Array.isArray(data) || data.length === 0) {
                    shopList.innerHTML = `<p style="font-size:0.85rem; color:var(--color-text-muted); padding:0.5rem 0;">${t('no_shops_found')}</p>`;
                    return;
                }

                data.forEach(point => {
                    const id = point.id || point.number?.toString();
                    const dist = point.distance ? `${(point.distance / 1000).toFixed(1)} km` : '';
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'shop-option';
                    el.dataset.pointId = id;
                    el.style.cssText = 'display:block; width:100%; text-align:left; padding:0.75rem; margin-bottom:0.5rem; border:1px solid var(--color-border); border-radius:4px; background:none; cursor:pointer; font-family:inherit; font-size:0.85rem; line-height:1.4; transition: border-color 0.2s;';
                    el.innerHTML = `<strong>${point.name}</strong><br>${point.address}, ${point.zipcode} ${point.city}${dist ? `<br><span style="color:var(--color-text-muted); font-size:0.8rem;">${dist}</span>` : ''}`;
                    el.addEventListener('click', () => selectShop(point));
                    shopList.appendChild(el);
                });
            } catch (err) {
                console.error('Pickup points fetch error:', err);
                shopList.innerHTML = `<p style="font-size:0.85rem; color:#c00; padding:0.5rem 0;">${t('shop_fetch_error')}</p>`;
            } finally {
                searchBtn.textContent = t('select_shop');
                searchBtn.style.opacity = '1';
                searchBtn.disabled = false;
            }
        };

        searchBtn.addEventListener('click', fetchPickupPoints);

        shippingInputs.forEach(input => {
            input.addEventListener('change', (e) => {
                const isShop = e.target.value === 'shop';
                if (shopWrapper) shopWrapper.style.display = isShop ? 'block' : 'none';

                if (subtotal > SHIPPING_THRESHOLD) {
                    shippingCost = 0;
                    shippingDisplay.textContent = t('free_shipping');
                } else {
                    // 39 for shop, 59 for home
                    shippingCost = isShop ? SHIPPING_COST_SHOP : SHIPPING_COST_HOME;
                    shippingDisplay.textContent = `DKK ${shippingCost}`;
                }
                totalDisplay.textContent = `DKK ${(subtotal + shippingCost).toLocaleString('da-DK')}`;
            });
        });
        
        // Trigger initial calculation check for free shipping
        if (subtotal > SHIPPING_THRESHOLD) {
            shippingCost = 0;
            shippingDisplay.textContent = t('free_shipping');
            totalDisplay.textContent = `DKK ${subtotal.toLocaleString('da-DK')}`;
            if (shopWrapper) shopWrapper.style.display = 'block'; // Default is shop
        }

        document.getElementById('purchase-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.textContent;
            
            btn.textContent = t('processing');
            btn.disabled = true;

            // 1. Gather Data
            const formData = new FormData(e.target);
            const customerData = Object.fromEntries(formData.entries());
            const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
            
            // Parse service point if it exists
            const servicePointData = formData.get('service_point') ? JSON.parse(formData.get('service_point')) : null;

            const shippingDetails = {
                method: formData.get('shipping'),
                cost: shippingCost,
                servicePoint: servicePointData
            };

            if (shippingDetails.method === 'shop' && !shippingDetails.servicePoint) {
                alert(t('shop_required'));
                btn.textContent = originalText;
                btn.disabled = false;
                return;
            }

            try {
                // 2. Create PensoPay payment and redirect to hosted payment page
                const res = await fetch(CREATE_PAYMENT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cart, customerData, shippingDetails }),
                });

                const paymentData = await res.json();

                if (!res.ok || !paymentData.payment_link) {
                    throw new Error(paymentData.error || 'Failed to create payment');
                }

                // Redirect customer to PensoPay's hosted payment page
                window.location.href = paymentData.payment_link;

            } catch (error) {
                console.error("Payment failed:", error);
                alert(t('payment_error'));
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });

        document.getElementById('cancel-checkout').addEventListener('click', () => {
            renderCart();
        });
    };

    const renderCart = () => {
        const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
        
        if (cart.length === 0) {
            cartContainer.innerHTML = `<div style="text-align: center; padding: 4rem 0;"><p>${t('cart_empty')}</p><a href="products.html" class="btn-primary" style="margin-top: 1rem; width: auto; display: inline-flex;">${t('cart_browse')}</a></div>`;
            return;
        }

        let html = '<div id="cart-items-list">';
        let total = 0;

        cart.forEach((item, index) => {
            total += item.priceValue * item.quantity;
            html += `
                <div class="cart-item">
                    <div class="cart-item-image">${item.thumbnail
                        ? `<img src="${item.thumbnail}" alt="${item.title}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
                        : '<span style="color:#888;font-size:0.7rem;">IMG</span>'
                    }</div>
                    <div class="cart-item-details">
                        <h3 class="cart-item-title">${item.title}</h3>
                        <p class="cart-item-price">${item.priceDisplay}</p>
                        <p style="font-size: 0.8rem; color: #888; margin-top: 0.25rem;">${item.material} / ${item.dimensions}</p>
                        <div class="cart-quantity-controls">
                            <button class="qty-btn minus" data-index="${index}">-</button>
                            <span class="qty-val">${item.quantity}</span>
                            <button class="qty-btn plus" data-index="${index}">+</button>
                        </div>
                    </div>
                    <button class="cart-remove-btn" data-index="${index}">${t('remove')}</button>
                </div>
            `;
        });

        html += `</div>
            <div class="cart-summary">
                <div class="summary-row"><span>${t('subtotal')}</span><span>DKK ${total.toLocaleString('da-DK')}</span></div>
                <div class="summary-row"><span>${t('shipping')}</span><span style="color: #888;">${t('shipping_calc')}</span></div>
                <div class="summary-total"><span>${t('total')}</span><span>DKK ${total.toLocaleString('da-DK')}</span></div>
                <button id="checkout-btn" class="btn-primary full-width">${t('checkout_btn')}</button>
            </div>
        `;

        cartContainer.innerHTML = html;

        // Attach listener to checkout button
        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                renderCheckout();
            });
        }

        // Attach listeners to quantity buttons
        document.querySelectorAll('.qty-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                const isPlus = e.target.classList.contains('plus');
                
                if (isPlus) {
                    cart[index].quantity++;
                } else {
                    if (cart[index].quantity > 1) {
                        cart[index].quantity--;
                    }
                }
                localStorage.setItem('kolofon_cart', JSON.stringify(cart));
                updateCartCount();
                renderCart();
            });
        });

        // Attach listeners to remove buttons
        document.querySelectorAll('.cart-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                cart.splice(index, 1);
                localStorage.setItem('kolofon_cart', JSON.stringify(cart));
                updateCartCount();
                renderCart();
            });
        });
    };

    renderCart();
}

// Payment and order finalization is now handled server-side by the payment-callback Edge Function.
// The frontend redirects to PensoPay's hosted page, and the callback saves the order after payment confirmation.

/**
 * Initialize Viewport Fix
 * Locks the viewer height in pixels to prevent resizing when mobile address bars retract.
 */
function initViewportFix() {
    const viewerColumn = document.querySelector('.viewer-column');
    if (!viewerColumn) return;

    const setHeight = () => {
        // Only apply this fix on mobile/tablet
        if (window.innerWidth < 1024) {
            // Calculate 62.5% of the initial viewport height and set it as a fixed pixel value.
            // This prevents the element from growing when the address bar disappears.
            const height = window.innerHeight * 0.625;
            viewerColumn.style.height = `${height}px`;
        } else {
            // Reset on desktop so CSS takes over
            viewerColumn.style.height = '';
        }
    };

    // Set immediately on load
    setHeight();

    // Update only if the width changes (e.g., rotating the phone), ignoring vertical resizes caused by scrolling.
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (window.innerWidth !== lastWidth) {
            lastWidth = window.innerWidth;
            setHeight();
        }
    });
}

/**
 * Initialize Footer Year
 * Automatically updates the copyright year.
 */
function initFooterYear() {
    const yearEl = document.getElementById('copyright-year');
    if (yearEl) {
        yearEl.textContent = new Date().getFullYear();
    }
}

/**
 * Initialize Contact Page
 * Handles contact form submission.
 */
function initContactPage() {
    const contactForm = document.getElementById('contact-form');
    if (!contactForm) return;

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = contactForm.querySelector('button[type="submit"]');
        const originalText = btn.textContent;

        btn.textContent = t('processing');
        btn.disabled = true;

        const formData = new FormData(contactForm);
        const submission = Object.fromEntries(formData.entries());

        try {
            if (supabaseClient) {
                const { error } = await supabaseClient
                    .from('contact_messages')
                    .insert([{
                        full_name: submission.name,
                        email: submission.email,
                        message: submission.message
                    }]);
                if (error) throw error;
            }

            alert(t('contact_success'));
            contactForm.reset();
        } catch (error) {
            console.error("Error sending message:", error);
            alert(t('contact_error'));
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

/**
 * Initialize Interactive Slider
 * Handles the "Slide to Explore" functionality on the home page.
 */
function initSlider() {
    const slider = document.getElementById('explore-slider');
    if (!slider) return;

    const thumb = slider.querySelector('.slider-thumb');
    const text = slider.querySelector('.slider-text');
    let isDragging = false;
    let startX = 0;
    let currentX = 0;

    const startDrag = (e) => {
        isDragging = true;
        startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
        thumb.style.transition = 'none'; // Disable transition for direct 1:1 movement
    };

    const onDrag = (e) => {
        if (!isDragging) return;
        
        const clientX = (e.type === 'touchmove') ? e.touches[0].clientX : e.clientX;
        const delta = clientX - startX;
        const maxDrag = slider.offsetWidth - thumb.offsetWidth - 8; // 8px for padding (4px each side)

        // Clamp the drag value
        currentX = Math.max(0, Math.min(delta, maxDrag));
        
        thumb.style.transform = `translateX(${currentX}px)`;
        
        // Fade text based on progress
        const opacity = 1 - (currentX / maxDrag);
        text.style.opacity = opacity;
        text.textContent = t('slider_text'); // Ensure text is translated
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        const maxDrag = slider.offsetWidth - thumb.offsetWidth - 8;

        if (currentX >= maxDrag * 0.9) {
            // Threshold reached - Navigate
            window.location.href = 'products.html';
        } else {
            // Reset
            thumb.style.transition = 'transform 0.3s ease';
            thumb.style.transform = 'translateX(0)';
            text.style.opacity = '1';
        }
    };

    thumb.addEventListener('mousedown', startDrag);
    thumb.addEventListener('touchstart', startDrag);

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag);

    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
}

/**
 * Initialize Page Transitions
 * Creates a fade-out effect when navigating between internal pages.
 */
function initPageTransitions() {
    const body = document.body;

    // Respect user's motion preferences
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) {
        return;
    }

    document.querySelectorAll('a[href]').forEach(link => {
        // Ensure the link is internal and not a hash link
        if (link.hostname === window.location.hostname && link.pathname !== window.location.pathname && !link.getAttribute('href').startsWith('#') && link.target !== '_blank') {
            
            link.addEventListener('click', (e) => {
                // Ignore clicks with modifier keys (e.g., Ctrl+Click to open in new tab)
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                    return;
                }
                
                e.preventDefault();

                body.classList.add('page-fade-out');

                // Wait for the transition to finish before navigating
                setTimeout(() => {
                    window.location.href = link.href;
                }, 400); // This duration should match the CSS transition duration
            });
        }
    });
}