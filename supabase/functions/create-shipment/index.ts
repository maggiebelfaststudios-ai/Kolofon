import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// GLS Denmark, Shop Delivery. Kolofon ships to pakkeshops only.
const PRODUCT_CODE = 'GLSDK_SD';

// Roughly what one piece weighs boxed. Everything is packed the same way, so
// a single figure multiplied by the quantity is close enough; if the pieces
// ever differ this becomes a per-product value.
const ITEM_WEIGHT_GRAMS = 2000;

// What the boxes physically hold. A larger order is split across several.
const MAX_ITEMS_PER_BOX = 3;

// A4 because the labels are printed on an ordinary office printer. The API
// accepts only its own enum here - a plain 'pdf' is rejected outright.
const LABEL_FORMAT = 'a4_pdf';

// Required by the API. EMAIL_NT is the carrier notifying the customer that the
// parcel is ready to collect, which a shop delivery needs. SMS_NT is available
// too but is billed per message.
const SERVICE_CODES = 'EMAIL_NT';

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
    // test_mode books a shipment that Shipmondo does not send to the carrier
    // and does not invoice. Nothing is written back to the order either, so a
    // dry run can never leave a real order looking dispatched.
    const { order_id, test_mode = false } = await req.json();
    const isTest = Boolean(test_mode);
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

    // Don't book a second parcel for an order that already has one. A dry run
    // books nothing, so it is free to repeat.
    if (order.tracking_number && !isTest) {
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

    const itemCount = Math.max(1, Array.isArray(order.items)
      ? order.items.reduce((n: number, i: { quantity?: number }) => n + (Number(i.quantity) || 1), 0)
      : 1);

    // The boxes hold three pieces, so anything larger is split. The pieces are
    // then spread evenly rather than filling each box to the brim: four go as
    // 2+2, which keeps both boxes inside the 1-5 kg band, where 3+1 would push
    // one of them into the dearer band for nothing. Each box declares what is
    // really in it - GLS weighs parcels at intake, so under-declaring comes
    // back later as a surcharge.
    const parcelCount = Math.ceil(itemCount / MAX_ITEMS_PER_BOX);
    const base = Math.floor(itemCount / parcelCount);
    const remainder = itemCount % parcelCount;
    const parcels = Array.from({ length: parcelCount }, (_, i) => ({
      weight: ITEM_WEIGHT_GRAMS * (base + (i < remainder ? 1 : 0)),
    }));

    // The receiver is taken from the order exactly as the customer entered it,
    // so nothing is retyped between here and the label.
    const shipmentBody = {
      own_agreement: false,
      test_mode: isTest,
      product_code: PRODUCT_CODE,
      service_codes: SERVICE_CODES,
      // service_point_id, not pickup_point_id. The customer picked this shop at
      // checkout, so the parcel must go there rather than to an automatic choice.
      service_point_id: String(servicePoint.id),
      reference: order_id,
      label_format: LABEL_FORMAT,
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
      parcels,
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

    console.log('Shipmondo shipment response:', JSON.stringify(data));

    // Shipmondo calls the parcel number pkg_no, one per parcel. A split order
    // has several, so they are collected and stored together rather than the
    // first one standing in for the rest.
    const responseParcels = Array.isArray(data.parcels) ? data.parcels : [];
    const numbers: string[] = [];
    for (const p of responseParcels) {
      const fromList = Array.isArray(p?.pkg_nos) ? p.pkg_nos.filter(Boolean) : [];
      if (fromList.length) numbers.push(...fromList.map(String));
      else if (p?.pkg_no) numbers.push(String(p.pkg_no));
    }
    if (!numbers.length && data.pkg_no) numbers.push(String(data.pkg_no));

    const trackingNumber = numbers.length ? numbers.join(', ') : null;

    if (!trackingNumber) {
      console.error('Shipment created but no pkg_no in the response');
      console.error('Top-level keys were:', Object.keys(data).join(', '));
    }

    // One label per parcel. Stored as a JSON list so a split order can print
    // all of its labels, not just the first box.
    const labelList: string[] = Array.isArray(data.labels)
      ? data.labels.map((l: { base64?: string }) => l?.base64).filter(Boolean)
      : [];
    const labelBase64 = labelList.length ? JSON.stringify(labelList) : null;

    if (isTest) {
      // The label is a whole PDF, so report that it arrived rather than echo it
      const { labels, ...rest } = data;
      return new Response(JSON.stringify({
        success: true,
        test_mode: true,
        tracking_number: trackingNumber,
        parcels_booked: parcels.length,
        labels_returned: labelList.length,
        response: rest,
      }), { status: 200, headers: corsHeaders });
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        tracking_number: trackingNumber,
        shipmondo_id: data.id ? String(data.id) : null,
        label_base64: labelBase64,
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
      parcels_booked: parcels.length,
      has_label: Boolean(labelBase64),
    }), { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
