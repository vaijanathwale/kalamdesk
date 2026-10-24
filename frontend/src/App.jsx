import {useState,useEffect,useCallback} from 'react';

const api = async (path, opts={}) => {
  const r = await fetch('/api'+path, {...opts, headers:{'Content-Type':'application/json', Authorization:'Bearer '+(localStorage.token||'')}, body: opts.body && JSON.stringify(opts.body)});
  const ct = r.headers.get('content-type')||''; const d = ct.includes('json') ? await r.json() : await r.blob();
  if(!r.ok) throw new Error(d.error||'Something went wrong'); return d;
};
const STANDARDS = ['Nursery','LKG','UKG',...Array.from({length:12},(_,i)=>`${i+1}${['st','nd','rd'][i]||'th'} Standard`)];

function Login({onIn}){
  const [f,setF]=useState({}), [reg,setReg]=useState(false), [err,setErr]=useState('');
  const go = async e => { e.preventDefault(); try{ const d=await api(`/auth/${reg?'register':'login'}`,{method:'POST',body:f}); localStorage.token=d.token; localStorage.user=JSON.stringify(d.user); onIn(d.user);}catch(x){setErr(x.message)} };
  return <main style={{maxWidth:380}}><h1 style={{fontSize:40,margin:'60px 0 16px'}}>KalamDesk</h1>
    <form onSubmit={go} className="sheet">
      {reg&&<div><input placeholder="Your name" onChange={e=>setF({...f,name:e.target.value})}/></div>}
      <div><input type="email" placeholder="Email" required onChange={e=>setF({...f,email:e.target.value})}/></div>
      <div><input type="password" placeholder="Password" required onChange={e=>setF({...f,password:e.target.value})}/></div>
      <button className="b">{reg?'Create account':'Log in'}</button> <button type="button" className="x" style={{fontSize:14,color:'inherit'}} onClick={()=>setReg(!reg)}>{reg?'I have an account':'New shop? Register'}</button>
      <div className="err">{err}</div></form></main>;
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
    {!done ? <button className="b alt" disabled={!cart.length} onClick={bill}>Save bill</button> :
      <div className="row"><button className="b" onClick={()=>pdf(true)}>Print</button><button className="b" onClick={()=>pdf(false)}>Download PDF</button><button className="b alt" onClick={wa}>Send on WhatsApp</button><button className="b" onClick={mail}>Email</button><button className="b" onClick={()=>{setDone(null);setCart([]);setSel(null)}}>New bill</button></div>}
    <div className="err">{msg}</div></div></div>;
}

const blank={name:'',price:'',stock:'',gst_pct:0,category:'Books'};
function Inventory({products,reload,isOwner}){
  const [n,setN]=useState(blank), [ai,setAi]=useState(null);
  const save = async p => { await api(`/products/${p.id}`,{method:'PUT',body:p}); reload(); };
  const addP = async e => { e.preventDefault(); await api('/products',{method:'POST',body:n}); setN(blank); reload(); };
  return <div><form className="row" onSubmit={addP}>
    <input required placeholder="Item name" value={n.name} onChange={e=>setN({...n,name:e.target.value})}/>
    <select value={n.category} onChange={e=>setN({...n,category:e.target.value})}>{['Books','Notebooks','Pens','Art','Other'].map(c=><option key={c}>{c}</option>)}</select>
    <input required type="number" placeholder="Price ₹" style={{width:90}} value={n.price} onChange={e=>setN({...n,price:e.target.value})}/>
    <input required type="number" placeholder="Stock" style={{width:80}} value={n.stock} onChange={e=>setN({...n,stock:e.target.value})}/>
    <input type="number" placeholder="GST %" style={{width:80}} value={n.gst_pct} onChange={e=>setN({...n,gst_pct:e.target.value})}/>
    <button className="b">Add item</button>{isOwner&&<button type="button" className="b alt" onClick={async()=>setAi(await api('/ai/reorder'))}>What should I reorder?</button>}</form>
    {ai&&<div className="sheet">{ai.length?ai.map(a=><div key={a.id}>{a.name}: order <b>{a.suggested_order}</b> ({a.stock} left{a.days_left!=null&&`, ~${a.days_left} days`})</div>):'Stock looks healthy.'}</div>}
    <table><thead><tr><th>Item</th><th>Price</th><th>Stock</th><th>GST%</th><th></th></tr></thead><tbody>{products.map(p=>
      <tr key={p.id}><td>{p.name}</td><td><input type="number" defaultValue={p.price} style={{width:80}} onBlur={e=>+e.target.value!==p.price&&save({...p,price:+e.target.value})}/></td>
      <td><input type="number" defaultValue={p.stock} style={{width:70}} className={p.stock<=p.min_stock?'low':''} onBlur={e=>+e.target.value!==p.stock&&save({...p,stock:+e.target.value})}/></td><td>{p.gst_pct}</td>
      <td>{isOwner&&<button className="x" aria-label={`Delete ${p.name}`} onClick={async()=>{if(confirm(`Delete ${p.name}?`)){await api(`/products/${p.id}`,{method:'DELETE'});reload();}}}>×</button>}</td></tr>)}</tbody></table></div>;
}

function Sets({products,isOwner}){
  const [sets,setSets]=useState([]), [sel,setSel]=useState(null), [items,setItems]=useState([]), [std,setStd]=useState(STANDARDS[0]), [school,setSchool]=useState(''), [saved,setSaved]=useState('');
  const load=useCallback(()=>api('/sets').then(setSets),[]); useEffect(()=>{load()},[load]);
  const open = async s => { setSel(s); setItems(await api(`/sets/${s.id}/items`)); setSaved(''); };
  const create = async () => { try{ await api('/sets',{method:'POST',body:{standard:std,school}}); load(); }catch(e){alert('That set already exists')} };
  const save = async () => { await api(`/sets/${sel.id}/items`,{method:'PUT',body:{items:items.map(i=>({product_id:i.id,qty:i.qty}))}}); setSaved('Set saved'); };
  return <div className="grid"><div><h2>Book sets</h2>
    <div className="row"><select value={std} onChange={e=>setStd(e.target.value)}>{STANDARDS.map(s=><option key={s}>{s}</option>)}</select><input placeholder="School (optional)" value={school} onChange={e=>setSchool(e.target.value)}/><button className="b" onClick={create}>Create set</button></div>
    <div className="chips">{sets.map(s=><button key={s.id} className={sel?.id===s.id?'on':''} onClick={()=>open(s)}>{s.standard}{s.school&&` · ${s.school}`}</button>)}</div></div>
    {sel&&<div className="sheet"><h2>{sel.standard} set</h2>
      {items.map(i=><div key={i.id}>{i.name} <input type="number" min="1" value={i.qty} style={{width:60}} onChange={e=>setItems(items.map(x=>x.id===i.id?{...x,qty:+e.target.value}:x))}/> <button className="x" aria-label={`Remove ${i.name}`} onClick={()=>setItems(items.filter(x=>x.id!==i.id))}>×</button></div>)}
      <select onChange={e=>{const p=products.find(x=>x.id==e.target.value); if(p&&!items.find(i=>i.id===p.id)) setItems([...items,{...p,qty:1}]); e.target.value='';}}><option value="">Add item to set…</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <div className="row"><button className="b alt" onClick={save}>Save set</button>{isOwner&&<button className="b" style={{background:'var(--margin)'}} onClick={async()=>{if(confirm('Delete this set?')){await api(`/sets/${sel.id}`,{method:'DELETE'});setSel(null);load();}}}>Delete set</button>}<span>{saved}</span></div></div>}</div>;
}

export default function App(){
  const [user,setUser]=useState(()=>localStorage.user&&JSON.parse(localStorage.user)), [tab,setTab]=useState('Billing'), [products,setProducts]=useState([]);
  const reload=useCallback(()=>api('/products').then(setProducts).catch(()=>{localStorage.clear();setUser(null)}),[]);
  useEffect(()=>{user&&reload()},[user,reload]);
  if(!user) return <Login onIn={setUser}/>;
  const isOwner=user.role==='owner';
  return <><div className="bar"><h1>KalamDesk</h1>{['Billing','Inventory','Book sets'].map(t=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t}</button>)}<button onClick={()=>{localStorage.clear();setUser(null)}}>Log out</button></div>
    <main>{tab==='Billing'&&<Billing products={products} reload={reload}/>}{tab==='Inventory'&&<Inventory products={products} reload={reload} isOwner={isOwner}/>}{tab==='Book sets'&&<Sets products={products} isOwner={isOwner}/>}</main></>;
}
