import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SITE_URL = 'https://www.kolofon.dk';

// Shipping rates. These must match the values shown in main.js, but they are
// deliberately duplicated here: the browser's figure cannot be trusted, so the
// charge is worked out from these, not from anything the page sends.
const SHIPPING_THRESHOLD = 1500;
const SHIPPING_COST_SHOP = 39;
const SHIPPING_COST_HOME = 59;

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const { cart, customerData, shippingDetails } = await req.json();

    // Validate required fields
    if (!cart || !cart.length || !customerData || !shippingDetails) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const PENSOPAY_API_KEY = Deno.env.get('PENSOPAY_API_KEY');
    if (!PENSOPAY_API_KEY) {
      return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Price the order from the database, never from the browser ----
    //
    // The cart arrives from the shopper's own localStorage, so its prices are
    // whatever that browser says they are. Taking them at face value would let
    // anyone pay 1 kr for a 950 kr piece. Look every item up instead and use
    // only the id and quantity the page sent.

    const ids = [...new Set(cart.map((item: any) => item.id))];

    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, title, price, stockQuantity')
      .in('id', ids);

    if (productError) {
      console.error('Could not load products for pricing:', productError);
      return new Response(JSON.stringify({ error: 'Could not price order' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const byId = new Map((products || []).map((p: any) => [String(p.id), p]));

    let subtotal = 0;
    const verifiedCart: any[] = [];

    for (const item of cart) {
      const product = byId.get(String(item.id));

      if (!product) {
        console.warn('Cart contained an unknown product:', item.id);
        return new Response(JSON.stringify({ error: 'Ukendt vare i kurven' }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      // Quantity is the shopper's to choose, but it must be a sane whole number
      const quantity = Math.floor(Number(item.quantity));
      if (!Number.isFinite(quantity) || quantity < 1) {
        return new Response(JSON.stringify({ error: 'Ugyldigt antal' }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const stock = product.stockQuantity ?? 0;
      if (quantity > stock) {
        console.warn(`Order refused: ${quantity} of ${product.title} requested, ${stock} in stock`);
        return new Response(JSON.stringify({ error: 'Ikke nok på lager' }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      // price is stored as text, e.g. "950"
      const price = parseFloat(String(product.price).replace(/[^0-9.,]/g, '').replace(',', '.'));
      if (!Number.isFinite(price)) {
        console.error('Product has an unusable price:', product.id, product.price);
        return new Response(JSON.stringify({ error: 'Could not price order' }), {
          status: 500,
          headers: corsHeaders,
        });
      }

      subtotal += price * quantity;

      // Pass the verified figures on, so the callback records and emails the
      // real prices rather than the ones the browser claimed.
      verifiedCart.push({
        ...item,
        title: product.title,
        priceValue: price,
        priceDisplay: `DKK ${price.toLocaleString('da-DK')}`,
        quantity,
      });
    }

    // ---- Shipping, also worked out here rather than trusted ----
    const method = shippingDetails.method === 'home' ? 'home' : 'shop';
    const shippingCost = subtotal > SHIPPING_THRESHOLD
      ? 0
      : (method === 'home' ? SHIPPING_COST_HOME : SHIPPING_COST_SHOP);

    if (method === 'shop' && !shippingDetails.servicePoint) {
      return new Response(JSON.stringify({ error: 'Vælg venligst en pakkeshop' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const verifiedShipping = {
      method,
      cost: shippingCost,
      servicePoint: shippingDetails.servicePoint || null,
    };

    const totalDKK = subtotal + shippingCost;
    const totalOere = Math.round(totalDKK * 100);

    // Generate unique order ID
    const orderId = `KOL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Build the callback URL (Supabase Edge Function)
    const callbackUrl = `${SUPABASE_URL}/functions/v1/payment-callback`;

    // Store order data as variables so the callback can access it
    const variables = {
      cart: JSON.stringify(verifiedCart),
      customer: JSON.stringify(customerData),
      shipping: JSON.stringify(verifiedShipping),
    };

    // Create PensoPay payment
    const response = await fetch('https://api.pensopay.com/v2/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PENSOPAY_API_KEY}`,
      },
      body: JSON.stringify({
        order_id: orderId,
        amount: totalOere,
        currency: 'DKK',
        callback_url: callbackUrl,
        success_url: `${SITE_URL}/cart.html?payment=success&order_id=${orderId}`,
        cancel_url: `${SITE_URL}/cart.html?payment=cancelled`,
        autocapture: true,
        locale: 'da_DK',
        variables: variables,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('PensoPay create payment error:', data);
      return new Response(JSON.stringify({ error: 'Failed to create payment' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    console.log(`Payment created: ${data.id}, order: ${orderId}, amount: ${totalOere} øre`);

    // Return the payment link URL for frontend redirect
    return new Response(JSON.stringify({
      payment_id: data.id,
      payment_link: data.link,
      order_id: orderId,
    }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
