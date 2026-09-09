Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const url = new URL(req.url);
    const zipcode = url.searchParams.get('zipcode');

    if (!zipcode) {
      return new Response(JSON.stringify({ error: 'zipcode parameter is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const SHIPMONDO_USERNAME = Deno.env.get('SHIPMONDO_USERNAME');
    const SHIPMONDO_APIKEY = Deno.env.get('SHIPMONDO_APIKEY');

    if (!SHIPMONDO_USERNAME || !SHIPMONDO_APIKEY) {
      return new Response(JSON.stringify({ error: 'Shipmondo credentials not configured' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const AUTH_HEADER = `Basic ${btoa(`${SHIPMONDO_USERNAME}:${SHIPMONDO_APIKEY}`)}`;

    const apiUrl = `https://app.shipmondo.com/api/public/v3/pickup_points?carrier_code=gls&country_code=DK&zipcode=${encodeURIComponent(zipcode)}`;

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Shipmondo pickup_points error:', data);
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify(data), {
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
