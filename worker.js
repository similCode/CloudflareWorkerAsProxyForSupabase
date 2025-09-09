// Worker avanzado con logging, rate limiting y seguridad adicional
const SUPABASE_URL = 'https://sylenfqkikdyhkcpgpaq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5bGVuZnFraWtkeWhrY3BncGFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODg1OTAyNCwiZXhwIjoyMDY0NDM1MDI0fQ.TcaMxkPTjO2IFtJzy2OuR8fRtaB9gk1DaiJ1017eIDk';

// Dominios permitidos (para CORS)
const ALLOWED_ORIGINS = [
  'http://localhost:5173/',
  'https://tu-dominio.com',
  'https://www.tu-dominio.com',
  'https://scalexone-7etgru7ib-neuroclons-projects.vercel.app'
];

// Rate limiting simple (usando Cloudflare KV sería mejor)
const rateLimitMap = new Map();

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, x-client-info, accept-profile, x-supabase-api-version, content-type, content-profile',
  'Access-Control-Max-Age': '86400',
};

// Función para verificar rate limiting
function checkRateLimit(clientIP) {
  const now = Date.now();
  const windowMs = 60000; // 1 minuto
  const maxRequests = 100; // 100 requests per minuto

  if (!rateLimitMap.has(clientIP)) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + windowMs });
    return true;
  }

  const clientData = rateLimitMap.get(clientIP);
  
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + windowMs;
    return true;
  }

  if (clientData.count >= maxRequests) {
    return false;
  }

  clientData.count++;
  return true;
}

// Función para logging (puedes enviarlo a un servicio externo)
function logRequest(request, response, duration) {
  const logData = {
    timestamp: new Date().toISOString(),
    method: request.method,
    url: request.url,
    userAgent: request.headers.get('User-Agent'),
    status: response.status,
    duration: duration,
    ip: request.headers.get('CF-Connecting-IP'),
  };
  
  console.log('Request Log:', JSON.stringify(logData));
}

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    
    // Verificar origen para CORS
    const origin = request.headers.get('Origin');
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    
    const finalCorsHeaders = {
      ...corsHeaders,
      'Access-Control-Allow-Origin': '*',
    };

    // Manejar preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: finalCorsHeaders,
      });
    }

    try {
      // Rate limiting
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!checkRateLimit(clientIP)) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              ...finalCorsHeaders,
            },
          }
        );
      }

      // Construir URL de Supabase
      const url = new URL(request.url);
      const supabaseUrl = new URL(SUPABASE_URL + url.pathname + url.search);

      // Preparar headers
      const headers = new Headers(request.headers);
      
      // Determinar qué API key usar
      let apiKey = SUPABASE_ANON_KEY;

      headers.set('apikey', apiKey);
      
      // Manejar Authorization header
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${apiKey}`);
      }

      // Headers adicionales para mejorar el funcionamiento
      headers.set('x-client-info', 'cloudflare-worker-proxy/1.0.0');

      // Crear request hacia Supabase
      const supabaseRequest = new Request(supabaseUrl.toString(), {
        method: request.method,
        headers: headers,
        body: request.body,
        // Mantener redirect behavior
        redirect: 'manual',
      });

      // Realizar petición
      const supabaseResponse = await fetch(supabaseRequest);

      // Preparar response
      const response = new Response(supabaseResponse.body, {
        status: supabaseResponse.status,
        statusText: supabaseResponse.statusText,
        headers: supabaseResponse.headers,
      });

      // Agregar CORS headers
      Object.entries(finalCorsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      // Logging
      const duration = Date.now() - startTime;
      ctx.waitUntil(Promise.resolve(logRequest(request, response, duration)));

      return response;

    } catch (error) {
      const errorResponse = new Response(
        JSON.stringify({
          error: 'Proxy error',
          message: error.message,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...finalCorsHeaders,
          },
        }
      );

      // Log del error
      const duration = Date.now() - startTime;
      ctx.waitUntil(Promise.resolve(logRequest(request, errorResponse, duration)));

      return errorResponse;
    }
  },
};