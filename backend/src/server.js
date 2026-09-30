import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import multer from 'multer';
import { db, migrate } from './db.js';
import { auth, adminOnly, ownerOnly, hasPermission, hashPassword, verifyPassword, signToken, id } from './auth.js';

migrate();
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const siteRoot=path.resolve(__dirname,'..','..');
app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:false}));
const allowedOrigins=(process.env.CORS_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>{if(!origin||!allowedOrigins.length||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('CORS_ORIGIN_DENIED'));}}));
app.use(express.json({limit:'4mb'}));
const uploadsDir=path.join(siteRoot,'backend','data','uploads');
fs.mkdirSync(uploadsDir,{recursive:true});
const upload=multer({dest:uploadsDir,limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype))});
app.use('/uploads',express.static(uploadsDir,{maxAge:'30d',immutable:true}));

app.use(express.static(siteRoot,{extensions:['html'],index:'index.html',maxAge:process.env.NODE_ENV==='production'?'1d':0}));

const now=()=>new Date().toISOString();
const rateBuckets=new Map();
function rateLimit({windowMs=60000,max=120}={}){return (req,res,next)=>{const key=`${req.ip}:${req.path}`;const t=Date.now();let b=rateBuckets.get(key);if(!b||t-b.start>windowMs)b={start:t,count:0};b.count++;rateBuckets.set(key,b);if(b.count>max)return res.status(429).json({error:'RATE_LIMITED'});next();};}
app.use('/api/auth/',rateLimit({windowMs:60000,max:30}));
app.use('/api/orders',rateLimit({windowMs:60000,max:30}));

const productInput=z.object({id:z.string().optional(),name:z.string().min(1),description:z.string().optional().default(''),brand:z.string().optional().default(''),category:z.string().optional().default(''),price:z.number().nonnegative(),old_price:z.number().nonnegative().nullable().optional(),cost_price:z.number().nonnegative().optional().default(0),stock:z.number().int().nonnegative().optional().default(0),images:z.array(z.string()).optional().default([]),variants:z.array(z.object({name:z.string(),stock:z.number().int().nonnegative()})).optional().default([]),active:z.boolean().optional().default(true),metadata:z.record(z.any()).optional().default({})});

const orderInput=z.object({userId:z.string().nullable().optional(),customer:z.object({name:z.string().min(1),contact:z.string().min(3),address:z.string().optional().default(''),gender:z.string().optional(),age:z.number().int().nullable().optional()}),paymentMethod:z.string().default('cod'),shipping:z.number().nonnegative().default(0),packaging:z.number().nonnegative().default(0),couponCode:z.string().nullable().optional(),pointsToRedeem:z.number().int().nonnegative().optional().default(0),items:z.array(z.object({productId:z.string(),variantName:z.string().nullable().optional(),quantity:z.number().int().positive()})).min(1)});

function rowProduct(r){let meta={};try{meta=JSON.parse(r.metadata_json||'{}')}catch{};return {...r,...meta,images:JSON.parse(r.images_json||'[]'),variants:JSON.parse(r.variants_json||'[]'),active:!!r.active,images_json:undefined,variants_json:undefined,metadata_json:undefined};}

app.get('/api/health',(req,res)=>res.json({ok:true,time:now()}));

app.get('/api/settings',(req,res)=>{
  const rows=db.prepare('SELECT key,value_json FROM store_settings').all();
  const settings={}; for(const r of rows){try{settings[r.key]=JSON.parse(r.value_json)}catch{settings[r.key]=null}}
  res.json({settings});
});

app.get('/api/admin/settings',auth(),adminOnly,(req,res)=>{
  const rows=db.prepare('SELECT key,value_json,updated_at FROM store_settings ORDER BY key').all();
  const settings={}; for(const r of rows){try{settings[r.key]=JSON.parse(r.value_json)}catch{settings[r.key]=null}}
  res.json({settings,updatedAt:Object.fromEntries(rows.map(r=>[r.key,r.updated_at]))});
});

app.put('/api/admin/settings/:key',auth(),adminOnly,(req,res)=>{
  const key=String(req.params.key||'').trim();
  if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) return res.status(400).json({error:'INVALID_SETTING_KEY'});
  const value=req.body?.value; if(value===undefined) return res.status(400).json({error:'INVALID_SETTING_VALUE'});
  const t=now(); db.prepare('INSERT INTO store_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(key,JSON.stringify(value),t);
  res.json({key,value,updated_at:t});
});

app.post('/api/auth/register',(req,res)=>{
  const {name,contact,password,email='',gender='unspecified',age=null}=req.body||{};
  if(!name||!contact||!password||password.length<8) return res.status(400).json({error:'INVALID_INPUT'});
  if(db.prepare('SELECT 1 FROM users WHERE contact=?').get(contact)) return res.status(409).json({error:'CONTACT_EXISTS'});
  const user={id:id(),name,contact,email,gender,age,password_hash:hashPassword(password),role:'customer',is_owner:0,active:1,created_at:now(),updated_at:now()};
  db.prepare('INSERT INTO users(id,name,contact,email,gender,age,password_hash,role,is_owner,active,created_at,updated_at) VALUES(@id,@name,@contact,@email,@gender,@age,@password_hash,@role,@is_owner,@active,@created_at,@updated_at)').run(user);
  const safe={id:user.id,name,contact,email,gender,age,role:user.role};
  res.status(201).json({user:safe,token:signToken(safe)});
});

app.get('/api/setup/status',(req,res)=>{ const exists=!!db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get(); res.json({setupRequired:!exists}); });

app.post('/api/auth/admin-login',(req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password)return res.status(400).json({error:'INVALID_CREDENTIALS'});
  const u=db.prepare("SELECT * FROM users WHERE role='admin' AND active=1 AND (email=? OR contact=?) LIMIT 1").get(String(email).trim(),String(email).trim());
  if(!u || !u.password_hash || !verifyPassword(password,u.password_hash))return res.status(401).json({error:'INVALID_CREDENTIALS'});
  const safe={id:u.id,name:u.name,contact:u.contact,email:u.email,gender:u.gender,age:u.age,role:u.role,is_owner:Number(u.is_owner||0),active:Number(u.active??1)};
  res.json({user:safe,token:signToken(safe)});
});

app.post('/api/auth/login',(req,res)=>{
  const {contact,password}=req.body||{}; const u=db.prepare('SELECT * FROM users WHERE contact=?').get(contact);
  if(!u||Number(u.active)===0||!u.password_hash||!verifyPassword(password||'',u.password_hash)) return res.status(401).json({error:'INVALID_CREDENTIALS'});
  const safe={id:u.id,name:u.name,contact:u.contact,email:u.email,gender:u.gender,age:u.age,role:u.role,is_owner:Number(u.is_owner||0),active:Number(u.active??1)}; res.json({user:safe,token:signToken(safe)});
});

app.get('/api/me',auth(),(req,res)=>{let permissions={};if(Number(req.user.is_owner)===1)permissions={'*':true};else{const r=db.prepare('SELECT permissions_json FROM admin_permissions WHERE user_id=?').get(req.user.id);try{permissions=JSON.parse(r?.permissions_json||'{}')}catch{}}const u=db.prepare('SELECT whatsapp_opt_in FROM users WHERE id=?').get(req.user.id);const points=Number(db.prepare('SELECT COALESCE(SUM(points),0) p FROM loyalty_ledger WHERE user_id=?').get(req.user.id)?.p||0);res.json({user:{...req.user,whatsapp_opt_in:Number(u?.whatsapp_opt_in||0),points,permissions}});});

app.patch('/api/me',auth(),(req,res)=>{const allowed=['name','contact','email','gender','age','whatsapp_opt_in'];const current=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);if(!current)return res.status(404).json({error:'NOT_FOUND'});const data={...current};for(const k of allowed)if(req.body?.[k]!==undefined)data[k]=req.body[k];if(!data.name||!data.contact)return res.status(400).json({error:'INVALID_INPUT'});if(data.gender&&!['male','female','other','unspecified'].includes(data.gender))return res.status(400).json({error:'INVALID_GENDER'});if(data.age!=null&&(Number(data.age)<13||Number(data.age)>120))return res.status(400).json({error:'INVALID_AGE'});data.whatsapp_opt_in=Number(data.whatsapp_opt_in?1:0);try{db.prepare('UPDATE users SET name=?,contact=?,email=?,gender=?,age=?,whatsapp_opt_in=?,updated_at=? WHERE id=?').run(data.name,data.contact,data.email||'',data.gender||'unspecified',data.age??null,data.whatsapp_opt_in,now(),current.id);}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'CONTACT_EXISTS'});throw e;}res.json({user:db.prepare('SELECT id,name,contact,email,gender,age,role,is_owner,active,whatsapp_opt_in FROM users WHERE id=?').get(current.id)});});

function getSetting(key, fallback){const r=db.prepare('SELECT value_json FROM store_settings WHERE key=?').get(key);if(!r)return fallback;try{return JSON.parse(r.value_json)}catch{return fallback}}

function cartFingerprint(items){return JSON.stringify((items||[]).map(x=>({productId:String(x.productId),variantName:x.variantName||null,quantity:Number(x.quantity)||0})).sort((a,b)=>a.productId.localeCompare(b.productId)||(a.variantName||'').localeCompare(b.variantName||'')))}

app.post('/api/cart/heartbeat',auth(),(req,res)=>{const items=Array.isArray(req.body?.items)?req.body.items.filter(x=>x&&x.productId&&Number(x.quantity)>0).slice(0,50).map(x=>({productId:String(x.productId),variantName:x.variantName||null,quantity:Math.min(99,Number(x.quantity)||0)})):[];db.prepare('INSERT INTO cart_snapshots(user_id,items_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET items_json=excluded.items_json,updated_at=excluded.updated_at').run(req.user.id,JSON.stringify(items),now());res.json({ok:true,items:items.length});});

app.delete('/api/cart/heartbeat',auth(),(req,res)=>{db.prepare('DELETE FROM cart_snapshots WHERE user_id=?').run(req.user.id);res.json({ok:true});});

app.get('/api/me/loyalty',auth(),(req,res)=>{const points=Number(db.prepare('SELECT COALESCE(SUM(points),0) p FROM loyalty_ledger WHERE user_id=?').get(req.user.id)?.p||0);const st=getSetting('loyalty',{enabled:false,earnMode:'order',pointsPerOrder:10,amountPerPoint:10,pointValue:0.1});res.json({points,settings:st,ledger:db.prepare('SELECT points,kind,note,created_at FROM loyalty_ledger WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id)});});

app.get('/api/orders/my',auth(),(req,res)=>{
  const rows=db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  const items=db.prepare('SELECT * FROM order_items WHERE order_id=?');
  res.json({orders:rows.map(o=>({...o,items:items.all(o.id)}))});
});
app.get('/api/products',(req,res)=>{
  const q=String(req.query.q||'').trim(), category=String(req.query.category||'').trim(), brand=String(req.query.brand||'').trim();
  const page=Math.max(1,Number(req.query.page)||1), limit=Math.min(60,Math.max(1,Number(req.query.limit)||24)), offset=(page-1)*limit;
  const where=['active=1'], args=[];
  if(q){where.push('(name LIKE ? OR description LIKE ? OR brand LIKE ? OR category LIKE ?)');const x=`%${q}%`;args.push(x,x,x,x);}
  if(category){where.push('category=?');args.push(category);}
  if(brand){where.push('brand=?');args.push(brand);}
  const count=db.prepare(`SELECT COUNT(*) c FROM products WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows=db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args,limit,offset);
  res.json({products:rows.map(rowProduct),pagination:{page,limit,total:Number(count),pages:Math.ceil(Number(count)/limit)}});
});

app.post('/api/admin/uploads/image',auth(),adminOnly,upload.single('image'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'INVALID_IMAGE'});
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'})[req.file.mimetype]||'bin';
  const final=`${req.file.filename}.${ext}`; fs.renameSync(req.file.path,path.join(uploadsDir,final));
  res.status(201).json({url:`/uploads/${final}`});
});

app.post('/api/waitlist',auth(false),(req,res)=>{
  const x=req.body||{}; const productId=String(x.productId||''); const contact=String(x.contact||'').trim();
  if(!productId||!contact)return res.status(400).json({error:'INVALID_WAITLIST'});
  if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId))return res.status(404).json({error:'PRODUCT_NOT_FOUND'});
  try{const r=db.prepare('INSERT INTO waitlist(product_id,contact,created_at) VALUES(?,?,?)').run(productId,contact,now());res.status(201).json({id:r.lastInsertRowid});}
  catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'ALREADY_WAITING'});throw e;}
});

app.get('/api/admin/waitlist',auth(),adminOnly,(req,res)=>res.json({waitlist:db.prepare('SELECT * FROM waitlist ORDER BY created_at DESC').all()}));
app.delete('/api/admin/waitlist/:id',auth(),adminOnly,(req,res)=>{db.prepare('DELETE FROM waitlist WHERE id=?').run(req.params.id);res.json({ok:true});});

app.get('/api/featured',(req,res)=>{
  let rows=db.prepare(`SELECT oi.product_id productId, COALESCE(SUM(oi.quantity),0) quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' AND o.created_at>=datetime('now','-7 days') GROUP BY oi.product_id ORDER BY quantity DESC LIMIT 5`).all();
  let period='7d';
  if(!rows.length){
    rows=db.prepare(`SELECT oi.product_id productId, COALESCE(SUM(oi.quantity),0) quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' GROUP BY oi.product_id ORDER BY quantity DESC LIMIT 5`).all();
    period='all';
  }
  res.json({bestSellers:rows.map(x=>({productId:x.productId,quantity:Number(x.quantity)||0})),period});
});

app.get('/api/products/:id',(req,res)=>{
  const r=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if(!r)return res.status(404).json({error:'NOT_FOUND'});
  res.json({product:rowProduct(r)});
});

app.post('/api/admin/products',auth(),adminOnly,(req,res)=>{
  const p=productInput.parse(req.body);
  const t=now(),pid=p.id||id();
  db.prepare(`INSERT INTO products(id,name,description,brand,category,price,old_price,cost_price,stock,images_json,variants_json,metadata_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,brand=excluded.brand,category=excluded.category,price=excluded.price,old_price=excluded.old_price,cost_price=excluded.cost_price,stock=excluded.stock,images_json=excluded.images_json,variants_json=excluded.variants_json,metadata_json=excluded.metadata_json,active=excluded.active,updated_at=excluded.updated_at`).run(pid,p.name,p.description,p.brand,p.category,p.price,p.old_price??null,p.cost_price,p.stock,JSON.stringify(p.images),JSON.stringify(p.variants),JSON.stringify(p.metadata||{}),p.active?1:0,t,t);
  res.json({product:rowProduct(db.prepare('SELECT * FROM products WHERE id=?').get(pid))});
});

app.post('/api/orders',auth(false),(req,res)=>{
  try {
    const input=orderInput.parse(req.body);
    const tx=db.transaction(()=>{
      let subtotal=0; const resolved=[];
      for(const item of input.items){
        const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.productId);
        if(!p) throw new Error('PRODUCT_NOT_FOUND');
        const variants=JSON.parse(p.variants_json||'[]');
        let stock=p.stock;
        if(item.variantName){
          const v=variants.find(v=>String(v.name)===String(item.variantName));
          if(!v)throw new Error('VARIANT_NOT_FOUND');
          stock=v.stock;
        }
        if(stock<item.quantity) throw new Error(`INSUFFICIENT_STOCK:${p.name}:${stock}`);
        subtotal+=p.price*item.quantity;
        resolved.push({item,p,variants,stock});
      }

      let discount=0; let coupon=null;
      if(input.couponCode){
        coupon=db.prepare('SELECT * FROM coupons WHERE code=? AND active=1').get(input.couponCode.toUpperCase());
        if(!coupon)throw new Error('INVALID_COUPON');
        if(subtotal<coupon.min_total)throw new Error('COUPON_MIN_TOTAL');
        if(coupon.usage_limit!=null&&coupon.usage_count>=coupon.usage_limit)throw new Error('COUPON_LIMIT');
        discount=coupon.type==='percent'?subtotal*(coupon.value/100):coupon.value;
        discount=Math.min(discount,subtotal);
      }

      const uid=input.userId||null;
      let loyaltyDiscount=0, pointsRedeemed=0;
      if(uid && input.pointsToRedeem>0){
        const st=getSetting('loyalty',{enabled:false,redeemEnabled:true,pointValue:0.1});
        if(!st.enabled || st.redeemEnabled===false) throw new Error('POINTS_REDEMPTION_DISABLED');
        const balance=Number(db.prepare('SELECT COALESCE(SUM(points),0) p FROM loyalty_ledger WHERE user_id=?').get(uid)?.p||0);
        pointsRedeemed=Math.min(Math.floor(input.pointsToRedeem),Math.max(0,balance));
        if(pointsRedeemed!==Math.floor(input.pointsToRedeem)) throw new Error('INSUFFICIENT_POINTS');
        const pointValue=Math.max(0,Number(st.pointValue||0));
        loyaltyDiscount=Math.min(pointsRedeemed*pointValue,Math.max(0,subtotal-discount));
        pointsRedeemed=pointValue>0?Math.floor(loyaltyDiscount/pointValue):0;
        loyaltyDiscount=pointsRedeemed*pointValue;
      }

      const total=Math.max(0,subtotal-discount-loyaltyDiscount+input.shipping+input.packaging), oid=id(), t=now();

      db.prepare('INSERT INTO orders(id,user_id,status,payment_method,subtotal,discount,loyalty_discount,points_redeemed,shipping,packaging,total,customer_name,customer_contact,customer_address,customer_gender,customer_age,coupon_code,inventory_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(oid,uid,'new',input.paymentMethod,subtotal,discount,loyaltyDiscount,pointsRedeemed,input.shipping,input.packaging,total,input.customer.name,input.customer.contact,input.customer.address,input.customer.gender||null,input.customer.age??null,coupon?.code||null,'reserved',t,t);

      for(const r of resolved){
        const newStock=r.stock-r.item.quantity;
        let variants=r.variants;
        if(r.item.variantName){
          variants=variants.map(v=>String(v.name)===String(r.item.variantName)?{...v,stock:newStock}:v);
        }
        const totalStock=variants.length?variants.reduce((a,v)=>a+Number(v.stock||0),0):newStock;
        db.prepare('UPDATE products SET stock=?,variants_json=?,updated_at=? WHERE id=?').run(totalStock,JSON.stringify(variants),t,r.p.id);
        db.prepare('INSERT INTO order_items(order_id,product_id,variant_name,name_snapshot,price_snapshot,cost_snapshot,quantity) VALUES(?,?,?,?,?,?,?)').run(oid,r.p.id,r.item.variantName||null,r.p.name,r.p.price,r.p.cost_price,r.item.quantity);
      }

      if(coupon)db.prepare('UPDATE coupons SET usage_count=usage_count+1 WHERE id=?').run(coupon.id);
      if(uid && pointsRedeemed>0) db.prepare('INSERT INTO loyalty_ledger(user_id,order_id,points,kind,note,created_at) VALUES(?,?,?,?,?,?)').run(uid,oid,-pointsRedeemed,'redeem',`استبدال ${pointsRedeemed} نقطة بخصم ${loyaltyDiscount.toFixed(2)} ₪`,t);
      db.prepare('INSERT INTO order_events(order_id,status,note,created_at) VALUES(?,?,?,?)').run(oid,'new','Order created and inventory reserved',t);

      if(input.userId)awardOrderPoints({id:oid,user_id:input.userId,total},'placed');
      return {oid,total,loyaltyDiscount,pointsRedeemed};
    });

    const result=tx();
    return res.status(201).json({orderId:result.oid,total:result.total,loyaltyDiscount:result.loyaltyDiscount,pointsRedeemed:result.pointsRedeemed});
  } catch(e) {
    const code=String(e?.message||'ERROR');
    const status=code.startsWith('PRODUCT_NOT_FOUND')||code.startsWith('VARIANT_NOT_FOUND')||code.startsWith('INSUFFICIENT_STOCK')||code.startsWith('INVALID_COUPON')||code.startsWith('COUPON_') ? 400 : 500;
    return res.status(status).json({error:code});
  }
});
app.get('/api/admin/coupons',auth(),adminOnly,(req,res)=>res.json({coupons:db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all()}));

app.post('/api/admin/coupons',auth(),adminOnly,(req,res)=>{
  const x=req.body||{};
  const code=String(x.code||'').trim().toUpperCase();
  const type=x.type==='fixed'?'fixed':'percent';
  const value=Number(x.value);
  if(!code||!Number.isFinite(value)||value<=0||(type==='percent'&&value>100))
    return res.status(400).json({error:'INVALID_COUPON'});
  try{
    const c={
      id:id(),
      code,
      type,
      value,
      min_total:Math.max(0,Number(x.min_total)||0),
      active:x.active!==false?1:0,
      starts_at:x.starts_at||null,
      ends_at:x.ends_at||null,
      usage_limit:x.usage_limit==null?null:Math.max(0,Number(x.usage_limit)||0),
      usage_count:0,
      created_at:now()
    };
    db.prepare('INSERT INTO coupons(id,code,type,value,min_total,active,starts_at,ends_at,usage_limit,usage_count,created_at) VALUES(@id,@code,@type,@value,@min_total,@active,@starts_at,@ends_at,@usage_limit,@usage_count,@created_at)').run(c);
    res.status(201).json({coupon:c});
  }catch(e){
    if(String(e.message).includes('UNIQUE'))
      return res.status(409).json({error:'COUPON_EXISTS'});
    throw e;
  }
});

app.patch('/api/admin/coupons/:id',auth(),adminOnly,(req,res)=>{
  const c=db.prepare('SELECT * FROM coupons WHERE id=?').get(req.params.id);
  if(!c)return res.status(404).json({error:'NOT_FOUND'});
  const active=req.body?.active===undefined?c.active:(req.body.active?1:0);
  db.prepare('UPDATE coupons SET active=? WHERE id=?').run(active,c.id);
  res.json({coupon:db.prepare('SELECT * FROM coupons WHERE id=?').get(c.id)});
});

app.delete('/api/admin/coupons/:id',auth(),adminOnly,(req,res)=>{
  db.prepare('DELETE FROM coupons WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.get('/api/admin/orders',auth(),adminOnly,(req,res)=>{
  const orders=db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json({orders});
});

app.get('/api/admin/orders/:id',auth(),adminOnly,(req,res)=>{
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if(!order)return res.status(404).json({error:'NOT_FOUND'});
  const items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  res.json({order,items});
});

function awardOrderPoints(order,event='delivered'){
  if(!order?.user_id)return;
  const st=getSetting('loyalty',{
    enabled:false,
    earnMode:'order',
    pointsPerOrder:10,
    amountPerPoint:10,
    pointsPerAmount:1,
    pointValue:0.1,
    redeemEnabled:true,
    awardOn:'delivered'
  });
  if(!st.enabled||String(st.awardOn||'delivered')!==event)return;

  let pts=0;
  if(st.earnMode==='amount')
    pts=Math.floor(Number(order.total||0)/Math.max(0.01,Number(st.amountPerPoint||10))*Number(st.pointsPerAmount||1));
  else
    pts=Math.max(0,Math.floor(Number(st.pointsPerOrder||0)));

  if(!pts)return;

  db.prepare('INSERT OR IGNORE INTO loyalty_ledger(user_id,order_id,points,kind,note,created_at) VALUES(?,?,?,?,?,?)')
    .run(order.user_id,order.id,pts,'earn',`نقاط طلب #${order.id}`,now());
}

app.patch('/api/admin/orders/:id/status',auth(),adminOnly,(req,res)=>{
  const {status}=req.body||{};
  const allowed=['new','confirmed','shipped','delivered','cancelled'];

  if(!allowed.includes(status))
    return res.status(400).json({error:'INVALID_STATUS'});

  const tx=db.transaction(()=>{
    const o=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if(!o)throw new Error('NOT_FOUND');

    if(o.status==='cancelled'||o.status==='delivered')
      return o;

    if(status==='cancelled'&&o.inventory_state==='reserved'){
      const items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);

      for(const it of items){
        const p=db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
        if(!p)continue;

        let vars=JSON.parse(p.variants_json||'[]');

        if(it.variant_name)
          vars=vars.map(v=>String(v.name)===String(it.variant_name)?{...v,stock:Number(v.stock||0)+it.quantity}:v);

        const stock=vars.length
          ?vars.reduce((a,v)=>a+Number(v.stock||0),0)
          :p.stock+it.quantity;

        db.prepare('UPDATE products SET stock=?,variants_json=?,updated_at=? WHERE id=?')
          .run(stock,JSON.stringify(vars),now(),p.id);
      }

      db.prepare('UPDATE orders SET inventory_state=?,updated_at=? WHERE id=?')
        .run('released',now(),o.id);
    }

    db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?')
      .run(status,now(),o.id);

    if(status==='delivered')
      awardOrderPoints(o);

    db.prepare('INSERT INTO order_events(order_id,status,note,created_at) VALUES(?,?,?,?)')
      .run(o.id,status,'Admin status change',now());

    return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
  });

  try{
    res.json({order:tx()});
  }catch(e){
    res.status(400).json({error:e.message});
  }
});

app.get('/api/admin/dashboard',auth(),adminOnly,(req,res)=>{
  const today=new Date().toISOString().slice(0,10);

  const sales=db.prepare(
    "SELECT COALESCE(SUM(total),0) sales, COUNT(*) orders FROM orders WHERE substr(created_at,1,10)=? AND status!='cancelled'"
  ).get(today);

  const cogs=db.prepare(
    "SELECT COALESCE(SUM(oi.cost_snapshot*oi.quantity),0) cogs FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE substr(o.created_at,1,10)=? AND o.status!='cancelled'"
  ).get(today);

  const low=db.prepare(
    'SELECT id,name,stock FROM products WHERE active=1 AND stock<=5 ORDER BY stock ASC LIMIT 20'
  ).all();

  res.json({
    date:today,
    sales:Number(sales.sales),
    orders:Number(sales.orders),
    averageOrder:sales.orders?Number(sales.sales)/sales.orders:0,
    cogs:Number(cogs.cogs),
    grossProfit:Number(sales.sales)-Number(cogs.cogs),
    lowStock:low
  });
});

app.get('/api/admin/users',auth(),adminOnly,(req,res)=>
  res.json({
    users:db.prepare('SELECT id,name,contact,email,gender,age,role,created_at,updated_at FROM users ORDER BY created_at DESC').all()
  })
);

app.patch('/api/admin/users/:id',auth(),adminOnly,(req,res)=>{
  const allowed=['name','contact','email','gender','age'];
  const current=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);

  if(!current)return res.status(404).json({error:'NOT_FOUND'});

  const data={...current};

  for(const k of allowed)
    if(req.body[k]!==undefined)
      data[k]=req.body[k];

  data.updated_at=now();

  db.prepare('UPDATE users SET name=?,contact=?,email=?,gender=?,age=?,updated_at=? WHERE id=?')
    .run(
      data.name,
      data.contact,
      data.email||'',
      data.gender||'unspecified',
      data.age??null,
      data.updated_at,
      current.id
    );

  res.json({
    user:db.prepare('SELECT id,name,contact,email,gender,age,role,is_owner,active FROM users WHERE id=?').get(current.id)
  });
});

app.post('/api/admin/users/:id/reset-password',auth(),adminOnly,(req,res)=>{
  const password=String(req.body?.password||'');

  if(password.length<8)
    return res.status(400).json({error:'PASSWORD_TOO_SHORT'});

  db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?')
    .run(hashPassword(password),now(),req.params.id);

  res.json({ok:true});
});

app.get('/api/admin/notifications',auth(),adminOnly,(req,res)=>{
  const low=db.prepare(
    'SELECT id,name,stock FROM products WHERE active=1 AND stock<=5 ORDER BY stock ASC LIMIT 20'
  ).all();

  const pending=db.prepare(
    "SELECT COUNT(*) c FROM orders WHERE status IN ('new','confirmed')"
  ).get().c;

  res.json({
    notifications:[
      ...low.map(x=>({
        type:'low_stock',
        productId:x.id,
        title:'مخزون منخفض',
        message:`${x.name} — المتبقي ${x.stock}`,
        level:x.stock<=0?'critical':'warning'
      })),
      ...(pending?[{
        type:'pending_orders',
        title:'طلبات بانتظار المعالجة',
        message:`${pending} طلب`,
        level:'info'
      }]:[])
    ]
  });
});
app.get('/api/admin/permissions/:id',auth(),ownerOnly,(req,res)=>{
  const r=db.prepare('SELECT permissions_json FROM admin_permissions WHERE user_id=?').get(req.params.id);
  let permissions={};
  try{permissions=JSON.parse(r?.permissions_json||'{}')}catch{}
  res.json({permissions});
});

app.put('/api/admin/permissions/:id',auth(),ownerOnly,(req,res)=>{
  const u=db.prepare("SELECT id,role FROM users WHERE id=?").get(req.params.id);
  if(!u||u.role!=='admin')
    return res.status(404).json({error:'ADMIN_NOT_FOUND'});

  const permissions=req.body?.permissions;
  if(!permissions||typeof permissions!=='object')
    return res.status(400).json({error:'INVALID_PERMISSIONS'});

  db.prepare('INSERT INTO admin_permissions(user_id,permissions_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET permissions_json=excluded.permissions_json,updated_at=excluded.updated_at')
    .run(u.id,JSON.stringify(permissions),now());

  res.json({permissions});
});

app.get('/api/admin/backup',auth(),adminOnly,async(req,res,next)=>{
  try{
    const dir=path.join(siteRoot,'backend','data','backups');
    fs.mkdirSync(dir,{recursive:true});

    const file=path.join(
      dir,
      `ladies-first-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`
    );

    await db.backup(file);

    res.download(file,'ladies-first-backup.sqlite',()=>{
      try{fs.unlinkSync(file)}catch{}
    });
  }catch(e){
    next(e);
  }
});

app.post('/api/payments/create-session',auth(false),(req,res)=>{
  if(!process.env.PAYMENT_PROVIDER)
    return res.status(503).json({error:'PAYMENT_PROVIDER_NOT_CONFIGURED'});

  res.status(501).json({error:'PAYMENT_ADAPTER_PENDING'});
});

app.get('/api/admin/admins',auth(),ownerOnly,(req,res)=>{
  const admins=db.prepare(
    "SELECT id,name,contact,email,role,is_owner,active,created_at,updated_at FROM users WHERE role='admin' ORDER BY is_owner DESC,created_at ASC"
  ).all();

  const rows=db.prepare(
    'SELECT user_id,permissions_json FROM admin_permissions'
  ).all();

  const map=new Map(
    rows.map(x=>[x.user_id,JSON.parse(x.permissions_json||'{}')])
  );

  res.json({
    admins:admins.map(a=>({
      ...a,
      permissions:Number(a.is_owner)?{'*':true}:(map.get(a.id)||{})
    }))
  });
});

app.post('/api/admin/admins',auth(),ownerOnly,(req,res)=>{
  const name=String(req.body?.name||'').trim();
  const contact=String(req.body?.contact||'').trim();
  const email=String(req.body?.email||contact).trim();
  const password=String(req.body?.password||'');

  if(!name||!contact||password.length<8)
    return res.status(400).json({error:'INVALID_ADMIN'});

  const permissions=
    req.body?.permissions&&typeof req.body.permissions==='object'
      ?req.body.permissions
      :{};

  const allowed=[
    'dashboard',
    'products',
    'orders',
    'users',
    'coupons',
    'settings',
    'media',
    'waitlist',
    'reports',
    'backup'
  ];

  const clean={};

  for(const k of allowed)
    clean[k]=permissions[k]===true;

  const u={
    id:id(),
    name,
    contact,
    email,
    gender:'unspecified',
    age:null,
    password_hash:hashPassword(password),
    role:'admin',
    is_owner:0,
    active:1,
    created_at:now(),
    updated_at:now()
  };

  try{
    db.prepare(
      'INSERT INTO users(id,name,contact,email,gender,age,password_hash,role,is_owner,active,created_at,updated_at) VALUES(@id,@name,@contact,@email,@gender,@age,@password_hash,@role,@is_owner,@active,@created_at,@updated_at)'
    ).run(u);

    db.prepare(
      'INSERT INTO admin_permissions(user_id,permissions_json,updated_at) VALUES(?,?,?)'
    ).run(u.id,JSON.stringify(clean),now());

    res.status(201).json({
      admin:{
        id:u.id,
        name,
        contact,
        email,
        role:'admin',
        is_owner:0,
        active:1,
        permissions:clean
      }
    });
  }catch(e){
    if(String(e.message).includes('UNIQUE'))
      return res.status(409).json({error:'CONTACT_EXISTS'});

    throw e;
  }
});

app.patch('/api/admin/admins/:id',auth(),ownerOnly,(req,res)=>{
  const u=db.prepare(
    "SELECT * FROM users WHERE id=? AND role='admin'"
  ).get(req.params.id);

  if(!u)
    return res.status(404).json({error:'ADMIN_NOT_FOUND'});

  if(Number(u.is_owner))
    return res.status(400).json({error:'CANNOT_EDIT_OWNER'});

  const name=
    req.body?.name===undefined
      ?u.name
      :String(req.body.name).trim();

  const contact=
    req.body?.contact===undefined
      ?u.contact
      :String(req.body.contact).trim();

  const email=
    req.body?.email===undefined
      ?u.email
      :String(req.body.email).trim();

  const active=
    req.body?.active===undefined
      ?u.active
      :(req.body.active?1:0);

  db.prepare(
    'UPDATE users SET name=?,contact=?,email=?,active=?,updated_at=? WHERE id=?'
  ).run(name,contact,email,active,now(),u.id);

  if(req.body?.permissions){
    const allowed=[
      'dashboard',
      'products',
      'orders',
      'users',
      'coupons',
      'settings',
      'media',
      'waitlist',
      'reports',
      'backup'
    ];

    const clean={};

    for(const k of allowed)
      clean[k]=req.body.permissions[k]===true;

    db.prepare(
      'INSERT INTO admin_permissions(user_id,permissions_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET permissions_json=excluded.permissions_json,updated_at=excluded.updated_at'
    ).run(u.id,JSON.stringify(clean),now());
  }

  if(req.body?.password){
    if(String(req.body.password).length<8)
      return res.status(400).json({error:'PASSWORD_TOO_SHORT'});

    db.prepare(
      'UPDATE users SET password_hash=?,updated_at=? WHERE id=?'
    ).run(hashPassword(String(req.body.password)),now(),u.id);
  }

  res.json({ok:true});
});

app.delete('/api/admin/admins/:id',auth(),ownerOnly,(req,res)=>{
  const u=db.prepare(
    "SELECT * FROM users WHERE id=? AND role='admin'"
  ).get(req.params.id);

  if(!u)
    return res.status(404).json({error:'ADMIN_NOT_FOUND'});

  if(Number(u.is_owner))
    return res.status(400).json({error:'CANNOT_DELETE_OWNER'});

  db.prepare(
    "UPDATE users SET active=0,updated_at=? WHERE id=?"
  ).run(now(),u.id);

  res.json({ok:true});
});

app.post('/api/admin/bootstrap',(req,res)=>{
  const {name,email,password}=req.body||{};

  if(!name||!email||!password||password.length<12)
    return res.status(400).json({error:'INVALID_ADMIN_SETUP'});

  if(db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get())
    return res.status(409).json({error:'ADMIN_EXISTS'});

  const u={
    id:id(),
    name:String(name).trim(),
    contact:String(email).trim(),
    email:String(email).trim(),
    gender:'unspecified',
    age:null,
    password_hash:hashPassword(password),
    role:'admin',
    is_owner:1,
    active:1,
    created_at:now(),
    updated_at:now()
  };

  db.prepare(
    'INSERT INTO users(id,name,contact,email,gender,age,password_hash,role,is_owner,active,created_at,updated_at) VALUES(@id,@name,@contact,@email,@gender,@age,@password_hash,@role,@is_owner,@active,@created_at,@updated_at)'
  ).run(u);

  db.prepare(
    'INSERT OR REPLACE INTO admin_permissions(user_id,permissions_json,updated_at) VALUES(?,?,?)'
  ).run(
    u.id,
    JSON.stringify({'*':true}),
    now()
  );

  const safe={
    id:u.id,
    name:u.name,
    contact:u.contact,
    email:u.email,
    role:'admin',
    is_owner:1,
    active:1
  };

  res.status(201).json({
    ok:true,
    user:safe,
    token:signToken(safe)
  });
});

app.get('/admin',(req,res)=>
  res.sendFile(path.join(siteRoot,'admin.html'))
);

app.get('/admin/',(req,res)=>
  res.sendFile(path.join(siteRoot,'admin.html'))
);

app.use((err,req,res,next)=>{
  if(err instanceof z.ZodError)
    return res.status(400).json({
      error:'INVALID_INPUT',
      details:err.issues
    });

  console.error(err);
  res.status(500).json({error:'SERVER_ERROR'});
});
async function sendWhatsAppTemplate(to, templateName, languageCode, components=[]){
  const token=process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;

  if(!token||!phoneId||!templateName)
    return false;

  const body={
    messaging_product:'whatsapp',
    to:String(to).replace(/\D/g,''),
    type:'template',
    template:{
      name:templateName,
      language:{code:languageCode||'ar'},
      components
    }
  };

  const r=await fetch(
    `https://graph.facebook.com/v23.0/${phoneId}/messages`,
    {
      method:'POST',
      headers:{
        Authorization:`Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body)
    }
  );

  if(!r.ok){
    console.error('WhatsApp send failed',await r.text());
    return false;
  }

  return true;
}

async function processWhatsAppReminders(){
  const st=getSetting('whatsapp_automation',{
    enabled:false,
    abandonedEnabled:true,
    abandonedAfterDays:7,
    lowStockEnabled:true,
    lowStockThreshold:2,
    cooldownDays:7,
    languageCode:'ar'
  });

  if(!st.enabled)
    return;

  const cutoff=new Date(
    Date.now()-
    Math.max(1,Number(st.abandonedAfterDays||7))*86400000
  ).toISOString();

  const cooldown=new Date(
    Date.now()-
    Math.max(1,Number(st.cooldownDays||7))*86400000
  ).toISOString();

  if(st.abandonedEnabled){
    const rows=db.prepare(`
      SELECT c.*,u.name,u.contact,u.whatsapp_opt_in
      FROM cart_snapshots c
      JOIN users u ON u.id=c.user_id
      WHERE c.updated_at<=?
      AND u.active=1
      AND u.whatsapp_opt_in=1
    `).all(cutoff);

    for(const c of rows){
      let items=[];

      try{
        items=JSON.parse(c.items_json||'[]');
      }catch{}

      if(!items.length)
        continue;

      const fp=cartFingerprint(items);

      const sent=db.prepare(`
        SELECT 1
        FROM whatsapp_reminders
        WHERE user_id=?
        AND kind='abandoned_cart'
        AND fingerprint=?
        AND sent_at>=?
        LIMIT 1
      `).get(
        c.user_id,
        fp,
        cooldown
      );

      if(sent)
        continue;

      const names=[];

      for(const it of items.slice(0,3)){
        const p=db.prepare(
          'SELECT name FROM products WHERE id=?'
        ).get(it.productId);

        if(p)
          names.push(p.name);
      }

      const ok=await sendWhatsAppTemplate(
        c.contact,
        process.env.WHATSAPP_ABANDONED_TEMPLATE||'',
        st.languageCode||'ar',
        [{
          type:'body',
          parameters:[
            {
              type:'text',
              text:c.name||'عزيزتنا'
            },
            {
              type:'text',
              text:names.join('، ')||'المنتجات التي اخترتها'
            }
          ]
        }]
      );

      if(ok){
        db.prepare(`
          INSERT OR IGNORE INTO whatsapp_reminders
          (user_id,kind,product_id,fingerprint,sent_at)
          VALUES(?,?,?,?,?)
        `).run(
          c.user_id,
          'abandoned_cart',
          null,
          fp,
          now()
        );
      }
    }
  }

  if(st.lowStockEnabled){
    const threshold=Math.max(
      0,
      Number(st.lowStockThreshold||2)
    );

    const rows=db.prepare(`
      SELECT c.*,u.name,u.contact,u.whatsapp_opt_in
      FROM cart_snapshots c
      JOIN users u ON u.id=c.user_id
      WHERE c.updated_at>=?
      AND u.active=1
      AND u.whatsapp_opt_in=1
    `).all(cooldown);

    for(const c of rows){
      let items=[];

      try{
        items=JSON.parse(c.items_json||'[]');
      }catch{}

      for(const it of items){
        const p=db.prepare(
          'SELECT id,name,stock,active FROM products WHERE id=?'
        ).get(it.productId);

        if(!p||!p.active||Number(p.stock)>threshold)
          continue;

        const fp=
          cartFingerprint([it])+
          `|${p.stock}`;

        const sent=db.prepare(`
          SELECT 1
          FROM whatsapp_reminders
          WHERE user_id=?
          AND kind='low_stock'
          AND product_id=?
          AND fingerprint=?
          AND sent_at>=?
          LIMIT 1
        `).get(
          c.user_id,
          p.id,
          fp,
          cooldown
        );

        if(sent)
          continue;

        const ok=await sendWhatsAppTemplate(
          c.contact,
          process.env.WHATSAPP_LOW_STOCK_TEMPLATE||'',
          st.languageCode||'ar',
          [{
            type:'body',
            parameters:[
              {
                type:'text',
                text:c.name||'عزيزتنا'
              },
              {
                type:'text',
                text:p.name
              },
              {
                type:'text',
                text:String(p.stock)
              }
            ]
          }]
        );

        if(ok){
          db.prepare(`
            INSERT OR IGNORE INTO whatsapp_reminders
            (user_id,kind,product_id,fingerprint,sent_at)
            VALUES(?,?,?,?,?)
          `).run(
            c.user_id,
            'low_stock',
            p.id,
            fp,
            now()
          );
        }
      }
    }
  }
}
setInterval(
  ()=>processWhatsAppReminders().catch(
    e=>console.error('WhatsApp worker',e)
  ),
  10*60*1000
);

processWhatsAppReminders().catch(()=>{});

const port=Number(process.env.PORT||3000);

app.listen(
  port,
  ()=>console.log(
    `Ladies First API listening on ${port}`
  )
);
