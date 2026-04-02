'use strict';

// ════════════════════════════════════════════════
//  PitStop Backend  — server.js
//  Dependencies: express, cors  (that's ALL)
//  Deploy to Railway.app → free forever
// ════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const http    = require('http');
const crypto  = require('crypto'); // built-in Node — no install needed

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

// ── Helpers ─────────────────────────────────────
function uid() {
  return 'PS-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function now() {
  return new Date().toISOString();
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2)
          + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180)
          * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── In-Memory Database ──────────────────────────
const DB = {
  orders: [],
  vendors: [
    { id:'v-001', name:'Ravi Fuel Station',      type:'fuel',     rating:4.9, phone:'+91 98001 23456', lat:13.0827, lng:80.2707, available:true },
    { id:'v-002', name:'Chennai Quick Mechanic', type:'mechanic', rating:4.8, phone:'+91 94001 56789', lat:13.0900, lng:80.2800, available:true },
    { id:'v-003', name:'Speed Petrol Centre',    type:'fuel',     rating:4.7, phone:'+91 97001 98765', lat:13.0750, lng:80.2600, available:true },
    { id:'v-004', name:'MG Road Mechanics',      type:'mechanic', rating:4.9, phone:'+91 96001 11234', lat:13.0650, lng:80.2550, available:true },
    { id:'v-005', name:'T Nagar Petrol Bunk',    type:'fuel',     rating:4.6, phone:'+91 95001 44321', lat:13.0400, lng:80.2300, available:true }
  ]
};

const PRICE = { petrol:103, diesel:91, base:30, per_km:10, platform:18 };

function calcPrice(fuelType, litres, distKm) {
  const pp      = PRICE[fuelType] || PRICE.petrol;
  const fuel    = pp * litres;
  const dist    = distKm * PRICE.per_km;
  const total   = fuel + PRICE.base + dist + PRICE.platform;
  return { pricePerLitre:pp, fuelCost:fuel, baseFee:PRICE.base, distanceFee:dist, platformFee:PRICE.platform, total };
}

function nearestVendor(type, lat, lng) {
  const list = DB.vendors
    .filter(v => v.type === type && v.available)
    .map(v => ({ ...v, distance: Math.round(haversine(lat, lng, v.lat, v.lng) * 10) / 10 }))
    .sort((a, b) => a.distance - b.distance);
  return list[0] || null;
}

// ════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════

// ── Root — status page ──────────────────────────
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PitStop API</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0A0A0A;color:#F5F0E8;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:#161616;border:1px solid rgba(255,255,255,0.08);border-radius:20px;
        padding:36px 40px;max-width:480px;width:100%}
  h1{font-size:26px;font-weight:800;color:#FF4D00;margin-bottom:4px}
  .sub{color:#888;font-size:14px;margin-bottom:24px}
  .badge{display:inline-flex;align-items:center;gap:6px;background:rgba(0,196,125,0.1);
         border:1px solid rgba(0,196,125,0.3);color:#00C47D;padding:5px 12px;
         border-radius:100px;font-size:12px;font-weight:600;margin-bottom:20px}
  .dot{width:6px;height:6px;background:#00C47D;border-radius:50%;animation:p 2s infinite}
  @keyframes p{0%,100%{opacity:1}50%{opacity:0.3}}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  td{padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px}
  td:first-child{color:#888}
  td:last-child{font-weight:600;text-align:right}
  .endpoints{background:#111;border-radius:12px;padding:16px;font-size:13px;
             font-family:monospace;line-height:2;color:#888}
  .method{color:#FF4D00;font-weight:700;margin-right:8px}
  .path{color:#F5F0E8}
</style>
</head>
<body>
<div class="card">
  <h1>⛽ PitStop API</h1>
  <div class="sub">India's on-demand fuel &amp; mechanic platform</div>
  <div class="badge"><span class="dot"></span> Server is running</div>
  <table>
    <tr><td>Status</td><td style="color:#00C47D">Online ✓</td></tr>
    <tr><td>Version</td><td>1.0.0</td></tr>
    <tr><td>Vendors loaded</td><td>${DB.vendors.length} active</td></tr>
    <tr><td>Orders today</td><td>${DB.orders.length}</td></tr>
    <tr><td>Server time</td><td>${new Date().toLocaleString('en-IN')}</td></tr>
  </table>
  <div class="endpoints">
    <div><span class="method">GET</span><span class="path">/health</span></div>
    <div><span class="method">GET</span><span class="path">/api/vendors</span></div>
    <div><span class="method">GET</span><span class="path">/api/price?fuel=petrol&amp;litres=5&amp;distance=3</span></div>
    <div><span class="method">POST</span><span class="path">/api/orders</span></div>
    <div><span class="method">GET</span><span class="path">/api/orders/:id</span></div>
    <div><span class="method">PATCH</span><span class="path">/api/orders/:id/status</span></div>
    <div><span class="method">POST</span><span class="path">/api/sos</span></div>
  </div>
</div>
</body>
</html>`);
});

// ── Health ──────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: now(), version: '1.0.0', vendors: DB.vendors.length, orders: DB.orders.length });
});

// ── Price calculator ────────────────────────────
app.get('/api/price', (req, res) => {
  try {
    const fuel     = req.query.fuel     || 'petrol';
    const litres   = parseFloat(req.query.litres)   || 5;
    const distance = parseFloat(req.query.distance) || 3;
    res.json({ success: true, ...calcPrice(fuel, litres, distance) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── List vendors ────────────────────────────────
app.get('/api/vendors', (req, res) => {
  try {
    let list = DB.vendors.map(v => ({ id:v.id, name:v.name, type:v.type, rating:v.rating, available:v.available }));
    const { type, lat, lng } = req.query;
    if (type) list = list.filter(v => v.type === type);
    if (lat && lng) {
      list = DB.vendors
        .filter(v => !type || v.type === type)
        .map(v => ({ id:v.id, name:v.name, type:v.type, rating:v.rating, available:v.available,
                     distance: Math.round(haversine(parseFloat(lat), parseFloat(lng), v.lat, v.lng) * 10) / 10 }))
        .sort((a, b) => a.distance - b.distance);
    }
    res.json({ success: true, count: list.length, vendors: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Place order ─────────────────────────────────
app.post('/api/orders', (req, res) => {
  try {
    const { serviceType, fuelType, litres, issueType, userLocation, userName, userPhone } = req.body || {};

    if (!serviceType) return res.status(400).json({ success: false, error: 'serviceType is required (fuel or mechanic)' });
    if (!userLocation || !userLocation.lat || !userLocation.lng)
      return res.status(400).json({ success: false, error: 'userLocation.lat and userLocation.lng are required' });

    const lat = parseFloat(userLocation.lat);
    const lng = parseFloat(userLocation.lng);
    const vendor = nearestVendor(serviceType, lat, lng);

    if (!vendor) return res.status(503).json({ success: false, error: 'No vendors available near you right now.' });

    const pricing = serviceType === 'fuel'
      ? calcPrice(fuelType || 'petrol', parseFloat(litres) || 5, vendor.distance || 2)
      : { fuelCost: 0, baseFee: 200, platformFee: PRICE.platform, distanceFee: 0, total: 218 };

    const eta = Math.max(5, Math.round((vendor.distance / 30) * 60) + 3);

    const order = {
      id:           uid(),
      serviceType,
      fuelType:     fuelType || null,
      litres:       parseFloat(litres) || null,
      issueType:    issueType || null,
      userLocation: { lat, lng, address: userLocation.address || '' },
      userName:     userName  || 'Guest',
      userPhone:    userPhone || '',
      vendor: {
        id:       vendor.id,
        name:     vendor.name,
        rating:   vendor.rating,
        phone:    vendor.phone,
        distance: vendor.distance
      },
      pricing,
      eta,
      status: 'accepted',
      statusHistory: [
        { status: 'placed',   time: now() },
        { status: 'accepted', time: now() }
      ],
      createdAt: now()
    };

    DB.orders.push(order);
    console.log('New order:', order.id, serviceType, 'by', userName);

    // Auto-progress status (simulates real driver movement)
    setTimeout(() => updateStatus(order.id, 'on_the_way'), 8000);
    setTimeout(() => updateStatus(order.id, 'delivered'),  eta * 60 * 1000);

    res.status(201).json({ success: true, order });
  } catch (e) {
    console.error('Order error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Get order by ID ─────────────────────────────
app.get('/api/orders/:id', (req, res) => {
  const order = DB.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  res.json({ success: true, order });
});

// ── List all orders ─────────────────────────────
app.get('/api/orders', (req, res) => {
  res.json({ success: true, count: DB.orders.length, orders: DB.orders });
});

// ── Update order status ─────────────────────────
app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const valid  = ['placed', 'accepted', 'on_the_way', 'delivered', 'paid', 'cancelled'];
    const status = req.body && req.body.status;
    if (!valid.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status. Use: ' + valid.join(', ') });
    const order = DB.orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    order.status = status;
    order.statusHistory.push({ status, time: now() });
    res.json({ success: true, order });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SOS emergency ───────────────────────────────
app.post('/api/sos', (req, res) => {
  try {
    const { userLocation, userPhone, message } = req.body || {};
    const sos = {
      id:        uid(),
      type:      'SOS',
      userLocation: userLocation || {},
      userPhone: userPhone || '',
      message:   message || 'Emergency assistance needed',
      status:    'dispatching',
      time:      now()
    };
    console.log('🚨 SOS ALERT:', JSON.stringify(sos));
    res.json({ success: true, message: 'Help is being dispatched to your location.', sos });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Vendor registration ─────────────────────────
app.post('/api/vendors/register', (req, res) => {
  try {
    const { name, type, phone, lat, lng } = req.body || {};
    if (!name || !type || !phone) return res.status(400).json({ success: false, error: 'name, type and phone are required' });
    const vendor = {
      id:        'v-' + crypto.randomBytes(3).toString('hex'),
      name, type, phone,
      lat:       parseFloat(lat)  || 13.0827,
      lng:       parseFloat(lng)  || 80.2707,
      rating:    5.0,
      available: false,
      status:    'pending_approval',
      createdAt: now()
    };
    DB.vendors.push(vendor);
    console.log('New vendor registration:', name, type);
    res.status(201).json({ success: true, vendor: { id: vendor.id, name, type, status: vendor.status }, message: 'Registration submitted. Approval within 24 hours.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 404 handler ─────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found', hint: 'Visit / to see all available routes' });
});

// ── Global error handler ────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Helper: update order status ─────────────────
function updateStatus(orderId, status) {
  const order = DB.orders.find(o => o.id === orderId);
  if (!order || order.status === 'cancelled' || order.status === 'paid') return;
  order.status = status;
  order.statusHistory.push({ status, time: now() });
  console.log('Order', orderId, '→', status);
}

// ── Start server ────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ⛽  PitStop API is running!');
  console.log('  ──────────────────────────────');
  console.log('  URL     : http://0.0.0.0:' + PORT);
  console.log('  Vendors : ' + DB.vendors.length + ' loaded');
  console.log('  Routes  : GET / for full list');
  console.log('');
});

// ── Catch any unhandled crash and log it ─────────
process.on('uncaughtException',  (e) => console.error('uncaughtException:',  e.message));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
