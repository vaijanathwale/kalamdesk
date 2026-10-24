import 'dotenv/config';
import express from 'express'; import cors from 'cors';
import mysql from 'mysql2/promise'; import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit'; import nodemailer from 'nodemailer';

const db = mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME,decimalNumbers:true});
const app = express(); app.use(cors()); app.use(express.json());
const wrap = f => (req,res) => f(req,res).catch(e => { console.error(e); res.status(500).json({error:e.message}); });

// ---- auth
const sign = u => jwt.sign({id:u.id,role:u.role,name:u.name}, process.env.JWT_SECRET, {expiresIn:'12h'});
const auth = (req,res,next) => { try { req.user = jwt.verify((req.headers.authorization||'').replace('Bearer ',''), process.env.JWT_SECRET); next(); } catch { res.status(401).json({error:'Please log in'}); } };
const owner = (req,res,next) => req.user.role==='owner' ? next() : res.status(403).json({error:'Owner only'});

app.post('/api/auth/register', wrap(async (req,res) => {
  const {name,email,password} = req.body; if(!email||!password||password.length<6) return res.status(400).json({error:'Email and 6+ char password required'});
  const [[{n}]] = await db.query('SELECT COUNT(*) n FROM users');
  const hash = await bcrypt.hash(password,10);
  const [r] = await db.query('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',[name,email,hash,n?'staff':'owner']);
  const u = {id:r.insertId,name,role:n?'staff':'owner'}; res.json({token:sign(u),user:u});
}));
app.post('/api/auth/login', wrap(async (req,res) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE email=?',[req.body.email]);
  if(!u || !await bcrypt.compare(req.body.password||'',u.password_hash)) return res.status(401).json({error:'Wrong email or password'});
  res.json({token:sign(u),user:{id:u.id,name:u.name,role:u.role}});
}));

// ---- products
app.get('/api/products', auth, wrap(async (_q,res) => res.json((await db.query('SELECT * FROM products WHERE active=1 ORDER BY name'))[0])));
app.post('/api/products', auth, wrap(async (req,res) => { const p=req.body;
  const [r]=await db.query('INSERT INTO products(name,category,sku,price,gst_pct,stock,min_stock) VALUES(?,?,?,?,?,?,?)',[p.name,p.category||'Stationery',p.sku,p.price,p.gst_pct||0,p.stock||0,p.min_stock||5]); res.json({id:r.insertId}); }));
app.put('/api/products/:id', auth, wrap(async (req,res) => { const p=req.body;
  await db.query('UPDATE products SET name=?,category=?,sku=?,price=?,gst_pct=?,stock=?,min_stock=? WHERE id=?',[p.name,p.category,p.sku,p.price,p.gst_pct,p.stock,p.min_stock,req.params.id]); res.json({ok:1}); }));
app.delete('/api/products/:id', auth, owner, wrap(async (req,res) => { await db.query('UPDATE products SET active=0 WHERE id=?',[req.params.id]); res.json({ok:1}); }));

// ---- book sets (one per standard)
app.get('/api/sets', auth, wrap(async (_q,res) => res.json((await db.query('SELECT * FROM book_sets ORDER BY id'))[0])));
app.post('/api/sets', auth, wrap(async (req,res) => { const [r]=await db.query('INSERT INTO book_sets(standard,school) VALUES(?,?)',[req.body.standard,req.body.school||'']); res.json({id:r.insertId}); }));
app.delete('/api/sets/:id', auth, owner, wrap(async (req,res) => { await db.query('DELETE FROM book_sets WHERE id=?',[req.params.id]); res.json({ok:1}); }));
app.get('/api/sets/:id/items', auth, wrap(async (req,res) => res.json((await db.query('SELECT p.*,si.qty FROM set_items si JOIN products p ON p.id=si.product_id WHERE si.set_id=? AND p.active=1',[req.params.id]))[0])));
app.put('/api/sets/:id/items', auth, wrap(async (req,res) => {
  const conn=await db.getConnection(); try { await conn.beginTransaction(); await conn.query('DELETE FROM set_items WHERE set_id=?',[req.params.id]);
    for(const i of req.body.items) await conn.query('INSERT INTO set_items VALUES(?,?,?)',[req.params.id,i.product_id,i.qty||1]); await conn.commit(); res.json({ok:1}); }
  catch(e){ await conn.rollback(); throw e; } finally { conn.release(); } }));

// ---- invoices
app.post('/api/invoices', auth, wrap(async (req,res) => {
  const {customer_name,phone,email,discount=0,items} = req.body; if(!items?.length) return res.status(400).json({error:'Add at least one item'});
  const conn=await db.getConnection();
  try { await conn.beginTransaction(); let total=0; const rows=[];
    for(const i of items){ const [[p]]=await conn.query('SELECT * FROM products WHERE id=? FOR UPDATE',[i.product_id]);
      if(!p||p.stock<i.qty) throw new Error(`Not enough stock: ${p?p.name:i.product_id}`);
      total+=p.price*i.qty*(1+p.gst_pct/100); rows.push([p,i.qty]); }
    total=Math.max(0,+(total-discount).toFixed(2));
    const [r]=await conn.query('INSERT INTO invoices(customer_name,phone,email,discount,total,created_by) VALUES(?,?,?,?,?,?)',[customer_name,phone,email,discount,total,req.user.id]);
    for(const [p,q] of rows){ await conn.query('INSERT INTO invoice_items(invoice_id,product_id,name,qty,price,gst_pct) VALUES(?,?,?,?,?,?)',[r.insertId,p.id,p.name,q,p.price,p.gst_pct]);
      await conn.query('UPDATE products SET stock=stock-? WHERE id=?',[q,p.id]); }
    await conn.commit(); res.json({id:r.insertId,total});
  } catch(e){ await conn.rollback(); res.status(400).json({error:e.message}); } finally { conn.release(); }
}));

async function invoicePdf(id){
  const [[inv]]=await db.query('SELECT * FROM invoices WHERE id=?',[id]); if(!inv) return null;
  const [items]=await db.query('SELECT * FROM invoice_items WHERE invoice_id=?',[id]);
  const doc=new PDFDocument({margin:40}); const bufs=[]; doc.on('data',b=>bufs.push(b));
  doc.fontSize(18).text(process.env.SHOP_NAME,{align:'center'}).fontSize(10).moveDown().text(`Invoice #${inv.id}   ${new Date(inv.created_at).toLocaleDateString('en-IN')}`).text(`Customer: ${inv.customer_name||'Walk-in'}  ${inv.phone||''}`).moveDown();
  items.forEach(i=>{ const amt=i.price*i.qty*(1+i.gst_pct/100); doc.text(`${i.name}   ${i.qty} x Rs.${i.price}   GST ${i.gst_pct}%   Rs.${amt.toFixed(2)}`); });
  doc.moveDown().text(`Discount: Rs.${inv.discount}`).fontSize(14).text(`Total: Rs.${inv.total}`).end();
  await new Promise(r=>doc.on('end',r)); return {inv,buf:Buffer.concat(bufs)};
}
app.get('/api/invoices/:id/pdf', auth, wrap(async (req,res) => { const x=await invoicePdf(req.params.id); if(!x) return res.sendStatus(404);
  res.type('pdf').set('Content-Disposition',`inline; filename=invoice-${req.params.id}.pdf`).send(x.buf); }));
app.post('/api/invoices/:id/email', auth, wrap(async (req,res) => { const x=await invoicePdf(req.params.id); if(!x?.inv.email) return res.status(400).json({error:'No customer email'});
  const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:465,secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await t.sendMail({from:process.env.SMTP_USER,to:x.inv.email,subject:`Invoice #${x.inv.id} from ${process.env.SHOP_NAME}`,text:`Thank you! Total Rs.${x.inv.total}. Invoice attached.`,attachments:[{filename:`invoice-${x.inv.id}.pdf`,content:x.buf}]}); res.json({ok:1}); }));
app.get('/api/invoices/:id/whatsapp', auth, wrap(async (req,res) => { const [[inv]]=await db.query('SELECT * FROM invoices WHERE id=?',[req.params.id]);
  const msg=encodeURIComponent(`Hi ${inv.customer_name||''}, thanks for shopping at ${process.env.SHOP_NAME}. Invoice #${inv.id}, total Rs.${inv.total}.`);
  res.json({url:`https://wa.me/91${(inv.phone||'').replace(/\D/g,'').slice(-10)}?text=${msg}`}); }));

// ---- AI proxy
app.get('/api/ai/reorder', auth, owner, wrap(async (_q,res) => {
  const [sales]=await db.query(`SELECT ii.product_id,DATE_FORMAT(i.created_at,'%Y-%m-%d') d,SUM(ii.qty) qty FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.created_at>NOW()-INTERVAL 60 DAY GROUP BY 1,2`);
  const [products]=await db.query('SELECT id,name,stock,min_stock FROM products WHERE active=1');
  const r=await fetch(process.env.AI_URL+'/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sales,products})}); res.json(await r.json()); }));

app.listen(process.env.PORT||4000, () => console.log('API ready'));
