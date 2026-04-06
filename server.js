'use strict';
const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── OTP Store (in-memory, 5 min expiry) ────────────
const OTP_STORE = {};

// ── Email transporter (Gmail SMTP — free) ──────────
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,   // your gmail
    pass: process.env.GMAIL_PASS    // gmail app password
  }
});

// ── Helpers ────────────────────────────────────────
function uid()  { return 'PS-' + crypto.randomBytes(2).toString('hex').toUpperCase(); }
function now()  { return new Date().toISOString(); }
function otp6() { return Math.floor(100000 + Math.random() * 900000).toString(); }

function haversine(a,b,c,d) {
  const R=6371,x=(c-a)*Math.PI/180,y=(d-b)*Math.PI/180;
  const z=Math.sin(x/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)**2;
  return R*2*Math.atan2(Math.sqrt(z),Math.sqrt(1-z));
}

// ── Database ───────────────────────────────────────
const DB = {
  orders: [],
  vendors: [
    {id:'v-001',name:'Ravi Fuel Station',type:'fuel',rating:4.9,phone:'+91 98001 23456',lat:13.0827,lng:80.2707,available:true},
    {id:'v-002',name:'Chennai Quick Mechanic',type:'mechanic',rating:4.8,phone:'+91 94001 56789',lat:13.0900,lng:80.2800,available:true},
    {id:'v-003',name:'Speed Petrol Centre',type:'fuel',rating:4.7,phone:'+91 97001 98765',lat:13.0750,lng:80.2600,available:true},
    {id:'v-004',name:'MG Road Mechanics',type:'mechanic',rating:4.9,phone:'+91 96001 11234',lat:13.0650,lng:80.2550,available:true},
    {id:'v-005',name:'T Nagar Petrol Bunk',type:'fuel',rating:4.6,phone:'+91 95001 44321',lat:13.0400,lng:80.2300,available:true}
  ]
};

const PRICE = {petrol:103,diesel:91,base:30,per_km:10,platform:18};

function calcPrice(f,l,d) {
  const pp=PRICE[f]||PRICE.petrol,fc=pp*l,dc=d*PRICE.per_km,tot=fc+PRICE.base+dc+PRICE.platform;
  return {pricePerLitre:pp,fuelCost:fc,baseFee:PRICE.base,distanceFee:dc,platformFee:PRICE.platform,total:tot};
}

function nearest(type,lat,lng) {
  return DB.vendors
    .filter(v=>v.type===type&&v.available)
    .map(v=>({...v,distance:Math.round(haversine(lat,lng,v.lat,v.lng)*10)/10}))
    .sort((a,b)=>a.distance-b.distance)[0]||null;
}

function setStatus(id,status) {
  const o=DB.orders.find(o=>o.id===id);
  if(!o||o.status==='paid'||o.status==='cancelled') return;
  o.status=status; o.statusHistory.push({status,time:now()});
  console.log('Order',id,'->',status);
}

// ══════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════

// Root status page
app.get('/', (req,res) => {
  res.setHeader('Content-Type','text/html');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PitStop API</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0A0A0A;color:#F5F0E8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.box{background:#161616;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px;max-width:460px;width:100%}h1{color:#FF4D00;font-size:24px;margin-bottom:8px}.ok{color:#00C47D;font-size:14px;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-bottom:20px}td{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}td:last-child{text-align:right;font-weight:600}pre{background:#111;padding:16px;border-radius:8px;color:#aaa;font-size:13px;margin-top:20px;line-height:1.8}</style>
</head><body><div class="box"><h1>PitStop API</h1><div class="ok">Server running</div>
<table>
<tr><td style="color:#888">Status</td><td style="color:#00C47D">Online</td></tr>
<tr><td style="color:#888">OTP via</td><td>${process.env.GMAIL_USER?'Gmail SMTP (real)':'Demo mode (no email set)'}</td></tr>
<tr><td style="color:#888">Vendors</td><td>${DB.vendors.length} active</td></tr>
<tr><td style="color:#888">Orders</td><td>${DB.orders.length} today</td></tr>
</table>
<pre>POST /api/otp/send     — send OTP to email
POST /api/otp/verify   — verify OTP
GET  /api/vendors      — list vendors
GET  /api/price        — price calculator
POST /api/orders       — place order
GET  /api/orders/:id   — get order
POST /api/sos          — emergency SOS</pre>
</div></body></html>`);
});

// Health
app.get('/health', (req,res) => {
  res.json({status:'ok',time:now(),version:'1.0.0',vendors:DB.vendors.length,orders:DB.orders.length,emailConfigured:!!process.env.GMAIL_USER});
});

// ── OTP SEND ─────────────────────────────────────
// POST /api/otp/send  body: { phone, email }
// email is used to deliver OTP (phone stored for reference)
app.post('/api/otp/send', async (req,res) => {
  try {
    const { phone, email } = req.body;
    if (!phone) return res.status(400).json({success:false,error:'phone is required'});

    const code = otp6();
    const key  = phone.replace(/\D/g,''); // digits only as key

    // Store OTP with 5 min expiry
    OTP_STORE[key] = {
      code,
      email: email||'',
      expires: Date.now() + 5*60*1000,
      attempts: 0
    };

    // ── Send via Gmail if configured ──────────────
    if (process.env.GMAIL_USER && process.env.GMAIL_PASS && email) {
      await transporter.sendMail({
        from: `"PitStop" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Your PitStop OTP',
        html: `
<div style="font-family:sans-serif;max-width:400px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;padding:32px;border-radius:16px">
  <h2 style="color:#FF4D00;margin-bottom:8px">⛽ PitStop</h2>
  <p style="color:#888;margin-bottom:24px;font-size:14px">Your verification code</p>
  <div style="background:#161616;border:1px solid rgba(255,77,0,.3);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
    <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#FF4D00">${code}</div>
  </div>
  <p style="font-size:13px;color:#888">This OTP is valid for <strong style="color:#F5F0E8">5 minutes</strong>.<br>Do not share this code with anyone.</p>
  <p style="font-size:12px;color:#555;margin-top:16px">If you did not request this, ignore this email.</p>
</div>`
      });
      console.log('OTP sent to email:', email, '| Code:', code);
      res.json({success:true,message:'OTP sent to your email',via:'email',demo:false});
    } else {
      // No email configured — return OTP in response (development only)
      console.log('DEMO OTP for', phone, ':', code);
      res.json({success:true,message:'OTP generated (demo mode — no email configured)',via:'demo',demo:true,code}); // Remove ,code in production!
    }
  } catch(e) {
    console.error('OTP send error:', e.message);
    res.status(500).json({success:false,error:'Failed to send OTP: '+e.message});
  }
});

// ── OTP VERIFY ───────────────────────────────────
// POST /api/otp/verify  body: { phone, code }
app.post('/api/otp/verify', (req,res) => {
  try {
    const { phone, code } = req.body;
    if (!phone||!code) return res.status(400).json({success:false,error:'phone and code required'});

    const key    = phone.replace(/\D/g,'');
    const stored = OTP_STORE[key];

    if (!stored)                      return res.status(400).json({success:false,error:'OTP not found. Please request a new one.'});
    if (Date.now() > stored.expires)  { delete OTP_STORE[key]; return res.status(400).json({success:false,error:'OTP expired. Please request a new one.'}); }
    if (stored.attempts >= 3)         return res.status(429).json({success:false,error:'Too many attempts. Please request a new OTP.'});
    if (stored.code !== code.trim())  { stored.attempts++; return res.status(400).json({success:false,error:'Wrong OTP. '+(3-stored.attempts)+' attempts left.'}); }

    // Success — clear OTP
    const email = stored.email;
    delete OTP_STORE[key];

    // Generate session token
    const token = crypto.randomBytes(16).toString('hex');
    console.log('OTP verified for phone:', phone);
    res.json({success:true,message:'Phone verified successfully',token,email});
  } catch(e) {
    res.status(500).json({success:false,error:e.message});
  }
});

// ── Price calculator ──────────────────────────────
app.get('/api/price', (req,res) => {
  try {
    const fuel=req.query.fuel||'petrol',litres=parseFloat(req.query.litres)||5,distance=parseFloat(req.query.distance)||3;
    res.json({success:true,...calcPrice(fuel,litres,distance)});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Vendors ───────────────────────────────────────
app.get('/api/vendors', (req,res) => {
  try {
    const {type,lat,lng}=req.query;
    let list=DB.vendors.map(v=>({id:v.id,name:v.name,type:v.type,rating:v.rating,available:v.available}));
    if(type) list=list.filter(v=>v.type===type);
    if(lat&&lng) {
      list=DB.vendors.filter(v=>!type||v.type===type)
        .map(v=>({id:v.id,name:v.name,type:v.type,rating:v.rating,available:v.available,distance:Math.round(haversine(parseFloat(lat),parseFloat(lng),v.lat,v.lng)*10)/10}))
        .sort((a,b)=>a.distance-b.distance);
    }
    res.json({success:true,count:list.length,vendors:list});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Place order ───────────────────────────────────
app.post('/api/orders', (req,res) => {
  try {
    const {serviceType,fuelType,litres,issueType,userLocation,userName,userPhone}=req.body||{};
    if(!serviceType) return res.status(400).json({success:false,error:'serviceType required'});
    if(!userLocation?.lat||!userLocation?.lng) return res.status(400).json({success:false,error:'userLocation required'});
    const lat=parseFloat(userLocation.lat),lng=parseFloat(userLocation.lng);
    const vendor=nearest(serviceType,lat,lng);
    if(!vendor) return res.status(503).json({success:false,error:'No vendors available near you.'});
    const pricing=serviceType==='fuel'?calcPrice(fuelType||'petrol',parseFloat(litres)||5,vendor.distance||2):{fuelCost:0,baseFee:200,platformFee:PRICE.platform,distanceFee:0,total:218};
    const eta=Math.max(5,Math.round((vendor.distance/30)*60)+3);
    const order={id:uid(),serviceType,fuelType:fuelType||null,litres:parseFloat(litres)||null,issueType:issueType||null,userLocation:{lat,lng,address:userLocation.address||''},userName:userName||'Guest',userPhone:userPhone||'',vendor:{id:vendor.id,name:vendor.name,rating:vendor.rating,phone:vendor.phone,distance:vendor.distance},pricing,eta,status:'accepted',statusHistory:[{status:'placed',time:now()},{status:'accepted',time:now()}],createdAt:now()};
    DB.orders.push(order);
    console.log('Order:',order.id,serviceType,'by',userName);
    setTimeout(()=>setStatus(order.id,'on_the_way'),8000);
    setTimeout(()=>setStatus(order.id,'delivered'),eta*60*1000);
    res.status(201).json({success:true,order});
  } catch(e) { console.error(e); res.status(500).json({success:false,error:e.message}); }
});

// ── Get order ─────────────────────────────────────
app.get('/api/orders/:id', (req,res) => {
  const o=DB.orders.find(o=>o.id===req.params.id);
  if(!o) return res.status(404).json({success:false,error:'Not found'});
  res.json({success:true,order:o});
});

// ── All orders ────────────────────────────────────
app.get('/api/orders', (req,res) => res.json({success:true,count:DB.orders.length,orders:DB.orders}));

// ── Update status ─────────────────────────────────
app.patch('/api/orders/:id/status', (req,res) => {
  try {
    const valid=['placed','accepted','on_the_way','delivered','paid','cancelled'];
    const status=req.body?.status;
    if(!valid.includes(status)) return res.status(400).json({success:false,error:'Invalid status'});
    const o=DB.orders.find(o=>o.id===req.params.id);
    if(!o) return res.status(404).json({success:false,error:'Not found'});
    o.status=status; o.statusHistory.push({status,time:now()});
    res.json({success:true,order:o});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── SOS ───────────────────────────────────────────
app.post('/api/sos', (req,res) => {
  try {
    const {userLocation,userPhone,message}=req.body||{};
    const sos={id:uid(),type:'SOS',userLocation:userLocation||{},userPhone:userPhone||'',message:message||'Emergency',status:'dispatching',time:now()};
    console.log('SOS ALERT:',JSON.stringify(sos));
    res.json({success:true,message:'Help dispatched.',sos});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Vendor registration ───────────────────────────
app.post('/api/vendors/register', (req,res) => {
  try {
    const {name,type,phone,lat,lng}=req.body||{};
    if(!name||!type||!phone) return res.status(400).json({success:false,error:'name, type, phone required'});
    const v={id:'v-'+crypto.randomBytes(3).toString('hex'),name,type,phone,lat:parseFloat(lat)||13.0827,lng:parseFloat(lng)||80.2707,rating:5.0,available:false,status:'pending',createdAt:now()};
    DB.vendors.push(v);
    res.status(201).json({success:true,vendor:{id:v.id,name,type,status:v.status},message:'Application submitted.'});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── 404 ───────────────────────────────────────────
app.use((req,res) => res.status(404).json({success:false,error:'Route not found'}));
app.use((err,req,res,next) => { console.error(err); res.status(500).json({success:false,error:'Server error'}); });

// ── Start ─────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  PitStop API running on port '+PORT);
  console.log('  OTP email: '+(process.env.GMAIL_USER||'NOT SET — running demo mode'));
  console.log('  Vendors: '+DB.vendors.length+'\n');
});

process.on('uncaughtException',  e => console.error('uncaughtException:', e.message));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));
