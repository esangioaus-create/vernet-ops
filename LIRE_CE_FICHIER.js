// ============================================================
// PATCH index.html — 3 modifications ciblées
// ============================================================

// ── PATCH 1 : Écran changement de MDP première connexion ────────────────────
// Ajouter juste APRÈS la div#login-screen et AVANT la div#app :

/*
<div id="first-login-screen" class="hidden">
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <div class="logo-mark">🔑</div>
        <div class="name">Bienvenue</div>
        <div class="sub">Définissez votre mot de passe</div>
      </div>
      <div style="font-size:13px;color:var(--text3);text-align:center;margin-bottom:20px;line-height:1.6">
        C'est votre première connexion.<br>Choisissez un mot de passe personnel.
      </div>
      <div class="login-field"><label>Nouveau mot de passe (min. 8 car.)</label><input type="password" id="fl-new" placeholder="••••••••"></div>
      <div class="login-field"><label>Confirmation</label><input type="password" id="fl-confirm" placeholder="••••••••"></div>
      <button class="login-btn" onclick="doFirstLogin()">Confirmer et accéder</button>
      <div class="login-error" id="fl-error"></div>
    </div>
  </div>
</div>
*/

// ── PATCH 2 : Dans startApp(), remplacer le début par ────────────────────────

/*
function startApp() {
  // Check if first login required
  if (currentUser.must_change_password) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('first-login-screen').classList.remove('hidden');
    return;
  }
  document.getElementById('first-login-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('sb-hotel').textContent = currentUser.hotel_name || 'B Signature';
  document.getElementById('sb-user').textContent = currentUser.display_name;
  document.getElementById('sb-badge').innerHTML = `<span class="sb-badge">${roleLabel(currentUser.role)}</span>`;
  if (currentUser.role === 'super_admin') document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  initSocket(); updateDate(); setInterval(updateDate, 30000); navigate('dashboard'); loadBadges(); setInterval(loadBadges, 15000);
}

async function doFirstLogin() {
  const nw = document.getElementById('fl-new').value;
  const conf = document.getElementById('fl-confirm').value;
  const err = document.getElementById('fl-error');
  err.textContent = '';
  if (nw.length < 8) { err.textContent = 'Minimum 8 caractères'; return; }
  if (nw !== conf) { err.textContent = 'Les mots de passe ne correspondent pas'; return; }
  try {
    await api('/api/auth/first-login', 'POST', { new_password: nw });
    currentUser.must_change_password = false;
    startApp();
  } catch(e) { err.textContent = e.message; }
}
*/

// ── PATCH 3 : Remplacer openCreateUserModal() par cette version ─────────────

/*
async function openCreateUserModal() {
  const hotels = await api('/api/admin/hotels');
  const hotelOpts = hotels.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  openModal('Nouveau compte utilisateur',
    `<div class="fields-row c2">
       <div class="field"><label>Prénom *</label><input id="m-ufn" placeholder="Jean"></div>
       <div class="field"><label>Nom *</label><input id="m-uln" placeholder="DUPONT"></div>
     </div>
     <div class="fields-row c2">
       <div class="field"><label>Identifiant de connexion *</label><input id="m-uu" placeholder="jean.dupont"></div>
       <div class="field"><label>Poste / Fonction</label><input id="m-upo" placeholder="Réceptionniste"></div>
     </div>
     <div class="field"><label>Mot de passe initial *</label><input type="password" id="m-upw" placeholder="Min. 8 caractères">
       <div style="font-size:11px;color:var(--text3);margin-top:4px">Le collaborateur devra le changer à sa première connexion si vous cochez l'option ci-dessous.</div>
     </div>
     <div class="fields-row c2">
       <div class="field"><label>Rôle *</label>
         <select id="m-ur" onchange="toggleHotelField()">
           <option value="equipe">Équipe</option>
           <option value="chef_service">Chef de service</option>
           <option value="hotel_admin">Admin Hôtel</option>
           <option value="super_admin">Super Admin</option>
         </select>
       </div>
       <div class="field"><label>Service</label>
         <select id="m-usv">
           <option value="">—</option>
           <option value="reception">Réception</option>
           <option value="housekeeping">Housekeeping</option>
           <option value="fb">F&B</option>
           <option value="maintenance">Maintenance</option>
           <option value="direction">Direction</option>
         </select>
       </div>
     </div>
     <div class="field" id="hotel-field"><label>Hôtel *</label><select id="m-uh">${hotelOpts}</select></div>
     <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border-radius:var(--r);border:1px solid var(--border)">
       <input type="checkbox" id="m-umcp" style="width:16px;height:16px;flex-shrink:0">
       <label for="m-umcp" style="font-size:12px;color:var(--text2);cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400">Forcer le changement de mot de passe à la première connexion</label>
     </div>`,
    [{label:'Annuler',cls:'btn-outline',action:closeModal},{label:'Créer le compte',cls:'btn-gold',action:async()=>{
      const fn = document.getElementById('m-ufn').value.trim();
      const ln = document.getElementById('m-uln').value.trim();
      const username = document.getElementById('m-uu').value.trim();
      const password = document.getElementById('m-upw').value;
      const poste = document.getElementById('m-upo').value.trim();
      const role = document.getElementById('m-ur').value;
      const service = document.getElementById('m-usv').value;
      const hotel_id = document.getElementById('m-uh')?.value;
      const must_change_password = document.getElementById('m-umcp').checked;
      const display_name = `${fn} ${ln}`.trim() || username;
      if (!fn || !ln || !username || !password) { toast('Prénom, nom, identifiant et mot de passe requis', 'error'); return; }
      try {
        await api('/api/admin/users', 'POST', { username, password, display_name, first_name: fn, last_name: ln, poste, role, service, hotel_id, must_change_password });
        closeModal();
        toast(`Compte ${display_name} créé ✓`, 'success');
        loadSettingsUsers();
      } catch(e) { toast(e.message, 'error'); }
    }}]
  );
}
*/

// ── PATCH 4 : Remplacer openEditUserModal() par cette version ───────────────

/*
async function openEditUserModal(u) {
  const hotels = await api('/api/admin/hotels');
  const hotelOpts = hotels.map(h => `<option value="${h.id}" ${h.id==u.hotel_id?'selected':''}>${esc(h.name)}</option>`).join('');
  openModal(`Modifier — ${esc(u.display_name)}`,
    `<div class="fields-row c2">
       <div class="field"><label>Prénom</label><input id="m-efn" value="${esc(u.first_name||'')}"></div>
       <div class="field"><label>Nom</label><input id="m-eln" value="${esc(u.last_name||'')}"></div>
     </div>
     <div class="fields-row c2">
       <div class="field"><label>Poste / Fonction</label><input id="m-epo" value="${esc(u.poste||'')}"></div>
       <div class="field"><label>Nouveau mot de passe</label><input type="password" id="m-epw" placeholder="Laisser vide = inchangé"></div>
     </div>
     <div class="fields-row c2">
       <div class="field"><label>Rôle</label>
         <select id="m-er">${['equipe','chef_service','hotel_admin','super_admin'].map(r=>`<option value="${r}" ${r===u.role?'selected':''}>${roleLabel(r)}</option>`).join('')}</select>
       </div>
       <div class="field"><label>Service</label>
         <select id="m-esv"><option value="">—</option>${['reception','housekeeping','fb','maintenance','direction'].map(s=>`<option value="${s}" ${s===u.service?'selected':''}>${serviceLbl(s)}</option>`).join('')}</select>
       </div>
     </div>
     <div class="field"><label>Hôtel</label><select id="m-eh">${hotelOpts}</select></div>
     <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border-radius:var(--r);border:1px solid var(--border);margin-top:4px">
       <input type="checkbox" id="m-emcp" ${u.must_change_password?'checked':''} style="width:16px;height:16px;flex-shrink:0">
       <label for="m-emcp" style="font-size:12px;color:var(--text2);cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400">Forcer le changement de mot de passe à la prochaine connexion</label>
     </div>`,
    [{label:'Annuler',cls:'btn-outline',action:closeModal},{label:'Enregistrer',cls:'btn-gold',action:async()=>{
      const fn = document.getElementById('m-efn').value.trim();
      const ln = document.getElementById('m-eln').value.trim();
      const body = {
        display_name: `${fn} ${ln}`.trim() || u.display_name,
        first_name: fn, last_name: ln,
        poste: document.getElementById('m-epo').value.trim(),
        role: document.getElementById('m-er').value,
        service: document.getElementById('m-esv').value,
        hotel_id: document.getElementById('m-eh').value,
        must_change_password: document.getElementById('m-emcp').checked
      };
      const pw = document.getElementById('m-epw').value;
      if (pw) body.password = pw;
      try {
        await api(`/api/admin/users/${u.id}`, 'PATCH', body);
        closeModal();
        toast('Modifié ✓', 'success');
        loadSettingsUsers();
      } catch(e) { toast(e.message, 'error'); }
    }}]
  );
}
*/

// ── PATCH 5 : Remplacer la carte user dans loadSettingsUsers() ───────────────
// Remplace la ligne .map(u => `<div class="user-card...`) par :
/*
html += members.map(u => `
  <div class="user-card ${u.active?'':'user-inactive'}">
    <div class="user-avatar">${esc((u.first_name||u.display_name)[0]||'?').toUpperCase()}</div>
    <div class="user-info">
      <div class="user-name">${esc(u.first_name||'')} ${esc(u.last_name||'')} ${!u.first_name?esc(u.display_name):''}</div>
      <div class="user-meta">
        <span class="badge badge-${u.role}">${roleLabel(u.role)}</span>
        ${u.poste?`<span class="pill">${esc(u.poste)}</span>`:''}
        ${u.service?`<span class="pill">${serviceLbl(u.service)}</span>`:''}
        <span style="font-size:10px;color:var(--text3)">@${esc(u.username)}</span>
        ${!u.active?'<span style="color:var(--red);font-size:11px">Inactif</span>':''}
        ${u.must_change_password?'<span style="color:var(--orange);font-size:11px">⚠ MDP à changer</span>':''}
        ${u.last_login?`<span>Dernière co : ${formatDate(u.last_login)}</span>`:''}
      </div>
    </div>
    <div class="list-item-actions">
      <button class="btn btn-outline btn-sm" onclick='openEditUserModal(${JSON.stringify(u)})'>Modifier</button>
      ${u.active
        ?`<button class="btn btn-danger btn-xs" onclick="disableUser(${u.id})">Désactiver</button>`
        :`<button class="btn btn-green btn-xs" onclick="enableUser(${u.id})">Réactiver</button>`
      }
    </div>
  </div>`).join('');
*/
