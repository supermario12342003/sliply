/**
 * Sliply — client-side receipt generator & local ledger
 * All data stays in localStorage. Free tier: max FREE_LIMIT receipts + watermark.
 */
(function () {
  'use strict';

  const BRAND = 'Sliply';
  const STORAGE_KEY = 'sliply_ledger_v1';
  const DRAFT_KEY = 'sliply_draft_v1';
  const WAITLIST_KEY = 'sliply_waitlist_v1';
  const FREE_LIMIT = 10;
  const CURRENCY = 'EUR';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function uid() {
    return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function formatMoney(n, currency = CURRENCY) {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(v);
    } catch {
      return v.toFixed(2) + ' €';
    }
  }

  function todayISO() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toast(msg) {
    let el = $('#sliply-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sliply-toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function loadLedger() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveLedger(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function nextNumber(list) {
    const nums = list
      .map((r) => parseInt(String(r.number).replace(/\D/g, ''), 10))
      .filter((n) => !Number.isNaN(n));
    const max = nums.length ? Math.max(...nums) : 0;
    const year = new Date().getFullYear();
    return `${year}-${String(max + 1).padStart(4, '0')}`;
  }

  function blankItem() {
    return { description: '', qty: 1, price: 0 };
  }

  function blankReceipt(list) {
    return {
      id: uid(),
      number: nextNumber(list),
      date: todayISO(),
      from: '',
      to: '',
      notes: '',
      taxRate: 0,
      currency: CURRENCY,
      items: [blankItem(), blankItem()],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function calc(receipt) {
    const items = (receipt.items || []).map((it) => {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price) || 0;
      return { ...it, qty, price, lineTotal: qty * price };
    });
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const taxRate = Number(receipt.taxRate) || 0;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    return { items, subtotal, tax, total, taxRate };
  }

  /* ---------- Waitlist (pricing page) ---------- */
  function initWaitlist() {
    const form = $('#waitlist-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = ($('#waitlist-email') || {}).value?.trim() || '';
      const plan = (form.querySelector('input[name="plan"]:checked') || {}).value || 'monthly';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast('Please enter a valid email.');
        return;
      }
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem(WAITLIST_KEY) || '[]');
      } catch { list = []; }
      list.push({ email, plan, at: new Date().toISOString() });
      localStorage.setItem(WAITLIST_KEY, JSON.stringify(list));
      const mailto = `mailto:hello@sliply.app?subject=${encodeURIComponent('Sliply Pro waitlist')}&body=${encodeURIComponent(`Email: ${email}\nPlan interest: ${plan}\n\n(I joined the waitlist from the pricing page.)`)}`;
      toast('Saved locally. Opening email draft…');
      form.reset();
      setTimeout(() => { window.location.href = mailto; }, 400);
    });
  }

  /* ---------- Main app ---------- */
  function initApp() {
    const formRoot = $('#receipt-form');
    if (!formRoot) return;

    let ledger = loadLedger();
    let current = null;
    let draft = null;

    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch { draft = null; }

    if (draft && draft.id) {
      current = draft;
    } else {
      current = blankReceipt(ledger);
    }

    const els = {
      number: $('#f-number'),
      date: $('#f-date'),
      from: $('#f-from'),
      to: $('#f-to'),
      notes: $('#f-notes'),
      taxRate: $('#f-tax'),
      currency: $('#f-currency'),
      itemsBody: $('#items-body'),
      ledgerList: $('#ledger-list'),
      limitInfo: $('#limit-info'),
      subtotal: $('#sum-subtotal'),
      tax: $('#sum-tax'),
      total: $('#sum-total'),
      preview: $('#receipt-preview'),
    };

    function persistDraft() {
      current.updatedAt = new Date().toISOString();
      localStorage.setItem(DRAFT_KEY, JSON.stringify(current));
    }

    function readFormIntoCurrent() {
      current.number = els.number.value.trim() || current.number;
      current.date = els.date.value || todayISO();
      current.from = els.from.value;
      current.to = els.to.value;
      current.notes = els.notes.value;
      current.taxRate = Number(els.taxRate.value) || 0;
      current.currency = els.currency.value || CURRENCY;
      current.items = $$('#items-body tr').map((row) => ({
        description: $('input[data-f="description"]', row)?.value || '',
        qty: Number($('input[data-f="qty"]', row)?.value) || 0,
        price: Number($('input[data-f="price"]', row)?.value) || 0,
      }));
    }

    function renderItems() {
      const tbody = els.itemsBody;
      tbody.innerHTML = '';
      (current.items || []).forEach((it, idx) => {
        const line = (Number(it.qty) || 0) * (Number(it.price) || 0);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="col-desc"><input data-f="description" type="text" placeholder="Description" value="${escapeAttr(it.description)}" /></td>
          <td class="col-qty"><input data-f="qty" type="number" min="0" step="0.01" value="${it.qty}" /></td>
          <td class="col-price"><input data-f="price" type="number" min="0" step="0.01" value="${it.price}" /></td>
          <td class="col-total mono">${formatMoney(line, current.currency)}</td>
          <td class="col-act"><button type="button" class="btn btn-ghost btn-sm" data-remove="${idx}" title="Remove" aria-label="Remove line">✕</button></td>
        `;
        tbody.appendChild(tr);
      });
      $$('input', tbody).forEach((inp) => {
        inp.addEventListener('input', () => {
          readFormIntoCurrent();
          updateTotalsAndPreview(false);
          persistDraft();
        });
      });
      $$('[data-remove]', tbody).forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-remove'));
          readFormIntoCurrent();
          current.items.splice(i, 1);
          if (!current.items.length) current.items.push(blankItem());
          renderItems();
          updateTotalsAndPreview();
          persistDraft();
        });
      });
    }

    function fillForm() {
      els.number.value = current.number || '';
      els.date.value = current.date || todayISO();
      els.from.value = current.from || '';
      els.to.value = current.to || '';
      els.notes.value = current.notes || '';
      els.taxRate.value = current.taxRate ?? 0;
      els.currency.value = current.currency || CURRENCY;
      renderItems();
      updateTotalsAndPreview();
    }

    function updateTotalsAndPreview(rerenderItems = true) {
      if (rerenderItems) {
        // refresh line totals only
        $$('#items-body tr').forEach((row) => {
          const qty = Number($('input[data-f="qty"]', row)?.value) || 0;
          const price = Number($('input[data-f="price"]', row)?.value) || 0;
          const cell = $('.col-total', row);
          if (cell) cell.textContent = formatMoney(qty * price, current.currency);
        });
      }
      readFormIntoCurrent();
      const c = calc(current);
      els.subtotal.textContent = formatMoney(c.subtotal, current.currency);
      els.tax.textContent = formatMoney(c.tax, current.currency);
      els.total.textContent = formatMoney(c.total, current.currency);
      renderPreview(c);
    }

    function renderPreview(c) {
      const preview = els.preview;
      const hasTax = c.taxRate > 0;
      const rows = c.items
        .filter((it) => it.description || it.lineTotal)
        .map(
          (it) => `<tr>
            <td>${escapeHtml(it.description) || '—'}</td>
            <td class="num">${escapeHtml(String(it.qty))}</td>
            <td class="num">${formatMoney(it.price, current.currency)}</td>
            <td class="num">${formatMoney(it.lineTotal, current.currency)}</td>
          </tr>`
        )
        .join('');

      preview.innerHTML = `
        <div class="watermark" aria-hidden="true">${BRAND} Free</div>
        <div class="receipt-head">
          <div>
            <div class="receipt-brand">${BRAND}</div>
            <div style="font-size:0.8rem;color:var(--muted);margin-top:0.2rem">Receipt</div>
          </div>
          <div class="receipt-meta">
            <strong>Nº ${escapeHtml(current.number)}</strong>
            <div>${escapeHtml(current.date || '')}</div>
          </div>
        </div>
        <div class="parties">
          <div>
            <h4>From</h4>
            <pre>${escapeHtml(current.from) || '—'}</pre>
          </div>
          <div>
            <h4>To / Bill to</h4>
            <pre>${escapeHtml(current.to) || '—'}</pre>
          </div>
        </div>
        <table class="preview-table">
          <thead>
            <tr>
              <th>Description</th>
              <th class="num">Qty</th>
              <th class="num">Price</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" style="color:var(--muted)">No line items yet</td></tr>'}</tbody>
        </table>
        <div class="totals">
          <div class="row"><span>Subtotal</span><span class="mono">${formatMoney(c.subtotal, current.currency)}</span></div>
          ${hasTax ? `<div class="row"><span>Tax (${escapeHtml(String(c.taxRate))}%)</span><span class="mono">${formatMoney(c.tax, current.currency)}</span></div>` : ''}
          <div class="row grand"><span>Total</span><span class="mono">${formatMoney(c.total, current.currency)}</span></div>
        </div>
        ${current.notes ? `<div class="preview-notes"><strong>Notes:</strong> ${escapeHtml(current.notes)}</div>` : ''}
        <div class="powered-by">Powered by <strong>${BRAND}</strong> · Free plan</div>
      `;
    }

    function renderLedger() {
      const list = els.ledgerList;
      const info = els.limitInfo;
      ledger = loadLedger();
      const count = ledger.length;
      if (info) {
        info.innerHTML =
          count >= FREE_LIMIT
            ? `Free ledger full (${FREE_LIMIT}/${FREE_LIMIT}). Delete an entry or <a href="pricing.html">join Pro waitlist</a> for unlimited.`
            : `Free plan: <strong>${count}/${FREE_LIMIT}</strong> receipts saved on this device. <a href="pricing.html">Pro coming soon</a> — unlimited + no watermark.`;
      }
      if (!ledger.length) {
        list.innerHTML = `<li class="ledger-empty">No saved receipts yet. Create one and hit <strong>Save to ledger</strong>.</li>`;
        return;
      }
      const sorted = [...ledger].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      list.innerHTML = sorted
        .map((r) => {
          const c = calc(r);
          const active = r.id === current.id ? ' active' : '';
          return `<li class="ledger-item${active}" data-id="${escapeAttr(r.id)}" tabindex="0" role="button">
            <div>
              <div class="title">Nº ${escapeHtml(r.number)} · ${escapeHtml((r.to || '').split('\n')[0] || 'Untitled')}</div>
              <div class="meta">${escapeHtml(r.date || '')} · updated ${escapeHtml((r.updatedAt || '').slice(0, 10))}</div>
            </div>
            <div class="amount">${formatMoney(c.total, r.currency || CURRENCY)}</div>
          </li>`;
        })
        .join('');

      $$('.ledger-item', list).forEach((el) => {
        const open = () => {
          const id = el.getAttribute('data-id');
          const found = ledger.find((x) => x.id === id);
          if (!found) return;
          current = JSON.parse(JSON.stringify(found));
          fillForm();
          persistDraft();
          renderLedger();
          toast('Loaded receipt Nº ' + current.number);
        };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            open();
          }
        });
      });
    }

    function saveToLedger() {
      readFormIntoCurrent();
      const c = calc(current);
      if (!current.from.trim() && !current.to.trim() && !c.items.some((i) => i.description)) {
        toast('Add at least a party or a line item before saving.');
        return;
      }
      ledger = loadLedger();
      const idx = ledger.findIndex((r) => r.id === current.id);
      current.updatedAt = new Date().toISOString();
      if (idx >= 0) {
        ledger[idx] = JSON.parse(JSON.stringify(current));
        saveLedger(ledger);
        persistDraft();
        renderLedger();
        toast('Receipt updated in ledger.');
        return;
      }
      if (ledger.length >= FREE_LIMIT) {
        toast(`Free limit reached (${FREE_LIMIT}). Delete one or join the Pro waitlist.`);
        return;
      }
      if (!current.createdAt) current.createdAt = new Date().toISOString();
      ledger.push(JSON.parse(JSON.stringify(current)));
      saveLedger(ledger);
      persistDraft();
      renderLedger();
      toast('Saved to on-device ledger.');
    }

    function newReceipt() {
      readFormIntoCurrent();
      ledger = loadLedger();
      current = blankReceipt(ledger);
      fillForm();
      persistDraft();
      renderLedger();
      toast('New blank receipt.');
    }

    function deleteCurrent() {
      ledger = loadLedger();
      const idx = ledger.findIndex((r) => r.id === current.id);
      if (idx < 0) {
        newReceipt();
        toast('Draft cleared.');
        return;
      }
      if (!confirm('Delete this receipt from the on-device ledger?')) return;
      ledger.splice(idx, 1);
      saveLedger(ledger);
      current = blankReceipt(ledger);
      fillForm();
      persistDraft();
      renderLedger();
      toast('Deleted.');
    }

    function printReceipt() {
      readFormIntoCurrent();
      updateTotalsAndPreview();
      window.print();
    }

    async function downloadPdf() {
      readFormIntoCurrent();
      const c = calc(current);
      if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
        // jspdf UMD exposes window.jspdf.jsPDF
        toast('PDF library still loading — try again in a second.');
        return;
      }
      const { jsPDF } = window.jspdf || {};
      const Doc = jsPDF || window.jsPDF;
      if (!Doc) {
        toast('PDF library unavailable. Use Print instead.');
        return;
      }
      const doc = new Doc({ unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 16;
      let y = margin;

      // Watermark
      doc.setTextColor(200, 230, 225);
      doc.setFontSize(42);
      doc.setFont('helvetica', 'bold');
      doc.saveGraphicsState?.();
      try {
        doc.setGState(new doc.GState({ opacity: 0.18 }));
      } catch (_) { /* older jspdf */ }
      doc.text(`${BRAND} FREE`, pageW / 2, 140, { align: 'center', angle: 35 });
      try {
        doc.setGState(new doc.GState({ opacity: 1 }));
      } catch (_) {}

      doc.setTextColor(15, 23, 42);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(BRAND, margin, y);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Receipt', margin, y + 6);

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`Nº ${current.number}`, pageW - margin, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(current.date || '', pageW - margin, y + 6, { align: 'right' });

      y += 18;
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageW - margin, y);
      y += 10;

      const colW = (pageW - margin * 2 - 6) / 2;
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('FROM', margin, y);
      doc.text('TO / BILL TO', margin + colW + 6, y);
      y += 5;
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const fromLines = doc.splitTextToSize(current.from || '—', colW);
      const toLines = doc.splitTextToSize(current.to || '—', colW);
      doc.text(fromLines, margin, y);
      doc.text(toLines, margin + colW + 6, y);
      y += Math.max(fromLines.length, toLines.length) * 5 + 8;

      // Table header
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const cols = [
        { x: margin, label: 'DESCRIPTION', w: 80 },
        { x: margin + 82, label: 'QTY', w: 20 },
        { x: margin + 104, label: 'PRICE', w: 30 },
        { x: margin + 138, label: 'AMOUNT', w: 40 },
      ];
      cols.forEach((col) => doc.text(col.label, col.x, y));
      y += 2;
      doc.setDrawColor(15, 23, 42);
      doc.line(margin, y, pageW - margin, y);
      y += 6;

      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const lines = c.items.filter((it) => it.description || it.lineTotal);
      if (!lines.length) {
        doc.setTextColor(148, 163, 184);
        doc.text('No line items', margin, y);
        y += 8;
      } else {
        lines.forEach((it) => {
          if (y > 260) {
            doc.addPage();
            y = margin;
          }
          const desc = doc.splitTextToSize(it.description || '—', 78);
          doc.text(desc, margin, y);
          doc.text(String(it.qty), margin + 82, y);
          doc.text(formatMoney(it.price, current.currency), margin + 104, y);
          doc.text(formatMoney(it.lineTotal, current.currency), pageW - margin, y, { align: 'right' });
          y += Math.max(desc.length * 5, 7);
          doc.setDrawColor(226, 232, 240);
          doc.line(margin, y - 2, pageW - margin, y - 2);
        });
      }

      y += 6;
      const right = pageW - margin;
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      doc.text('Subtotal', right - 55, y);
      doc.text(formatMoney(c.subtotal, current.currency), right, y, { align: 'right' });
      y += 6;
      if (c.taxRate > 0) {
        doc.text(`Tax (${c.taxRate}%)`, right - 55, y);
        doc.text(formatMoney(c.tax, current.currency), right, y, { align: 'right' });
        y += 6;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('Total', right - 55, y);
      doc.text(formatMoney(c.total, current.currency), right, y, { align: 'right' });
      y += 10;

      if (current.notes) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text('Notes', margin, y);
        y += 5;
        doc.setTextColor(51, 65, 85);
        const noteLines = doc.splitTextToSize(current.notes, pageW - margin * 2);
        doc.text(noteLines, margin, y);
        y += noteLines.length * 4.5 + 6;
      }

      // Free footer
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Powered by ${BRAND} · Free plan`, pageW / 2, 287, { align: 'center' });

      const safeName = String(current.number || 'receipt').replace(/[^\w.-]+/g, '_');
      doc.save(`sliply-receipt-${safeName}.pdf`);
      toast('PDF downloaded (free watermark included).');
    }

    // Bind top-level fields
    [els.number, els.date, els.from, els.to, els.notes, els.taxRate, els.currency].forEach((el) => {
      el?.addEventListener('input', () => {
        readFormIntoCurrent();
        updateTotalsAndPreview(false);
        persistDraft();
      });
    });

    $('#btn-add-item')?.addEventListener('click', () => {
      readFormIntoCurrent();
      current.items.push(blankItem());
      renderItems();
      updateTotalsAndPreview();
      persistDraft();
    });
    $('#btn-save')?.addEventListener('click', saveToLedger);
    $('#btn-new')?.addEventListener('click', newReceipt);
    $('#btn-delete')?.addEventListener('click', deleteCurrent);
    $('#btn-print')?.addEventListener('click', printReceipt);
    $('#btn-pdf')?.addEventListener('click', () => { downloadPdf().catch(() => toast('PDF failed. Try Print.')); });

    fillForm();
    renderLedger();
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    initApp();
    initWaitlist();
  });
})();
