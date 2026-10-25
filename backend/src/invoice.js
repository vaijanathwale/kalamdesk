import PDFDocument from 'pdfkit';

const X = 40, W = 515, INK = '#16163f', BRAND = '#3f37c9', MUTE = '#6b6f93', LINE = '#e4e7f4', SOFT = '#f3f5fb', HI = '#ffe45e';
const money = n => 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
const three = n => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
export function inWords(num) {
  const r = Math.round(num * 100), paise = r % 100; let n = Math.floor(r / 100), s = '';
  for (const [v, l] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) if (n >= v) { s += three(Math.floor(n / v)) + ' ' + l + ' '; n %= v; }
  if (n) s += three(n);
  return 'Rupees ' + (s.trim() || 'Zero') + (paise ? ` and ${two(paise)} Paise` : '') + ' Only';
}

export function buildInvoicePdf(shop, inv, items) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 }), bufs = [];
    doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs)));

    // ---- header band with the shop's own details
    const sub = [shop.address, shop.phone && 'Phone: ' + shop.phone, shop.gstin && 'GSTIN: ' + shop.gstin].filter(Boolean).join('\n');
    doc.font('Helvetica-Bold').fontSize(22);
    const nameH = doc.heightOfString(shop.name, { width: 330 });
    doc.font('Helvetica').fontSize(9.5);
    const subH = sub ? doc.heightOfString(sub, { width: 330 }) : 0;
    const headH = Math.max(96, 30 + nameH + 6 + subH + 22);
    doc.rect(0, 0, 595, headH).fill(INK);
    doc.rect(0, headH, 595, 4).fill(HI);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(shop.name, X, 30, { width: 330 });
    if (sub) doc.font('Helvetica').fontSize(9.5).fillColor('#c9cbf0').text(sub, X, 30 + nameH + 6, { width: 330 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(HI).text(shop.gstin ? 'TAX INVOICE' : 'INVOICE', X + 300, 32, { width: 215, align: 'right' });

    // ---- billed to + invoice meta
    let y = headH + 28;
    doc.fillColor(MUTE).font('Helvetica').fontSize(9).text('Billed to', X, y);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(inv.customer_name || 'Walk-in customer', X, y + 14, { width: 280 });
    doc.font('Helvetica').fontSize(10).fillColor(MUTE).text([inv.phone && 'Phone: ' + inv.phone, inv.email].filter(Boolean).join('\n') || ' ', X, doc.y + 2, { width: 280 });
    const date = new Date(inv.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    [['Invoice no.', '#' + (inv.invoice_no || inv.id)], ['Date', date]].forEach(([k, v], i) => {
      doc.font('Helvetica').fontSize(10).fillColor(MUTE).text(k, X + 330, y + i * 20, { width: 90 });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(v, X + 410, y + i * 20 - 1, { width: 105, align: 'right' });
    });
    y = Math.max(doc.y, y + 50) + 22;

    // ---- items table
    const cols = [['#', X + 10, 22, 'left'], ['Item', X + 38, 200, 'left'], ['Qty', X + 242, 40, 'right'], ['Rate', X + 288, 70, 'right'], ['GST', X + 362, 45, 'right'], ['Amount', X + 412, 93, 'right']];
    const head = () => {
      doc.rect(X, y, W, 26).fill(SOFT);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTE);
      cols.forEach(([t, x, w, a]) => doc.text(t, x, y + 8, { width: w, align: a }));
      y += 26;
    };
    head();
    let taxable = 0, tax = 0;
    items.forEach((it, i) => {
      const base = it.price * it.qty, gst = base * it.gst_pct / 100; taxable += base; tax += gst;
      doc.font('Helvetica').fontSize(10);
      const h = Math.max(26, doc.heightOfString(it.name, { width: 200 }) + 14);
      if (y + h > 740) { doc.addPage(); y = 40; head(); }
      doc.fillColor(INK);
      [[i + 1], [it.name], [it.qty], [money(it.price)], [it.gst_pct + '%'], [money(base)]].forEach(([v], c) => doc.text(String(v), cols[c][1], y + 7, { width: cols[c][2], align: cols[c][3] }));
      doc.moveTo(X, y + h).lineTo(X + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      y += h;
    });

    // ---- totals
    if (y > 620) { doc.addPage(); y = 40; }
    y += 18;
    const rows = [['Subtotal', taxable]];
    if (tax > 0) rows.push(['CGST', tax / 2], ['SGST', tax / 2]);
    if (Number(inv.discount) > 0) rows.push(['Discount', -inv.discount]);
    const ty = y;
    rows.forEach(([k, v], i) => {
      doc.font('Helvetica').fontSize(10.5).fillColor(MUTE).text(k, X + 290, y + i * 20, { width: 100 });
      doc.fillColor(INK).text((v < 0 ? '- ' : '') + money(Math.abs(v)), X + 390, y + i * 20, { width: 125, align: 'right' });
    });
    y += rows.length * 20 + 6;
    doc.roundedRect(X + 280, y, 235, 36, 8).fill(BRAND);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('Grand total', X + 294, y + 12, { width: 100 });
    doc.fontSize(14).text(money(inv.total), X + 380, y + 10, { width: 124, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTE).text('Amount in words', X, ty);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(inWords(inv.total), X, ty + 14, { width: 225 });
    y += 36;

    // ---- signature + footer
    y = Math.max(y + 40, 690);
    if (y > 740) { doc.addPage(); y = 600; }
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTE).text('For ' + shop.name, X + 300, y, { width: 215, align: 'right' });
    doc.moveTo(X + 345, y + 48).lineTo(X + W, y + 48).lineWidth(0.6).strokeColor(MUTE).stroke();
    doc.text('Authorised signatory', X + 300, y + 54, { width: 215, align: 'right' });
    doc.moveTo(X, 790).lineTo(X + W, 790).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(shop.invoice_note || 'Thank you for shopping with us!', X, 800, { width: W, align: 'center' });
    doc.end();
  });
}