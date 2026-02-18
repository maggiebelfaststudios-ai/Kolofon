import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get('Pensopay-Signature') || '';

    // Verify callback signature using HMAC-SHA256
    const PRIVATE_KEY = Deno.env.get('PENSOPAY_PRIVATE_KEY');
    if (!PRIVATE_KEY) {
      console.error('PENSOPAY_PRIVATE_KEY not configured');
      return new Response('Server error', { status: 500 });
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(PRIVATE_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const computedSignature = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedSignature !== signature) {
      console.error('Invalid callback signature');
      return new Response('Invalid signature', { status: 403 });
    }

    const payload = JSON.parse(body);
    console.log('PensoPay callback received:', payload.event, 'payment:', payload.resource_id);

    const event = payload.event || '';
    const isAuthorized = event.includes('authorized');
    const isCaptured = event.includes('captured');

    if (!isAuthorized && !isCaptured) {
      console.log('Ignoring event:', event);
      return new Response('OK', { status: 200 });
    }

    const resource = payload.resource || {};
    const variables = resource.variables || {};

    // Parse stored order data from variables
    let cart, customerData, shippingDetails;
    try {
      cart = JSON.parse(variables.cart || '[]');
      customerData = JSON.parse(variables.customer || '{}');
      shippingDetails = JSON.parse(variables.shipping || '{}');
    } catch (e) {
      console.error('Failed to parse order variables:', e);
      return new Response('Invalid order data', { status: 400 });
    }

    if (!cart.length || !customerData.email) {
      console.error('Missing cart or customer data in variables');
      return new Response('Missing order data', { status: 400 });
    }

    // Initialize Supabase client
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Calculate totals
    const subtotal = cart.reduce((sum: number, item: any) => sum + (item.priceValue * item.quantity), 0);
    const total = subtotal + (shippingDetails.cost || 0);

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const itemList = cart.map((item: any) => `${item.title} x${item.quantity} — DKK ${item.priceValue * item.quantity}`).join('\n');
    const shippingLabel = shippingDetails.method === 'shop'
      ? `Pakkeshop — ${shippingDetails.servicePoint?.name}`
      : 'Hjemmelevering';

    if (isAuthorized) {
      // Save order to database
      const { error: orderError } = await supabase.from('orders').insert([{
        email: customerData.email,
        total: total,
        items: cart,
        status: 'new',
        payment_status: 'authorized',
        customer_details: { ...customerData, shipping: shippingDetails },
        pensopay_id: resource.id?.toString(),
        order_id: resource.order_id,
      }]);

      if (orderError) {
        console.error('Failed to save order:', orderError);
        return new Response('Database error', { status: 500 });
      }

      // Decrement stock
      for (const item of cart) {
        await supabase.rpc('decrement_stock', { row_id: item.id, quantity_sold: item.quantity });
      }

      console.log(`Order saved: ${resource.order_id}, total: ${total} DKK`);

      // Notify admin
      if (RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'Kolofon Orders <onboarding@resend.dev>',
            to: 'simonlsamuelsen@gmail.com',
            subject: `New order — ${resource.order_id} — DKK ${total}`,
            text: `New order received!\n\nOrder ID: ${resource.order_id}\nCustomer: ${customerData.fullName} (${customerData.email})\nTotal: DKK ${total}\n\nItems:\n${itemList}\n\nShipping: ${shippingLabel}\n\nLog in to PensoPay to capture the payment.`,
          }),
        }).catch(err => console.error('Failed to send admin email:', err));
      }
    }

    if (isCaptured) {
      // Update order status in database
      await supabase
        .from('orders')
        .update({ payment_status: 'captured' })
        .eq('order_id', resource.order_id);

      console.log(`Payment captured: ${resource.order_id}`);

      // Send customer confirmation email
      if (RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'Kolofon Orders <onboarding@resend.dev>',
            to: customerData.email,
            subject: `Ordrebekræftelse — ${resource.order_id}`,
            text: `Hej ${customerData.fullName},\n\nTak for din ordre! Vi har modtaget din betaling og er i gang med at klargøre din forsendelse.\n\nOrdre ID: ${resource.order_id}\nTotal: DKK ${total}\n\nVarer:\n${itemList}\n\nLevering: ${shippingLabel}\n\nDu vil modtage en besked, når pakken er afsendt.\n\nMed venlig hilsen\nKolofon`,
          }),
        }).catch(err => console.error('Failed to send customer email:', err));
      }
    }

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('Callback processing error:', err);
    return new Response('Server error', { status: 500 });
  }
});
