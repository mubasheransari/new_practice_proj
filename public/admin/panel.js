const API = (path) => `${location.origin}/api${path}`;
let token = null;

function setAuth(tok, user) {
  token = tok;
  document.getElementById('whoami').textContent = user ? `${user.email} (${user.role})` : '';
}

async function call(method, path, body) {
  const res = await fetch(API(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

document.getElementById('btnLogin').onclick = async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  try {
    const { user, token } = await call('POST', '/auth/login', { email, password });
    setAuth(token, user);
    await loadSkus();
    await loadSales();
  } catch (e) { alert(e.message); }
};

async function loadSkus() {
  const data = await call('GET', '/skus');
  const rows = document.getElementById('skuRows');
  const saleSku = document.getElementById('saleSku');
  rows.innerHTML = '';
  saleSku.innerHTML = '';
  data.skus.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.id}</td>
      <td>${s.code}</td>
      <td>${s.name}</td>
      <td>${s.price}</td>
      <td><button data-id="${s.id}" class="danger delSku">Delete</button></td>
    `;
    rows.appendChild(tr);

    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.code} — ${s.name} (${s.price})`;
    saleSku.appendChild(opt);
  });

  document.querySelectorAll('.delSku').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete SKU?')) return;
      try {
        await call('DELETE', `/skus/${btn.dataset.id}`);
        await loadSkus();
      } catch (e) { alert(e.message); }
    };
  });
}

document.getElementById('btnCreateSku').onclick = async () => {
  const code = document.getElementById('skuCode').value.trim();
  const name = document.getElementById('skuName').value.trim();
  const price = Number(document.getElementById('skuPrice').value || 0);
  if (!code || !name) return alert('code & name required');
  try {
    await call('POST', '/skus', { code, name, price });
    document.getElementById('skuCode').value = '';
    document.getElementById('skuName').value = '';
    document.getElementById('skuPrice').value = '';
    await loadSkus();
  } catch (e) { alert(e.message); }
};

async function loadSales() {
  const data = await call('GET', '/sales');
  const rows = document.getElementById('saleRows');
  rows.innerHTML = '';
  data.sales.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.id}</td>
      <td>${s.userEmail} (#${s.userId})</td>
      <td>${s.skuCode} — ${s.skuName}</td>
      <td>${s.quantity}</td>
      <td>${s.amount}</td>
      <td>${new Date(s.createdAt).toLocaleString()}</td>
    `;
    rows.appendChild(tr);
  });
}

document.getElementById('btnCreateSale').onclick = async () => {
  const userId = document.getElementById('saleUserId').value.trim();
  const skuId = Number(document.getElementById('saleSku').value);
  const quantity = Number(document.getElementById('saleQty').value || 1);
  const note = document.getElementById('saleNote').value;
  try {
    await call('POST', '/sales', { userId: userId || undefined, skuId, quantity, note });
    document.getElementById('saleQty').value = '1';
    document.getElementById('saleNote').value = '';
    await loadSales();
  } catch (e) { alert(e.message); }
};

// Attendance
document.getElementById('btnLoadAtt').onclick = async () => {
  const uid = document.getElementById('attUserId').value.trim();
  const path = uid ? `/attendance?userId=${encodeURIComponent(uid)}` : '/attendance';
  try {
    const data = await call('GET', path);
    const rows = document.getElementById('attRows');
    rows.innerHTML = '';
    data.attendance.slice(0, 50).forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${a.id}</td>
        <td>#${a.userId}</td>
        <td>${a.action}</td>
        <td>${a.lat || ''}</td>
        <td>${a.lng || ''}</td>
        <td>${new Date(a.createdAt).toLocaleString()}</td>
      `;
      rows.appendChild(tr);
    });
  } catch (e) { alert(e.message); }
};
