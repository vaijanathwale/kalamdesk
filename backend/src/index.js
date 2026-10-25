import 'dotenv/config';
import express from 'express'; import cors from 'cors';
import mysql from 'mysql2/promise'; import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { buildInvoicePdf } from './invoice.js';

const db = mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME,decimalNumbers:true});
const app = express(); app.use(cors()); app.use(express.json());
const wrap = f => (req,res) => f(req,res).catch(e => { console.error(e); res.status(500).json({error:e.message}); });

// ---- auth (every account belongs to one shop; every query below is filtered by shop_id)
const sign = u => jwt.sign({id:u.id,role:u.role,name:u.name,shop_id:u.shop_id}, process.env.JWT_SECRET, {expiresIn:'12h'});
const auth = (req,res,next) => { try { req.user = jwt.verify((req.headers.authorization||'').replace('Bearer ',''), process.env.JWT_SECRET); if(!req.user.shop_id) throw 0; next(); } catch { res.status(401).json({error:'Please log in again'}); } };
const owner = (req,res,next) => req.user.role==='owner' ? next() : res.status(403).json({error:'Owner only'});
const sid = req => req.user.shop_id;
const getShop = async id => (await db.query('SELECT id,name,address,phone,gstin,invoice_note FROM shops WHERE id=?',[id]))[0][0];

app.post('/api/auth/register', wrap(async (req,res) => {
  const {name,email,password,shop_name,address,phone,gstin} = req.body;
  if(!shop_name?.trim()) return res.status(400).json({error:'Shop name is required'});
  if(!email||!password||password.length<6) return res.status(400).json({error:'Email and 6+ char password required'});
  const hash = await bcrypt.hash(password,10), conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [s] = await conn.query('INSERT INTO shops(name,address,phone,gstin) VALUES(?,?,?,?)',[shop_name.trim(),address||null,phone||null,gstin||null]);
    const [u] = await conn.query('INSERT INTO users(name,email,password_hash,role,shop_id) VALUES(?,?,?,?,?)',[name,email,hash,'owner',s.insertId]);
    await conn.commit();
    const user = {id:u.insertId,name,role:'owner',shop_id:s.insertId};
    res.json({token:sign(user),user:{...user,shop:await getShop(s.insertId)}});
  } catch(e) { await conn.rollback(); if(e.code==='ER_DUP_ENTRY') return res.status(400).json({error:'This email is already registered'}); throw e; }
  finally { conn.release(); }
}));
app.post('/api/auth/login', wrap(async (req,res) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE email=?',[req.body.email]);
  if(!u || !await bcrypt.compare(req.body.password||'',u.password_hash)) return res.status(401).json({error:'Wrong email or password'});
  res.json({token:sign(u),user:{id:u.id,name:u.name,role:u.role,shop_id:u.shop_id,shop:await getShop(u.shop_id)}});
}));

// ---- shop profile (shown on invoices)
app.get('/api/shop', auth, wrap(async (req,res) => res.json(await getShop(sid(req)))));
app.put('/api/shop', auth, owner, wrap(async (req,res) => { const s=req.body;
  if(!s.name?.trim()) return res.status(400).json({error:'Shop name is required'});
  await db.query('UPDATE shops SET name=?,address=?,phone=?,gstin=?,invoice_note=? WHERE id=?',[s.name.trim(),s.address||null,s.phone||null,s.gstin||null,s.invoice_note||null,sid(req)]);
  res.json(await getShop(sid(req))); }));

// ---- products
app.get('/api/products', auth, wrap(async (req,res) => res.json((await db.query('SELECT * FROM products WHERE active=1 AND shop_id=? ORDER BY name',[sid(req)]))[0])));
app.post('/api/products', auth, wrap(async (req,res) => { const p=req.body;
  const [r]=await db.query('INSERT INTO products(shop_id,name,category,sku,price,gst_pct,stock,min_stock) VALUES(?,?,?,?,?,?,?,?)',[sid(req),p.name,p.category||'Stationery',p.sku,p.price,p.gst_pct||0,p.stock||0,p.min_stock||5]); res.json({id:r.insertId}); }));
app.put('/api/products/:id', auth, wrap(async (req,res) => { const p=req.body;
  await db.query('UPDATE products SET name=?,category=?,sku=?,price=?,gst_pct=?,stock=?,min_stock=? WHERE id=? AND shop_id=?',[p.name,p.category,p.sku,p.price,p.gst_pct,p.stock,p.min_stock,req.params.id,sid(req)]); res.json({ok:1}); }));
app.delete('/api/products/:id', auth, owner, wrap(async (req,res) => { await db.query('UPDATE products SET active=0 WHERE id=? AND shop_id=?',[req.params.id,sid(req)]); res.json({ok:1}); }));

// ---- book sets: any number per standard; school is an optional label
app.get('/api/sets', auth, wrap(async (req,res) => res.json((await db.query('SELECT * FROM book_sets WHERE shop_id=? ORDER BY id',[sid(req)]))[0])));
app.post('/api/sets', auth, wrap(async (req,res) => { const {standard,school,copy_from}=req.body;
  const [r]=await db.query('INSERT INTO book_sets(shop_id,standard,school) VALUES(?,?,?)',[sid(req),standard,school||'']);
  if(copy_from) await db.query('INSERT INTO set_items SELECT ?,si.product_id,si.qty FROM set_items si JOIN book_sets b ON b.id=si.set_id WHERE si.set_id=? AND b.shop_id=?',[r.insertId,copy_from,sid(req)]);
  res.json({id:r.insertId}); }));
app.delete('/api/sets/:id', auth, owner, wrap(async (req,res) => { await db.query('DELETE FROM book_sets WHERE id=? AND shop_id=?',[req.params.id,sid(req)]); res.json({ok:1}); }));
app.get('/api/sets/:id/items', auth, wrap(async (req,res) => res.json((await db.query('SELECT p.*,si.qty FROM set_items si JOIN book_sets b ON b.id=si.set_id JOIN products p ON p.id=si.product_id WHERE si.set_id=? AND b.shop_id=? AND p.active=1',[req.params.id,sid(req)]))[0])));
app.put('/api/sets/:id/items', auth, wrap(async (req,res) => {
  const [[b]]=await db.query('SELECT id FROM book_sets WHERE id=? AND shop_id=?',[req.params.id,sid(req)]); if(!b) return res.sendStatus(404);
  const conn=await db.getConnection(); try { await conn.beginTransaction(); await conn.query('DELETE FROM set_items WHERE set_id=?',[b.id]);
    for(const i of req.body.items) await conn.query('INSERT INTO set_items SELECT ?,id,? FROM products WHERE id=? AND shop_id=?',[b.id,i.qty||1,i.product_id,sid(req)]);
    await conn.commit(); res.json({ok:1}); }
  catch(e){ await conn.rollback(); throw e; } finally { conn.release(); } }));

// ---- invoices (numbered 1,2,3... separately for each shop)
app.post('/api/invoices', auth, wrap(async (req,res) => {
  const {customer_name,phone,email,discount=0,items} = req.body; if(!items?.length) return res.status(400).json({error:'Add at least one item'});
  const conn=await db.getConnection();
  try { await conn.beginTransaction(); let total=0; const rows=[];
    for(const i of items){ const [[p]]=await conn.query('SELECT * FROM products WHERE id=? AND shop_id=? FOR UPDATE',[i.product_id,sid(req)]);
      if(!p||p.stock<i.qty) throw new Error(`Not enough stock: ${p?p.name:i.product_id}`);
      total+=p.price*i.qty*(1+p.gst_pct/100); rows.push([p,i.qty]); }
    total=Math.max(0,+(total-discount).toFixed(2));
    const [[{no}]]=await conn.query('SELECT COALESCE(MAX(invoice_no),0)+1 no FROM invoices WHERE shop_id=? FOR UPDATE',[sid(req)]);
    const [r]=await conn.query('INSERT INTO invoices(shop_id,invoice_no,customer_name,phone,email,discount,total,created_by) VALUES(?,?,?,?,?,?,?,?)',[sid(req),no,customer_name,phone,email,discount,total,req.user.id]);
    for(const [p,q] of rows){ await conn.query('INSERT INTO invoice_items(invoice_id,product_id,name,qty,price,gst_pct) VALUES(?,?,?,?,?,?)',[r.insertId,p.id,p.name,q,p.price,p.gst_pct]);
      await conn.query('UPDATE products SET stock=stock-? WHERE id=?',[q,p.id]); }
    await conn.commit(); res.json({id:r.insertId,invoice_no:no,total});
  } catch(e){ await conn.rollback(); res.status(400).json({error:e.message}); } finally { conn.release(); }
}));

async function invoicePdf(id,shopId){
  const [[inv]]=await db.query('SELECT * FROM invoices WHERE id=? AND shop_id=?',[id,shopId]); if(!inv) return null;
  const [items]=await db.query('SELECT * FROM invoice_items WHERE invoice_id=?',[id]);
  const shop=await getShop(shopId);
  return {inv,shop,buf:await buildInvoicePdf(shop,inv,items)};
}
app.get('/api/invoices/:id/pdf', auth, wrap(async (req,res) => { const x=await invoicePdf(req.params.id,sid(req)); if(!x) return res.sendStatus(404);
  res.type('pdf').set('Content-Disposition',`inline; filename=invoice-${x.inv.invoice_no}.pdf`).send(x.buf); }));
app.post('/api/invoices/:id/email', auth, wrap(async (req,res) => { const x=await invoicePdf(req.params.id,sid(req)); if(!x?.inv.email) return res.status(400).json({error:'No customer email'});
  const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:465,secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await t.sendMail({from:`"${x.shop.name}" <${process.env.SMTP_USER}>`,to:x.inv.email,subject:`Invoice #${x.inv.invoice_no} from ${x.shop.name}`,text:`Thank you for shopping at ${x.shop.name}! Total Rs.${x.inv.total}. Your invoice is attached.`,attachments:[{filename:`invoice-${x.inv.invoice_no}.pdf`,content:x.buf}]}); res.json({ok:1}); }));
app.get('/api/invoices/:id/whatsapp', auth, wrap(async (req,res) => { const [[inv]]=await db.query('SELECT * FROM invoices WHERE id=? AND shop_id=?',[req.params.id,sid(req)]); if(!inv) return res.sendStatus(404);
  const shop=await getShop(sid(req));
  const msg=encodeURIComponent(`Hi ${inv.customer_name||''}, thank you for shopping at ${shop.name}. Invoice #${inv.invoice_no}, total Rs.${inv.total}.`);
  res.json({url:`https://wa.me/91${(inv.phone||'').replace(/\D/g,'').slice(-10)}?text=${msg}`}); }));

// ---- AI proxy
app.get('/api/ai/reorder', auth, owner, wrap(async (req,res) => {
  const [sales]=await db.query(`SELECT ii.product_id,DATE_FORMAT(i.created_at,'%Y-%m-%d') d,SUM(ii.qty) qty FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.shop_id=? AND i.created_at>NOW()-INTERVAL 60 DAY GROUP BY 1,2`,[sid(req)]);
  const [products]=await db.query('SELECT id,name,stock,min_stock FROM products WHERE active=1 AND shop_id=?',[sid(req)]);
  const r=await fetch(process.env.AI_URL+'/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sales,products})}); res.json(await r.json()); }));

app.listen(process.env.PORT||4000, () => console.log('API ready'));