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

    /** Tells Simon when something went wrong that the logs alone would bury. */
    const alertAdmin = async (subject: string, text: string) => {
      if (!RESEND_API_KEY) return;
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: 'Kolofon <ordre@kolofon.dk>', to: 'simonlsamuelsen@gmail.com', subject, text }),
        });
      } catch (err) {
        console.error('Could not even send the alert:', err);
      }
    };

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

      // 23505 is the unique index on order_id: this exact order is already
      // recorded, so the gateway is simply sending the callback again. Saying
      // OK stops it retrying; carrying on would book a second order and take
      // the stock down twice.
      if (orderError && (orderError as { code?: string }).code === '23505') {
        console.log(`Callback repeated for ${resource.order_id}; already recorded, nothing to do`);
        return new Response('OK', { status: 200 });
      }

      if (orderError) {
        console.error('Failed to save order:', orderError);
        // The customer has paid. Without this the only trace is a log nobody
        // reads, and the order would exist only inside PensoPay.
        await alertAdmin(
          `ORDER NOT SAVED - ${resource.order_id}`,
          `A payment went through but the order could not be written to the database.\n\n`
          + `Order ID: ${resource.order_id}\nPensoPay payment: ${resource.id}\n`
          + `Customer: ${customerData.fullName} (${customerData.email})\nTotal: DKK ${total}\n\n`
          + `Items:\n${itemList}\n\nDatabase said: ${orderError.message}\n\n`
          + `Check the payment in PensoPay and record the order by hand.`,
        );
        return new Response('Database error', { status: 500 });
      }

      // Decrement stock. A failure here leaves the shop offering something it
      // has already sold, so it does not get to fail quietly either.
      for (const item of cart) {
        const { error: stockError } = await supabase.rpc('decrement_stock', { row_id: item.id, quantity_sold: item.quantity });
        if (stockError) {
          console.error('Stock not reduced for', item.id, stockError);
          await alertAdmin(
            `STOCK NOT REDUCED - ${resource.order_id}`,
            `Order ${resource.order_id} was saved, but the stock count for "${item.title}" (id ${item.id}) could not be reduced by ${item.quantity}.\n\n`
            + `Correct it in the admin page, or the shop will keep offering a piece that is sold.\n\nDatabase said: ${stockError.message}`,
          );
        }
      }

      console.log(`Order saved: ${resource.order_id}, total: ${total} DKK`);

      // Notify admin
      if (RESEND_API_KEY) {
        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: 'Kolofon <ordre@kolofon.dk>',
              to: 'simonlsamuelsen@gmail.com',
              subject: `New order — ${resource.order_id} — DKK ${total}`,
              text: `New order received!\n\nOrder ID: ${resource.order_id}\nCustomer: ${customerData.fullName} (${customerData.email})\nTotal: DKK ${total}\n\nItems:\n${itemList}\n\nShipping: ${shippingLabel}\n\nThe amount is reserved, not yet drawn. Pressing "Marker afsendt" books the parcel and takes the payment.`,
            }),
          });
          if (!emailRes.ok) {
            console.error('Admin email rejected by Resend:', emailRes.status, await emailRes.text());
          }
        } catch (err) {
          console.error('Failed to send admin email:', err);
        }
      }
    }

    if (isCaptured) {
      // The money is taken on the day the parcel is booked, so this arrives
      // long after the order was saved. If it somehow arrives first, no row
      // matches - and saying so lets the gateway try again in a moment rather
      // than leaving the order stuck on "authorized" for good.
      const { data: updated, error: updateError } = await supabase
        .from('orders')
        .update({ payment_status: 'captured' })
        .eq('order_id', resource.order_id)
        .select('order_id');

      if (updateError) {
        console.error('Could not mark the order captured:', updateError);
        return new Response('Database error', { status: 500 });
      }

      if (!updated || !updated.length) {
        console.warn(`Capture arrived before the order existed: ${resource.order_id}`);
        return new Response('Order not recorded yet', { status: 500 });
      }

      console.log(`Payment captured: ${resource.order_id}`);
    }

    // The confirmation belongs to the order, not to the money changing hands.
    // Under our own terms the agreement is struck when this email arrives, so
    // it goes out as soon as the order is recorded.
    if (isAuthorized) {
      if (RESEND_API_KEY) {
        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: 'Kolofon <ordre@kolofon.dk>',
              to: customerData.email,
              subject: `Ordrebekræftelse — ${resource.order_id}`,
              text: `Hej ${customerData.fullName},\n\nTak for din ordre! Jeg er i gang med at klargøre din forsendelse.\n\nOrdre ID: ${resource.order_id}\nTotal: DKK ${total}\n\nVarer:\n${itemList}\n\nLevering: ${shippingLabel}\n\nBeløbet er reserveret på dit kort nu og bliver først trukket, når pakken sendes afsted. Du får besked samme dag.\n\nMed venlig hilsen\nKolofon`,
            }),
          });
          // fetch only rejects on a network failure. A refusal from Resend
          // arrives as an ordinary response, so it has to be checked, or the
          // email silently never sends and nothing is logged.
          if (!emailRes.ok) {
            console.error('Customer email rejected by Resend:', emailRes.status, await emailRes.text());
          }
        } catch (err) {
          console.error('Failed to send customer email:', err);
        }
      }
    }

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('Callback processing error:', err);
    return new Response('Server error', { status: 500 });
  }
});
