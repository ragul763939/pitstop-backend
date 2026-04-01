// ════════════════════════════════════════════════════════
// PitStop Backend — server.js
// Deploy this to Railway.app (free)
// ════════════════════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const { v4: uuid } = require('uuid');

const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST','PATCH'] } });

// ── Middleware ────────────────────────────────────────────
app.use(cors());          // Allow all origins — tighten in production if needed
app.use(express.json());

// ── In-memory store (replace with MongoDB Atlas for production) ──
const DB = {
  orders: [],
  vendors: [
    { id:'v-001', name:'Ravi Fuel Station',        type:'fuel',     rating:4.9, phone:'+91 98001 23456', location:{lat:13.0827,lng:80.2707}, available:true },
    { id:'v-002', name:'Chennai Quick Mechanic',   type:'mechanic', rating:4.8, phone:'+91 94001 56789', location:{lat:13.0900,lng:80.2800}, available:true },
    { id:'v-003', name:'Speed Petrol Centre',      type:'fuel',     rating:4.7, phone:'+91 97001 98765', location:{lat:13.0750,lng:80.2600}, available:true },
    { id:'v-004', name:'MG Road Mechanics',        type:'mechanic', rating:4.9, phone:'+91 96001 11234', location:{lat:13.0650,lng:80.2550}, available:true },
    { id:'v-005', name:'T Nagar Petrol Bunk',      type:'fuel',     rating:4.6, phone:'+91 95001 44321', location:{lat:13.0400,lng:80.2300}, available:true }
  ]
};

const PRICE = { petrol:103, diesel:91, base_delivery:30, per_km:10, platform:18 };

// ── Helpers ───────────────────────────────────────────────
function haversine(lat1,lng1,lat2,lng2) {
  const R=6371, dL=((lat2-lat1)*Math.PI)/180, dN=((lng2-lng1)*Math.PI)/180;
  const a=Math.sin(dL/2)**2+Math.cos((lat1*Math.PI)/180)*Math.cos((lat2*Math.PI)/180)*Math.sin(dN/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function calcPrice(fuelType, litres, distKm) {
  const pp = PRICE[fuelType] || PRICE.petrol;
  const fuelCost = pp * litres;
  const distFee  = distKm * PRICE.per_km;
  const total    = fuelCost + PRICE.base_delivery + distFee + PRICE.platform;
  return { fuelCost, baseFee:PRICE.base_delivery, distanceFee:distFee, platformFee:PRICE.platform, total, pricePerLitre:pp };
}

function nearestVendor(type, lat, lng) {
  return DB.vendors
    .filter(v => v.type===type && v.available)
    .map(v => ({ ...v, distance: Math.round(haversine(lat,lng,v.location.lat,v.location.lng)*10)/10 }))
    .sort((a,b) => a.distance-b.distance)[0] || null;
}

function makeOrderId() {
  return 'PS-' + Math.random().toString(36).substr(2,4).toUpperCase();
}

// ══════════════════════════════════════════════════════════
// REST API
// ══════════════════════════════════════════════════════════

// Health
app.get('/health', (req,res) => res.json({ status:'ok', time:new Date().toISOString(), version:'1.0.0' }));

// Price calculator
// GET /api/price?fuel=petrol&litres=5&distance=3
app.get('/api/price', (req,res) => {
  const { fuel='petrol', litres=5, distance=3 } = req.query;
  res.json({ success:true, ...calcPrice(fuel, +litres, +distance) });
});

// Vendors
// GET /api/vendors?type=fuel&lat=13.08&lng=80.27
app.get('/api/vendors', (req,res) => {
  let vendors = [...DB.vendors];
  const { type, lat, lng } = req.query;
  if (type) vendors = vendors.filter(v => v.type===type);
  if (lat && lng) {
    vendors = vendors.map(v => ({ ...v, distance: Math.round(haversine(+lat,+lng,v.location.lat,v.location.lng)*10)/10 }))
                     .sort((a,b) => a.distance-b.distance);
  }
  // Don't expose phone numbers in list
  res.json({ success:true, vendors: vendors.map(({phone,...v})=>v) });
});

// Place order
// POST /api/orders
app.post('/api/orders', (req,res) => {
  const { serviceType, fuelType, litres, issueType, userLocation, userName, userPhone } = req.body;

  if (!serviceType || !userLocation?.lat || !userLocation?.lng)
    return res.status(400).json({ success:false, error:'serviceType and userLocation.lat/lng required' });

  const vendor = nearestVendor(serviceType, userLocation.lat, userLocation.lng);
  if (!vendor)
    return res.status(503).json({ success:false, error:'No vendors available near you right now. Try again in a few minutes.' });

  let pricing;
  if (serviceType === 'fuel') {
    pricing = calcPrice(fuelType||'petrol', litres||5, vendor.distance||2);
  } else {
    pricing = { total:218, baseFee:200, platformFee:18, fuelCost:0, distanceFee:0 };
  }

  const order = {
    id: makeOrderId(),
    serviceType, fuelType, litres, issueType,
    userLocation, userName: userName||'Guest', userPhone,
    vendor: { id:vendor.id, name:vendor.name, rating:vendor.rating, phone:vendor.phone, distance:vendor.distance },
    pricing,
    status: 'accepted',
    statusHistory: [
      { status:'placed',   time:new Date().toISOString() },
      { status:'accepted', time:new Date().toISOString() }
    ],
    eta: Math.round((vendor.distance/30)*60) + 5,
    createdAt: new Date().toISOString()
  };

  DB.orders.push(order);
  io.emit('order:new', { ...order, userPhone:undefined });   // broadcast (redact phone)
  simulateProgress(order);

  res.status(201).json({ success:true, order });
});

// Get single order
app.get('/api/orders/:id', (req,res) => {
  const o = DB.orders.find(x => x.id===req.params.id);
  if (!o) return res.status(404).json({ success:false, error:'Order not found' });
  res.json({ success:true, order: o });
});

// List all orders (admin / debug)
app.get('/api/orders', (req,res) => res.json({ success:true, orders: DB.orders }));

// Update order status
// PATCH /api/orders/:id/status  body: { status: 'delivered' }
app.patch('/api/orders/:id/status', (req,res) => {
  const valid = ['placed','accepted','on_the_way','delivered','paid','cancelled'];
  const { status } = req.body;
  if (!valid.includes(status)) return res.status(400).json({ success:false, error:'Invalid status' });
  const o = DB.orders.find(x => x.id===req.params.id);
  if (!o) return res.status(404).json({ success:false, error:'Not found' });
  o.status = status;
  o.statusHistory.push({ status, time:new Date().toISOString() });
  io.emit('order:status', { orderId:o.id, status });
  res.json({ success:true, order:o });
});

// SOS
// POST /api/sos
app.post('/api/sos', (req,res) => {
  const { userLocation, userPhone, message } = req.body;
  const sos = { id:uuid(), type:'SOS', userLocation, userPhone, message:message||'Emergency', timestamp:new Date().toISOString(), status:'dispatching' };
  io.emit('sos:alert', sos);
  console.log('🚨 SOS ALERT:', sos);
  // TODO: Add Twilio SMS here
  res.json({ success:true, message:'Help is being dispatched to your location.', sos });
});

// Vendor registration
// POST /api/vendors/register
app.post('/api/vendors/register', (req,res) => {
  const { name, type, phone, location } = req.body;
  if (!name||!type||!phone) return res.status(400).json({ success:false, error:'name, type, phone required' });
  const v = { id:'v-'+uuid().substr(0,6), name, type, phone, location:location||{lat:13.0827,lng:80.2707}, rating:5.0, available:false, status:'pending', registeredAt:new Date().toISOString() };
  DB.vendors.push(v);
  res.status(201).json({ success:true, vendor:v, message:'Registered! You will be approved within 24 hours.' });
});

// ══════════════════════════════════════════════════════════
// SOCKET.IO
// ══════════════════════════════════════════════════════════
io.on('connection', socket => {
  console.log('connect:', socket.id);

  socket.on('track:order', orderId => {
    const o = DB.orders.find(x => x.id===orderId);
    if (o) socket.emit('order:current', o);
  });

  socket.on('vendor:location', ({ vendorId, lat, lng }) => {
    io.emit('vendor:location:update', { vendorId, lat, lng, ts:Date.now() });
  });

  socket.on('disconnect', () => console.log('disconnect:', socket.id));
});

// ── Simulate order progress (remove in production with real drivers) ──
function simulateProgress(order) {
  const steps = [
    { status:'on_the_way', delay:5000  },
    { status:'delivered',  delay:18000 },
  ];
  steps.forEach(s => {
    setTimeout(() => {
      const o = DB.orders.find(x => x.id===order.id);
      if (!o || o.status==='cancelled' || o.status==='paid') return;
      o.status = s.status;
      o.statusHistory.push({ status:s.status, time:new Date().toISOString() });
      io.emit('order:status', { orderId:o.id, status:s.status });
    }, s.delay);
  });
}

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});