// ===== config & helpers =====
const API = location.origin + '/api';
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const store = {
  get token(){ return localStorage.getItem('adm_token') || '' },
  set token(v){ localStorage.setItem('adm_token', v || ''); },
  get role(){ return localStorage.getItem('adm_role') || '' },
  set role(v){ localStorage.setItem('adm_role', v || ''); },
  clear(){ localStorage.removeItem('adm_token'); localStorage.removeItem('adm_role'); }
};

function toast(msg, ms=1800){
  toastEl.textContent = msg; toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), ms);
}

async function jfetch(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if (store.token) headers['Authorization'] = 'Bearer ' + store.token;
  const res = await fetch(API + path, {...opts, headers});
  let body=null;
  try{ body = await res.json(); } catch(_){}
  if(!res.ok){
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
  return body;
}

function nav(active){
  const links = [
    ['#/dashboard','Dashboard'],
    ['#/skus','SKUs'],
    ['#/sales','Sales'],
    ['#/attendance','Attendance'],
    ['#/users','Users (admin)'],
    ['#/profile','Profile']
  ];
  return `
    <div class="nav">
      ${links.map(([href,label]) =>
        `<a href="${href}" class="${active===href?'active':''}">${label}</a>`
      ).join('')}
      <span class="right"></span>
      <button onclick="logout()">Logout</button>
    </div>
  `;
}

function guardAdmin(){
  if (store.role !== 'admin') {
    location.hash = '#/dashboard';
    toast('Admin-only section');
    return false;
  }
  return true;
}

window.logout = () => {
  store.clear();
  location.hash = '#/login';
  render();
};

// ===== views =====
function loginView(){
  app.innerHTML = `
    <div class="app">
      <div class="card login-card">
        <h1>Admin Login</h1>
        <div class="row">
          <div class="col">
            <label>Email</label>
            <input id="email" placeholder="admin@local" value="admin@local"/>
          </div>
          <div class="col">
            <label>Password</label>
            <input id="password" type="password" placeholder="••••••" value="admin123"/>
          </div>
        </div>
        <br/>
        <button class="primary" id="btnLogin">Login</button>
        <div id="err" style="color:#ffb4b4;margin-top:8px"></div>
      </div>
    </div>
  `;
  document.getElementById('btnLogin').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    try{
      const res = await jfetch('/auth/login',{
        method:'POST',
        body: JSON.stringify({email,password})
      });
      store.token = res.token;
      store.role  = res.user?.role || 'user';
      toast('Logged in');
      location.hash = '#/dashboard';
      render();
    }catch(e){
      document.getElementById('err').textContent = e.message;
    }
  };
}

async function dashboardView(){
  app.innerHTML = `
    <div class="app">
      ${nav('#/dashboard')}
      <div class="card"><h1>Dashboard</h1>
        <div id="kpis" class="kpi">
          <div class="box"><div class="val">—</div><div class="lbl">Users</div></div>
          <div class="box"><div class="val">—</div><div class="lbl">SKUs</div></div>
          <div class="box"><div class="val">—</div><div class="lbl">Sales</div></div>
          <div class="box"><div class="val">—</div><div class="lbl">Attendance</div></div>
        </div>
      </div>
      <div class="card">
        <h2>Recent Sales</h2>
        <table class="table" id="salesTbl">
          <thead><tr><th>ID</th><th>User</th><th>SKU</th><th>Qty</th><th>At</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  const kpiBoxes = document.querySelectorAll('#kpis .val');
  try{
    // Prefer admin stats if available; fall back to stitched counts
    let stats;
    try { stats = await jfetch('/admin/stats'); }
    catch { stats = null; }

    if(!stats){
      const [skus,sales,att,prof] = await Promise.allSettled([
        jfetch('/skus'),
        jfetch('/admin/sales').catch(_=>jfetch('/sales')),
        jfetch('/attendance/history').catch(_=>({items:[]})),
        jfetch('/profile').catch(_=>({}))
      ]);
      kpiBoxes[0].textContent = (stats?.users ?? (prof.value?.user?1:0)); // rough
      kpiBoxes[1].textContent = (skus.value?.items?.length || skus.value?.length || 0);
      kpiBoxes[2].textContent = (sales.value?.items?.length || sales.value?.length || 0);
      kpiBoxes[3].textContent = (att.value?.items?.length || 0);

      const rows = (sales.value?.items || sales.value || []).slice(0,10)
        .map(s => `<tr>
          <td>${s.id || s.saleId || '-'}</td>
          <td>${s.userEmail || s.userId || '-'}</td>
          <td>${s.sku || '-'}</td>
          <td>${s.quantity || 0}</td>
          <td>${new Date(s.createdAt||s.created_at||Date.now()).toLocaleString()}</td>
        </tr>`).join('');
      document.querySelector('#salesTbl tbody').innerHTML = rows || '<tr><td colspan="5">No data</td></tr>';
    } else {
      kpiBoxes[0].textContent = stats.users || 0;
      kpiBoxes[1].textContent = stats.skus || 0;
      kpiBoxes[2].textContent = stats.sales || 0;
      kpiBoxes[3].textContent = stats.attendance || 0;

      const rows = (stats.recentSales||[]).map(s => `<tr>
        <td>${s.id}</td><td>${s.userEmail}</td><td>${s.sku}</td>
        <td>${s.quantity}</td><td>${new Date(s.createdAt).toLocaleString()}</td>
      </tr>`).join('');
      document.querySelector('#salesTbl tbody').innerHTML = rows || '<tr><td colspan="5">No data</td></tr>';
    }
  }catch(e){
    toast('Dashboard error: ' + e.message);
  }
}

async function skusView(){
  app.innerHTML = `
    <div class="app">
      ${nav('#/skus')}
      <div class="card">
        <h1>SKUs</h1>
        <table class="table" id="skuTbl">
          <thead><tr><th>SKU</th><th>Name</th><th>Price</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  try{
    const data = await jfetch('/skus');
    const items = data.items || data || [];
    document.querySelector('#skuTbl tbody').innerHTML =
      items.map(x => `<tr><td>${x.sku}</td><td>${x.name||'-'}</td><td>${x.price??'-'}</td></tr>`).join('') ||
      '<tr><td colspan="3">No SKUs</td></tr>';
  }catch(e){
    toast('SKUs error: ' + e.message);
  }
}

async function salesView(){
  app.innerHTML = `
    <div class="app">
      ${nav('#/sales')}
      <div class="card">
        <h1>Create Sale</h1>
        <div class="row">
          <div class="col">
            <label>SKU</label>
            <select id="skuSel"></select>
          </div>
          <div class="col">
            <label>Quantity</label>
            <input id="qty" type="number" min="1" value="1"/>
          </div>
        </div>
        <br/>
        <button id="btnSale" class="success">Create</button>
        <span id="saleMsg" style="margin-left:10px;color:#a3ffd1"></span>
      </div>

      <div class="card">
        <h2>Sales History</h2>
        <table class="table" id="salesTbl">
          <thead><tr><th>ID</th><th>User</th><th>SKU</th><th>Qty</th><th>At</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  // load SKUs
  let skus=[];
  try{
    const data = await jfetch('/skus');
    skus = data.items || data || [];
  }catch{ skus=[]; }
  const sel = document.getElementById('skuSel');
  sel.innerHTML = skus.map(s=>`<option value="${s.sku}">${s.sku} — ${s.name||''}</option>`).join('') || '<option value="">No SKUs</option>';

  document.getElementById('btnSale').onclick = async ()=>{
    const sku = sel.value;
    const quantity = Number(document.getElementById('qty').value||0);
    if(!sku) return toast('Choose a SKU');
    if(quantity<=0) return toast('Quantity must be > 0');
    try{
      const res = await jfetch('/sales', {method:'POST', body: JSON.stringify({sku, quantity})});
      document.getElementById('saleMsg').textContent = 'Saved: #' + (res.id || res.saleId || 'ok');
      loadSales();
    }catch(e){ toast('Create sale failed: '+e.message); }
  };

  async function loadSales(){
    try{
      let data;
      try { data = await jfetch('/admin/sales'); }
      catch { data = await jfetch('/sales'); }
      const items = data.items || data || [];
      document.querySelector('#salesTbl tbody').innerHTML =
        items.map(s => `<tr>
          <td>${s.id || s.saleId || '-'}</td>
          <td>${s.userEmail || s.userId || '-'}</td>
          <td>${s.sku}</td>
          <td>${s.quantity}</td>
          <td>${new Date(s.createdAt||s.created_at||Date.now()).toLocaleString()}</td>
        </tr>`).join('') || '<tr><td colspan="5">No sales yet</td></tr>';
    }catch(e){ toast('Sales load error: ' + e.message); }
  }
  loadSales();
}

async function attendanceView(){
  app.innerHTML = `
    <div class="app">
      ${nav('#/attendance')}
      <div class="card">
        <h1>Attendance</h1>
        <div class="row">
          <div class="col">
            <button id="btnIn" class="primary">Mark IN</button>
          </div>
          <div class="col">
            <button id="btnOut" class="danger">Mark OUT</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>History</h2>
        <table class="table" id="attTbl">
          <thead><tr><th>ID</th><th>User</th><th>Action</th><th>At</th><th>Lat</th><th>Lng</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  const btnIn = document.getElementById('btnIn');
  const btnOut = document.getElementById('btnOut');

  btnIn.onclick = async ()=>{
    try{
      await jfetch('/attendance/mark',{method:'POST', body: JSON.stringify({action:'IN'})});
      toast('Marked IN'); load();
    }catch(e){ toast(e.message); }
  };
  btnOut.onclick = async ()=>{
    try{
      await jfetch('/attendance/mark',{method:'POST', body: JSON.stringify({action:'OUT'})});
      toast('Marked OUT'); load();
    }catch(e){ toast(e.message); }
  };

  async function load(){
    try{
      let data;
      try { data = await jfetch('/admin/attendance'); }
      catch { data = await jfetch('/attendance/history'); }
      const items = data.items || data || [];
      document.querySelector('#attTbl tbody').innerHTML =
        items.map(a=>`<tr>
          <td>${a.id||'-'}</td>
          <td>${a.userEmail || a.userId || '-'}</td>
          <td>${a.action}</td>
          <td>${new Date(a.createdAt||a.created_at||Date.now()).toLocaleString()}</td>
          <td>${a.lat ?? '-'}</td>
          <td>${a.lng ?? '-'}</td>
        </tr>`).join('') || '<tr><td colspan="6">No records</td></tr>';
    }catch(e){ toast('Load failed: '+e.message); }
  }
  load();
}

async function usersView(){
  if(!guardAdmin()) return;
  app.innerHTML = `
    <div class="app">
      ${nav('#/users')}
      <div class="card">
        <h1>Users</h1>
        <table class="table" id="usrTbl">
          <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Created</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  try{
    const data = await jfetch('/admin/users');
    const items = data.items || data || [];
    document.querySelector('#usrTbl tbody').innerHTML =
      items.map(u=>`<tr>
        <td>${u.id}</td>
        <td>${(u.firstName||'')+' '+(u.lastName||'')}</td>
        <td>${u.email}</td>
        <td>${u.role||'user'}</td>
        <td>${new Date(u.createdAt||u.created_at||Date.now()).toLocaleString()}</td>
      </tr>`).join('') || '<tr><td colspan="5">No users</td></tr>';
  }catch(e){ toast('Users error: '+e.message); }
}

async function profileView(){
  app.innerHTML = `
    <div class="app">
      ${nav('#/profile')}
      <div class="card">
        <h1>Profile</h1>
        <div id="prof"></div>
      </div>
    </div>
  `;
  try{
    const data = await jfetch('/profile');
    document.getElementById('prof').innerHTML =
      `<pre>${JSON.stringify(data,null,2)}</pre>`;
  }catch(e){ toast('Profile error: '+e.message); }
}

// ===== router =====
function render(){
  const hash = location.hash || '#/login';
  if(!store.token && hash !== '#/login'){ location.hash = '#/login'; return loginView(); }
  switch(hash){
    case '#/login': return loginView();
    case '#/dashboard': return dashboardView();
    case '#/skus': return skusView();
    case '#/sales': return salesView();
    case '#/attendance': return attendanceView();
    case '#/users': return usersView();
    case '#/profile': return profileView();
    default: location.hash = '#/dashboard'; return dashboardView();
  }
}
window.addEventListener('hashchange', render);
render();
