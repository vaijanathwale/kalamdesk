import {useState,useEffect,useCallback} from 'react';

const api = async (path, opts={}) => {
  const r = await fetch('/api'+path, {...opts, headers:{'Content-Type':'application/json', Authorization:'Bearer '+(localStorage.token||'')}, body: opts.body && JSON.stringify(opts.body)});
  const ct = r.headers.get('content-type')||''; const d = ct.includes('json') ? await r.json() : await r.blob();
  if(!r.ok) throw new Error(d.error||'Something went wrong'); return d;
};
const STANDARDS = ['Nursery','LKG','UKG',...Array.from({length:12},(_,i)=>`${i+1}${['st','nd','rd'][i]||'th'} Standard`)];

function Login({onIn}){
  const [f,setF]=useState({}), [reg,setReg]=useState(false), [err,setErr]=useState('');
  const set=k=>e=>setF({...f,[k]:e.target.value});
  const go = async e => { e.preventDefault(); try{ const d=await api(`/auth/${reg?'register':'login'}`,{method:'POST',body:f}); localStorage.token=d.token; localStorage.user=JSON.stringify(d.user); onIn(d.user);}catch(x){setErr(x.message)} };
  return <div className="auth"><section className="hero"><div className="brand"><span className="logo">K</span>KalamDesk</div>
    <h1>Bill a whole class in one click.</h1><p>Book sets, stock and invoices for your stationery shop, all in one place.</p>
    <div className="pills"><span>Class book sets</span><span>GST invoices</span><span>WhatsApp bills</span></div></section>
    <section className="panel"><form onSubmit={go}><h2>{reg?'Set up your shop':'Welcome back'}</h2>
      <p className="sub">{reg?'A new account means a new shop. Your shop name appears on every invoice.':'Log in to continue billing.'}</p>
      {reg&&<><label>Shop name<input required placeholder="e.g. Sai Book Depot" onChange={set('shop_name')}/></label>
        <label>Address<input placeholder="Shown on your invoices" onChange={set('address')}/></label>
        <div className="two"><label>Phone<input placeholder="Shop phone" onChange={set('phone')}/></label><label>GSTIN (optional)<input placeholder="GST number" onChange={set('gstin')}/></label></div>
        <label>Your name<input required placeholder="Owner name" onChange={set('name')}/></label></>}
      <label>Email<input type="email" placeholder="you@shop.com" required onChange={set('email')}/></label>
      <label>Password<input type="password" placeholder="At least 6 characters" required onChange={set('password')}/></label>
      <button className="b full">{reg?'Create shop account':'Log in'}</button>
      <p className="err">{err}</p>
      <button type="button" className="link" onClick={()=>{setReg(!reg);setErr('')}}>{reg?'I already have an account':'New shop? Create an account'}</button></form></section></div>;
}

function Billing({products,reload}){
  const [sets,setSets]=useState([]), [cart,setCart]=useState([]), [cust,setCust]=useState({}), [discount,setDiscount]=useState(0), [done,setDone]=useState(null), [msg,setMsg]=useState(''), [sel,setSel]=useState(null);
  useEffect(()=>{api('/sets').then(setSets)},[]);
  const add = p => setCart(c => c.find(i=>i.id===p.id) ? c.map(i=>i.id===p.id?{...i,qty:i.qty+1}:i) : [...c,{...p,qty:1}]);
  const loadSet = async s => { setSel(s.id); setCart(await api(`/sets/${s.id}/items`)); setDone(null); };
  const total = Math.max(0, cart.reduce((a,i)=>a+i.price*i.qty*(1+i.gst_pct/100),0)-discount);
  const bill = async () => { try{ const d=await api('/invoices',{method:'POST',body:{...cust,discount,items:cart.map(i=>({product_id:i.id,qty:i.qty}))}}); setDone(d); setMsg(''); reload(); }catch(e){setMsg(e.message)} };
  const pdf = async print => { const u=URL.createObjectURL(await api(`/invoices/${done.id}/pdf`)); if(print){const w=window.open(u); w.onload=()=>w.print();} else {const a=document.createElement('a'); a.href=u; a.download=`invoice-${done.id}.pdf`; a.click();} };
  const wa = async () => window.open((await api(`/invoices/${done.id}/whatsapp`)).url);
  const mail = async () => { try{ await api(`/invoices/${done.id}/email`,{method:'POST'}); setMsg('Invoice emailed'); }catch(e){setMsg(e.message)} };
  return <div className="grid"><div>
    <h2>Pick a class</h2><div className="chips">{sets.map(s=><button key={s.id} className={sel===s.id?'on':''} onClick={()=>loadSet(s)}>{s.standard}{s.school&&` · ${s.school}`}</button>)}</div>
    {!sets.length&&<p>No book sets yet. Create one in the Book sets tab.</p>}
    <h2>Add anything else</h2>
    <select onChange={e=>{const p=products.find(x=>x.id==e.target.value); if(p) add(p); e.target.value='';}}><option value="">Search item…</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} — ₹{p.price} ({p.stock} left)</option>)}</select>
  </div><div className="sheet">
    <h2>Bill</h2>
    <div className="row"><input placeholder="Customer name" onChange={e=>setCust({...cust,customer_name:e.target.value})}/><input placeholder="WhatsApp number" onChange={e=>setCust({...cust,phone:e.target.value})}/><input placeholder="Email (optional)" onChange={e=>setCust({...cust,email:e.target.value})}/></div>
    {cart.map(i=><div key={i.id}>{i.name} <input type="number" min="1" value={i.qty} style={{width:60}} onChange={e=>setCart(cart.map(c=>c.id===i.id?{...c,qty:+e.target.value}:c))}/> ₹{(i.price*i.qty).toFixed(0)} <button className="x" aria-label={`Remove ${i.name}`} onClick={()=>setCart(cart.filter(c=>c.id!==i.id))}>×</button></div>)}
    <div>Discount ₹ <input type="number" min="0" value={discount} style={{width:80}} onChange={e=>setDiscount(+e.target.value)}/></div>
    <h2>Total ₹{total.toFixed(2)}</h2>
    {done&&<p className="okmsg">Invoice #{done.invoice_no} saved and stock updated.</p>}
    {!done ? <button className="b alt" disabled={!cart.length} onClick={bill}>Save bill</button> :
      <div className="row"><button className="b" onClick={()=>pdf(true)}>Print</button><button className="b" onClick={()=>pdf(false)}>Download PDF</button><button className="b alt" onClick={wa}>Send on WhatsApp</button><button className="b" onClick={mail}>Email</button><button className="b" onClick={()=>{setDone(null);setCart([]);setSel(null)}}>New bill</button></div>}
    <div className="err">{msg}</div></div></div>;
}

const blank={name:'',price:'',stock:'',gst_pct:0,category:'Books'};
function Inventory({products,reload,isOwner}){
  const [n,setN]=useState(blank), [ai,setAi]=useState(null), [q,setQ]=useState('');
  const shown=products.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())), low=products.filter(p=>p.stock<=p.min_stock).length, value=products.reduce((s,p)=>s+p.price*p.stock,0);
  const save = async p => { await api(`/products/${p.id}`,{method:'PUT',body:p}); reload(); };
  const addP = async e => { e.preventDefault(); await api('/products',{method:'POST',body:n}); setN(blank); reload(); };
  return <div><div className="stats"><div className="stat"><span>Items</span><b>{products.length}</b></div><div className="stat"><span>Low stock</span><b className={low?'low':''}>{low}</b></div><div className="stat"><span>Stock value</span><b>₹{value.toLocaleString('en-IN')}</b></div></div>
    <form className="row card" onSubmit={addP}>
    <input required placeholder="Item name" value={n.name} onChange={e=>setN({...n,name:e.target.value})}/>
    <select value={n.category} onChange={e=>setN({...n,category:e.target.value})}>{['Books','Notebooks','Pens','Art','Other'].map(c=><option key={c}>{c}</option>)}</select>
    <input required type="number" placeholder="Price ₹" style={{width:90}} value={n.price} onChange={e=>setN({...n,price:e.target.value})}/>
    <input required type="number" placeholder="Stock" style={{width:80}} value={n.stock} onChange={e=>setN({...n,stock:e.target.value})}/>
    <input type="number" placeholder="GST %" style={{width:80}} value={n.gst_pct} onChange={e=>setN({...n,gst_pct:e.target.value})}/>
    <button className="b">Add item</button>{isOwner&&<button type="button" className="b alt" onClick={async()=>setAi(await api('/ai/reorder'))}>What should I reorder?</button>}</form>
    {ai&&<div className="sheet">{ai.length?ai.map(a=><div key={a.id}>{a.name}: order <b>{a.suggested_order}</b> ({a.stock} left{a.days_left!=null&&`, ~${a.days_left} days`})</div>):'Stock looks healthy.'}</div>}
    <input className="search" placeholder="Search items…" value={q} onChange={e=>setQ(e.target.value)}/>
    <div className="card tbl"><table><thead><tr><th>Item</th><th>Price</th><th>Stock</th><th>GST%</th><th></th></tr></thead><tbody>{shown.map(p=>
      <tr key={p.id}><td>{p.name}</td><td><input type="number" defaultValue={p.price} style={{width:80}} onBlur={e=>+e.target.value!==p.price&&save({...p,price:+e.target.value})}/></td>
      <td><input type="number" defaultValue={p.stock} style={{width:70}} className={p.stock<=p.min_stock?'low':''} onBlur={e=>+e.target.value!==p.stock&&save({...p,stock:+e.target.value})}/></td><td>{p.gst_pct}</td>
      <td>{isOwner&&<button className="x" aria-label={`Delete ${p.name}`} onClick={async()=>{if(confirm(`Delete ${p.name}?`)){await api(`/products/${p.id}`,{method:'DELETE'});reload();}}}>×</button>}</td></tr>)}</tbody></table></div></div>;
}

function Sets({products,isOwner}){
  const [sets,setSets]=useState([]), [sel,setSel]=useState(null), [items,setItems]=useState([]), [std,setStd]=useState(STANDARDS[0]), [school,setSchool]=useState(''), [saved,setSaved]=useState(''), [copy,setCopy]=useState('');
  const load=useCallback(()=>api('/sets').then(setSets),[]); useEffect(()=>{load()},[load]);
  const open = async s => { setSel(s); setItems(await api(`/sets/${s.id}/items`)); setSaved(''); };
  const create = async () => { const sc=school.trim(); const d=await api('/sets',{method:'POST',body:{standard:std,school:sc,copy_from:copy||undefined}}); await load(); setSchool(''); setCopy(''); open({id:d.id,standard:std,school:sc}); };
  const save = async () => { await api(`/sets/${sel.id}/items`,{method:'PUT',body:{items:items.map(i=>({product_id:i.id,qty:i.qty}))}}); setSaved('Set saved'); };
  return <div className="grid"><div><h2>Book sets</h2>
    <div className="row"><select value={std} onChange={e=>setStd(e.target.value)}>{STANDARDS.map(s=><option key={s}>{s}</option>)}</select><input placeholder="School name (optional)" value={school} onChange={e=>setSchool(e.target.value)}/><select value={copy} onChange={e=>setCopy(e.target.value)}><option value="">Start empty</option>{sets.map(s=><option key={s.id} value={s.id}>Copy of {s.standard}{s.school&&` · ${s.school}`}</option>)}</select><button className="b" onClick={create}>Create set</button></div>
    <div className="chips">{sets.map(s=><button key={s.id} className={sel?.id===s.id?'on':''} onClick={()=>open(s)}>{s.standard}{s.school&&` · ${s.school}`}</button>)}</div></div>
    {sel&&<div className="sheet"><h2>{sel.standard}{sel.school&&` · ${sel.school}`} set</h2>
      {items.map(i=><div key={i.id}>{i.name} <input type="number" min="1" value={i.qty} style={{width:60}} onChange={e=>setItems(items.map(x=>x.id===i.id?{...x,qty:+e.target.value}:x))}/> <button className="x" aria-label={`Remove ${i.name}`} onClick={()=>setItems(items.filter(x=>x.id!==i.id))}>×</button></div>)}
      <select onChange={e=>{const p=products.find(x=>x.id==e.target.value); if(p&&!items.find(i=>i.id===p.id)) setItems([...items,{...p,qty:1}]); e.target.value='';}}><option value="">Add item to set…</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <div className="row"><button className="b alt" onClick={save}>Save set</button>{isOwner&&<button className="b" style={{background:'var(--bad)'}} onClick={async()=>{if(confirm('Delete this set?')){await api(`/sets/${sel.id}`,{method:'DELETE'});setSel(null);load();}}}>Delete set</button>}<span>{saved}</span></div></div>}</div>;
}

function Settings({user,onSave}){
  const [s,setS]=useState(user.shop||{}), [msg,setMsg]=useState('');
  useEffect(()=>{api('/shop').then(setS)},[]);
  const set=k=>e=>setS({...s,[k]:e.target.value});
  const save=async e=>{e.preventDefault(); try{const d=await api('/shop',{method:'PUT',body:s}); onSave(d); setMsg('Saved. New invoices will use these details.');}catch(x){setMsg(x.message)}};
  return <form className="card settings" onSubmit={save}><h2>Shop details on your invoices</h2>
    <label>Shop name<input required value={s.name||''} onChange={set('name')}/></label>
    <label>Address<input value={s.address||''} onChange={set('address')}/></label>
    <div className="two"><label>Phone<input value={s.phone||''} onChange={set('phone')}/></label><label>GSTIN<input value={s.gstin||''} onChange={set('gstin')}/></label></div>
    <label>Invoice footer note<input value={s.invoice_note||''} onChange={set('invoice_note')} placeholder="Thank you for shopping with us!"/></label>
    <div className="row"><button className="b">Save details</button><span>{msg}</span></div></form>;
}

export default function App(){
  const [user,setUser]=useState(()=>localStorage.user&&JSON.parse(localStorage.user)), [tab,setTab]=useState('Billing'), [products,setProducts]=useState([]);
  const reload=useCallback(()=>api('/products').then(setProducts).catch(()=>{localStorage.clear();setUser(null)}),[]);
  useEffect(()=>{user&&reload()},[user,reload]);
  if(!user) return <Login onIn={setUser}/>;
  const isOwner=user.role==='owner';
  const tabs=[['Billing','Billing'],['Inventory','Inventory'],['Book sets','Book sets'],...(isOwner?[['Settings','Settings']]:[])];
  return <div className="app"><aside className="side"><div><div className="brand"><span className="logo">K</span>KalamDesk</div><div className="shopname">{user.shop?.name}</div></div>
    <nav>{tabs.map(([t,l])=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{l}</button>)}</nav>
    <div className="who"><b>{user.name||'You'}</b><span>{user.role}</span><button onClick={()=>{localStorage.clear();setUser(null)}}>Log out</button></div></aside>
    <main><h2 className="page">{tab}</h2>{tab==='Billing'&&<Billing products={products} reload={reload}/>}{tab==='Inventory'&&<Inventory products={products} reload={reload} isOwner={isOwner}/>}{tab==='Book sets'&&<Sets products={products} isOwner={isOwner}/>}{tab==='Settings'&&<Settings user={user} onSave={shop=>{const u={...user,shop};localStorage.user=JSON.stringify(u);setUser(u);}}/>}</main></div>;
}