import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// GLS Denmark, Shop Delivery. Kolofon ships to pakkeshops only.
const PRODUCT_CODE = 'GLSDK_SD';

// Every piece is packed the same way. If that ever varies, this becomes a
// per-product value rather than a constant.
const PARCEL_WEIGHT_GRAMS = 2000;

const SENDER = {
  type: 'sender',
  name: 'Kolofon',
  address1: 'Valmuevej 9, 1. 3.',
  postal_code: '7000',
  city: 'Fredericia',
  country_code: 'DK',
  email: 'simonlsamuelsen@gmail.com',
  phone: '+4550422420',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id mangler' }), { status: 400, headers: corsHeaders });
    }

    const SHIPMONDO_USERNAME = Deno.env.get('SHIPMONDO_USERNAME');
    const SHIPMONDO_APIKEY = Deno.env.get('SHIPMONDO_APIKEY');
    if (!SHIPMONDO_USERNAME || !SHIPMONDO_APIKEY) {
      return new Response(JSON.stringify({ error: 'Shipmondo credentials not configured' }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', order_id)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', order_id, orderError);
      return new Response(JSON.stringify({ error: 'Ordren blev ikke fundet' }), { status: 404, headers: corsHeaders });
    }

    // Don't book a second parcel for an order that already has one
    if (order.tracking_number) {
      return new Response(JSON.stringify({
        error: 'Der findes allerede en forsendelse for denne ordre',
        tracking_number: order.tracking_number,
      }), { status: 409, headers: corsHeaders });
    }

    const customer = order.customer_details || {};
    const servicePoint = customer.shipping?.servicePoint;

    if (!servicePoint?.id) {
      console.error('Order has no pickup point:', order_id);
      return new Response(JSON.stringify({ error: 'Ordren har ingen pakkeshop' }), { status: 400, headers: corsHeaders });
    }

    // The receiver is taken from the order exactly as the customer entered it,
    // so nothing is retyped between here and the label.
    const shipmentBody = {
      own_agreement: false,
      test_mode: false,
      product_code: PRODUCT_CODE,
      pickup_point_id: String(servicePoint.id),
      reference: order_id,
      label_format: 'pdf',
      parties: [
        SENDER,
        {
          type: 'receiver',
          name: customer.fullName || '',
          address1: customer.address || '',
          postal_code: customer.zip || '',
          city: customer.city || '',
          country_code: 'DK',
          email: customer.email || order.email || '',
          phone: customer.phone || '',
        },
      ],
      parcels: [{ weight: PARCEL_WEIGHT_GRAMS }],
    };

    const auth = `Basic ${btoa(`${SHIPMONDO_USERNAME}:${SHIPMONDO_APIKEY}`)}`;
    const res = await fetch('https://app.shipmondo.com/api/public/v3/shipments', {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(shipmentBody),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Shipmondo rejected the shipment:', res.status, JSON.stringify(data));
      return new Response(JSON.stringify({ error: 'Shipmondo afviste forsendelsen', details: data }), {
        status: 502, headers: corsHeaders,
      });
    }

    // The exact field names are not documented in the public pages, so log the
    // whole response once and read the number from whichever field carries it.
    console.log('Shipmondo shipment response:', JSON.stringify(data));

    const parcel = Array.isArray(data.parcels) ? data.parcels[0] : null;
    const trackingNumber =
      data.package_number || data.tracking_number || data.barcode ||
      parcel?.package_number || parcel?.tracking_number || parcel?.barcode || null;

    if (!trackingNumber) {
      console.error('Shipment created but no tracking number found in the response');
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        tracking_number: trackingNumber,
        shipmondo_id: data.id ? String(data.id) : null,
        label_base64: data.label_base64 || null,
      })
      .eq('order_id', order_id);

    if (updateError) {
      // The parcel is booked at this point, so report rather than pretend it failed
      console.error('Shipment created but the order could not be updated:', updateError);
      return new Response(JSON.stringify({
        error: 'Forsendelsen blev oprettet, men kunne ikke gemmes på ordren',
        tracking_number: trackingNumber,
      }), { status: 500, headers: corsHeaders });
    }

    console.log(`Shipment created for ${order_id}, tracking: ${trackingNumber}`);

    return new Response(JSON.stringify({
      success: true,
      tracking_number: trackingNumber,
      has_label: Boolean(data.label_base64),
    }), { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
