import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: 'Missing order_id' }), { status: 400, headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', order_id)
      .single();

    if (fetchError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });
    }

    if (order.shipped_notification_sent) {
      return new Response(JSON.stringify({ error: 'Shipping notification already sent' }), { status: 400, headers: corsHeaders });
    }

    const customer = order.customer_details || {};
    const shipping = customer.shipping || {};
    const itemList = order.items.map((item: any) => `${item.title} x${item.quantity} — DKK ${item.priceValue * item.quantity}`).join('\n');
    const shippingLabel = shipping.method === 'shop'
      ? `Pakkeshop — ${shipping.servicePoint?.name}`
      : 'Hjemmelevering';

    // Send shipping notification to customer
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'Kolofon Orders <onboarding@resend.dev>',
        to: order.email,
        subject: `Din pakke er på vej — ${order_id}`,
        text: `Hej ${customer.fullName},\n\nDin ordre er nu afsendt!\n\nOrdre ID: ${order_id}\nTotal: DKK ${order.total}\n\nVarer:\n${itemList}\n\nLevering: ${shippingLabel}\n\nDu vil modtage en track & trace besked direkte fra GLS.\n\nMed venlig hilsen\nKolofon`,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      console.error('Resend error:', err);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500, headers: corsHeaders });
    }

    // Mark as shipped in database
    await supabase
      .from('orders')
      .update({ shipped_notification_sent: true })
      .eq('order_id', order_id);

    console.log(`Shipping notification sent for order ${order_id}`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
