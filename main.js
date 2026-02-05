/**
 * Kolofon Main JavaScript
 * Handles navigation interactions and product logic.
 */

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initProductLogic();
    initCarousel();
    initCartPage();
    initViewportFix();
    initSlider();
    initPageTransitions();
    updateCartCount();
});

// --- SUPABASE CONFIGURATION ---
// Initialize globally so it can be used by Carousel, Cart, and Checkout
const supabaseUrl = 'https://jxprvsfrsnikzkophoty.supabase.co';
const supabaseKey = 'sb_publishable_PBq6r9zAfGDl77RxTzoGlw_NKLHIUP4';
let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
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
}

/**
 * Initialize Product Logic
 * Placeholder for Add to Cart functionality and Model interactions.
 */
function initProductLogic() {
    // Logic moved to initCarousel to access product data
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
    const prevBtn = document.querySelector('#prev-btn');
    const nextBtn = document.querySelector('#next-btn');
    const addToCartBtn = document.querySelector('.btn-add-to-cart');
    const btnText = addToCartBtn ? addToCartBtn.querySelector('.btn-text') : null;
    const detailsContent = document.querySelector('.details-content');

    if (!viewer || !prevBtn || !nextBtn) return;

    let products = [];

    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('products').select('*').order('id', { ascending: true });
            
            if (error) throw error;
            if (data) {
                // Normalize data (handle lowercase columns from DB)
                products = data.map(p => ({ ...p, stockQuantity: p.stockQuantity ?? p.stockquantity ?? 0 }));
            }
        }
    } catch (err) {
        console.warn('Supabase fetch failed (using local fallback):', err);
    }

    // Fallback to local file if DB fetch failed or returned empty
    if (products.length === 0) {
        products = (typeof PRODUCT_CATALOG !== 'undefined') ? PRODUCT_CATALOG : [];
        const storedProducts = localStorage.getItem('kolofon_products');
        if (storedProducts) products = JSON.parse(storedProducts);
    }

    let currentIndex = 0;

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
            const rawPrice = product.price.toString().replace(/\D/g, '');
            const priceNum = parseInt(rawPrice, 10);
            priceEl.textContent = !isNaN(priceNum) ? `DKK ${priceNum.toLocaleString('da-DK')}` : product.price;
            
            // Update Stock Status
            if (stockEl) {
                const stockQty = product.stockQuantity !== undefined ? product.stockQuantity : 0;
                if (stockQty <= 0) {
                    stockEl.textContent = 'Out of Stock';
                    stockEl.classList.add('out-of-stock');
                    if (addToCartBtn) addToCartBtn.disabled = true;
                } else {
                    stockEl.textContent = `In Stock (${stockQty} left)`;
                    stockEl.classList.remove('out-of-stock');
                    if (addToCartBtn) addToCartBtn.disabled = false;
                }
            }
            
            // Update Description
            if (descEl) descEl.textContent = product.description;

            // Update Specs (Dimensions & Material)
            if (specValues.length >= 2) {
                specValues[0].textContent = product.dimensions;
                specValues[1].textContent = product.material;
            }
        };

        if (direction) {
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            
            // 1. Determine Animation Classes
            // Next -> Exit Left, Enter Right
            // Prev -> Exit Right, Enter Left
            const exitClass = direction === 'next' ? 'viewer-exit-left' : 'viewer-exit-right';
            const enterClass = direction === 'next' ? 'viewer-enter-right' : 'viewer-enter-left';

            if (detailsContent) detailsContent.classList.add('fade-out');
            viewer.classList.add(exitClass);
            
            setTimeout(() => {
                updateDOM();
                
                // Prepare for entry (instant move)
                viewer.classList.remove(exitClass);
                viewer.classList.add(enterClass);
                
                // Force Reflow to apply the instant move
                void viewer.offsetWidth;
                
                // Animate In
                viewer.classList.remove(enterClass);
                if (detailsContent) detailsContent.classList.remove('fade-out');
                
                prevBtn.disabled = false;
                nextBtn.disabled = false;
            }, 400);
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
            if (addToCart(product)) {
                // Visual feedback
                if (btnText && getComputedStyle(btnText).display !== 'none') {
                    const originalText = btnText.textContent;
                    btnText.textContent = 'Added';
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
function addToCart(product) {
    const stockQty = product.stockQuantity !== undefined ? product.stockQuantity : 0;
    
    if (stockQty <= 0) {
        alert("Sorry, this item is out of stock.");
        return false;
    }

    const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
    const existingItem = cart.find(item => item.id === product.id);

    if (existingItem) {
        if (existingItem.quantity + 1 > stockQty) {
            alert(`Sorry, we only have ${stockQty} units of this item in stock.`);
            return false;
        }
        existingItem.quantity += 1;
    } else {
        // Parse price to number for storage
        const rawPrice = product.price.toString().replace(/\D/g, '');
        const priceNum = parseInt(rawPrice, 10);

        cart.push({
            id: product.id,
            title: product.title,
            priceDisplay: product.price,
            priceValue: isNaN(priceNum) ? 0 : priceNum,
            material: product.material,
            dimensions: product.dimensions,
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

    const renderCheckout = () => {
        const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');
        const total = cart.reduce((sum, item) => sum + (item.priceValue * item.quantity), 0);

        cartContainer.innerHTML = `
            <div class="checkout-form-container" style="max-width: 500px; margin: 0 auto;">
                <h2 style="margin-bottom: 1.5rem; font-family: var(--font-serif); text-align: center;">Checkout</h2>
                <form id="purchase-form">
                    <div class="form-group">
                        <label class="form-label">Full Name</label>
                        <input type="text" name="fullName" class="form-input" required placeholder="John Doe">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" name="email" class="form-input" required placeholder="john@example.com">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Address</label>
                        <input type="text" name="address" class="form-input" required placeholder="Street Address">
                    </div>
                    <div class="form-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label class="form-label">City</label>
                            <input type="text" name="city" class="form-input" required placeholder="City">
                        </div>
                        <div>
                            <label class="form-label">Zip Code</label>
                            <input type="text" name="zip" class="form-input" required placeholder="Zip">
                        </div>
                    </div>
                    
                    <div class="summary-total" style="margin: 2rem 0;">
                        <span>Total</span>
                        <span>DKK ${total.toLocaleString('da-DK')}</span>
                    </div>

                    <button type="submit" class="btn-primary full-width">Complete Purchase</button>
                    <button type="button" id="cancel-checkout" style="background:none; border:none; width:100%; padding:1rem; cursor:pointer; color: #666; text-transform:uppercase; font-size: 0.75rem; letter-spacing: 0.05em; margin-top: 0.5rem;">Cancel</button>
                </form>
            </div>
        `;

        document.getElementById('purchase-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.textContent;
            
            btn.textContent = 'Processing...';
            btn.disabled = true;

            // 1. Gather Data
            const formData = new FormData(e.target);
            const customerData = Object.fromEntries(formData.entries());
            const cart = JSON.parse(localStorage.getItem('kolofon_cart') || '[]');

            try {
                // 2. Simulate Payment API (Replace this line with real API call later)
                await simulatePaymentAPI(customerData, cart);

                // 3. Handle Success (Inventory & UI)
                await finalizeOrder(cart, customerData);

                cartContainer.innerHTML = `
                    <div style="text-align: center; padding: 4rem 0;">
                        <h2 style="font-family: var(--font-serif); margin-bottom: 1rem; font-size: 2rem;">Thank You!</h2>
                        <p style="color: #666; margin-bottom: 2rem;">Your order has been placed successfully.</p>
                        <a href="products.html" class="btn-primary" style="width: auto; display: inline-flex;">Continue Shopping</a>
                    </div>
                `;
            } catch (error) {
                console.error("Payment failed:", error);
                alert("There was an issue processing your order. Please try again.");
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
            cartContainer.innerHTML = '<div style="text-align: center; padding: 4rem 0;"><p>Your cart is empty.</p><a href="products.html" class="btn-primary" style="margin-top: 1rem; width: auto; display: inline-flex;">Browse Collection</a></div>';
            return;
        }

        let html = '<div id="cart-items-list">';
        let total = 0;

        cart.forEach((item, index) => {
            total += item.priceValue * item.quantity;
            html += `
                <div class="cart-item">
                    <div class="cart-item-image" style="background-color: #eee; display: flex; align-items: center; justify-content: center; color: #888; font-size: 0.7rem;">IMG</div> 
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
                    <button class="cart-remove-btn" data-index="${index}">Remove</button>
                </div>
            `;
        });

        html += `</div>
            <div class="cart-summary">
                <div class="summary-row"><span>Subtotal</span><span>DKK ${total.toLocaleString('da-DK')}</span></div>
                <div class="summary-row"><span>Shipping</span><span style="color: #888;">Calculated at checkout</span></div>
                <div class="summary-total"><span>Total</span><span>DKK ${total.toLocaleString('da-DK')}</span></div>
                <button id="checkout-btn" class="btn-primary full-width">Checkout</button>
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

/**
 * Simulate Payment API
 * This acts as a placeholder for Stripe/PayPal integration.
 */
function simulatePaymentAPI(customerData, cart) {
    return new Promise((resolve) => {
        console.log("Processing payment for:", customerData);
        console.log("Items:", cart);
        
        // Simulate network delay
        setTimeout(() => {
            resolve({ success: true, transactionId: 'TXN-' + Date.now() });
        }, 1500);
    });
}

/**
 * Finalize Order
 * Handles local inventory updates and clearing the cart.
 */
async function finalizeOrder(cart, customerData) {
    // 1. Save Order to Supabase
    if (supabaseClient) {
        const total = cart.reduce((sum, item) => sum + (item.priceValue * item.quantity), 0);
        
        // Insert the order record
        await supabaseClient.from('orders').insert([{
            email: customerData.email,
            total: total,
            items: cart,
            customer_details: customerData
        }]);

        // 2. Update Stock in Supabase (Simple client-side decrement)
        for (const item of cart) {
            // We fetch the specific product first to ensure we have the latest stock count
            const { data: product } = await supabaseClient.from('products').select('stockQuantity').eq('id', item.id).single();
            
            if (product) {
                const newStock = Math.max(0, (product.stockQuantity || 0) - item.quantity);
                await supabaseClient.from('products').update({ stockQuantity: newStock }).eq('id', item.id);
            }
        }
    }

    // 3. Fallback: Update LocalStorage Inventory (keeps the local fallback in sync)
    let inventory = (typeof PRODUCT_CATALOG !== 'undefined') ? PRODUCT_CATALOG : [];
    const storedInventory = localStorage.getItem('kolofon_products');
    if (storedInventory) inventory = JSON.parse(storedInventory);

    cart.forEach(cartItem => {
        const product = inventory.find(p => p.id === cartItem.id);
        if (product) product.stockQuantity = Math.max(0, (product.stockQuantity || 0) - cartItem.quantity);
    });
    
    localStorage.setItem('kolofon_products', JSON.stringify(inventory));
    localStorage.removeItem('kolofon_cart');
    updateCartCount();
}

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
        if (link.hostname === window.location.hostname && link.pathname !== window.location.pathname && !link.getAttribute('href').startsWith('#')) {
            
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