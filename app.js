const cfg = window.NAIJI_CONFIG || {};
const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const app = $("#app");
let session = null;
let state = {
  profile: null,
  families: [],
  family: null,
  members: [],
  babies: [],
  baby: null,
  feedings: [],
  growth: [],
  tab: "home",
  editing: null,
  loading: true
};

const typeText = {
  breast: "亲喂母乳",
  bottle_breast: "瓶喂母乳",
  formula: "瓶喂奶粉"
};

const typeMark = {
  breast: ["亲", "green"],
  bottle_breast: ["瓶", "blue"],
  formula: ["粉", "orange"]
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
}

function fmtDate(date) {
  return new Date(date).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromBirthday(birthday) {
  const start = new Date(`${birthday}T00:00:00`);
  const now = new Date();
  const days = Math.max(1, Math.floor((now - start) / 86400000) + 1);
  return `出生第 ${days} 天`;
}

function toast(text) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

function setNight(on) {
  document.body.classList.toggle("night", on);
  localStorage.setItem("naiji_night", on ? "1" : "0");
}

function phoneForOtp(raw) {
  const text = String(raw || "").trim();
  if (text.startsWith("+")) return text;
  return `+86${text.replace(/\D/g, "")}`;
}

async function loadAll() {
  state.loading = true;
  render();
  const { data: auth } = await supabase.auth.getSession();
  session = auth.session;
  if (!session) {
    state.loading = false;
    render();
    return;
  }

  const uid = session.user.id;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  state.profile = profile;
  const { data: memberships, error } = await supabase
    .from("family_members")
    .select("family_id, role, families(*)")
    .eq("user_id", uid);

  if (error) {
    state.loading = false;
    renderSetupError(error);
    return;
  }

  state.families = (memberships || []).map(x => x.families).filter(Boolean);
  const savedFamily = localStorage.getItem("naiji_family_id");
  state.family = state.families.find(f => f.id === savedFamily) || state.families[0] || null;

  if (!state.profile || !state.family) {
    state.loading = false;
    render();
    return;
  }

  localStorage.setItem("naiji_family_id", state.family.id);
  await loadFamilyData();
  state.loading = false;
  render();
}

async function loadFamilyData() {
  if (!state.family) return;
  const familyId = state.family.id;
  const [membersRes, babiesRes] = await Promise.all([
    supabase.from("family_members").select("*").eq("family_id", familyId).order("created_at", { ascending: true }),
    supabase.from("babies").select("*").eq("family_id", familyId).order("created_at", { ascending: true })
  ]);
  state.members = membersRes.data || [];
  state.babies = babiesRes.data || [];
  const savedBaby = localStorage.getItem("naiji_baby_id");
  state.baby = state.babies.find(b => b.id === savedBaby) || state.babies[0] || null;
  if (state.baby) localStorage.setItem("naiji_baby_id", state.baby.id);
  await loadRecords();
}

async function loadRecords() {
  if (!state.family || !state.baby) {
    state.feedings = [];
    state.growth = [];
    return;
  }
  const [feedRes, growthRes] = await Promise.all([
    supabase.from("feeding_records").select("*").eq("family_id", state.family.id).eq("baby_id", state.baby.id).order("fed_at", { ascending: false }).limit(300),
    supabase.from("growth_records").select("*").eq("family_id", state.family.id).eq("baby_id", state.baby.id).order("measured_on", { ascending: false }).limit(200)
  ]);
  state.feedings = feedRes.data || [];
  state.growth = growthRes.data || [];
}

function todayStats() {
  const key = today();
  const list = state.feedings.filter(r => dayKey(r.fed_at) === key);
  return {
    count: list.length,
    milk: list.reduce((sum, r) => sum + Number(r.amount_ml || 0), 0),
    breast: list.reduce((sum, r) => sum + Number(r.left_minutes || 0) + Number(r.right_minutes || 0), 0)
  };
}

function lastFeedingText() {
  const last = state.feedings[0];
  if (!last) return { elapsed: "暂无记录", detail: "保存第一条喂养记录后，这里会显示下次提醒建议。" };
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(last.fed_at).getTime()) / 60000));
  const elapsed = minutes < 60 ? `${minutes}分钟` : `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
  const detail = `${typeText[last.type]} · ${last.type === "breast" ? `左 ${last.left_minutes} 分钟 · 右 ${last.right_minutes} 分钟` : `${last.amount_ml}ml`}${last.note ? ` · ${last.note}` : ""}`;
  return { elapsed, detail };
}

function render() {
  if (state.loading) {
    app.innerHTML = `<main class="app"><section class="auth"><div class="logo">奶</div><h1 class="auth-title">奶迹</h1><p class="auth-copy">正在加载宝宝喂养记录...</p></section></main>`;
    return;
  }
  if (!session) return renderLogin();
  if (!state.profile || !state.family) return renderOnboarding();
  return renderShell();
}

function renderSetupError(error) {
  app.innerHTML = `<main class="app"><section class="auth"><div class="logo">!</div><h1 class="auth-title">数据库还没准备好</h1><p class="auth-copy">请在 Supabase SQL Editor 执行仓库里的 <b>supabase-schema.sql</b>。错误：${escapeHtml(error.message)}</p><button class="primary" data-action="reload">重新检查</button></section></main>`;
}

function renderLogin() {
  app.innerHTML = `
    <main class="app">
      <section class="auth">
        <div class="logo">奶</div>
        <div>
          <h1 class="auth-title">奶迹</h1>
          <p class="auth-copy">用手机号验证码登录，和家人一起记录宝宝喂奶与成长。</p>
        </div>
        <form class="card form" data-form="send-otp">
          <div class="field">
            <label>手机号</label>
            <input name="phone" inputmode="tel" autocomplete="tel" placeholder="例如：13800138000" required>
          </div>
          <button class="primary">获取验证码</button>
        </form>
        <form class="card form hidden" data-form="verify-otp">
          <div class="field">
            <label>验证码</label>
            <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="输入短信验证码" required>
          </div>
          <button class="primary">登录</button>
          <button class="secondary" type="button" data-action="resend">重新发送</button>
        </form>
      </section>
    </main>`;
}

function renderOnboarding() {
  app.innerHTML = `
    <main class="app">
      <section class="auth">
        <div class="logo">奶</div>
        <div>
          <h1 class="auth-title">设置奶迹</h1>
          <p class="auth-copy">首次使用需要创建本人名称、家庭和宝宝档案。之后数据会跟随账号同步。</p>
        </div>
        <form class="card form" data-form="onboard">
          <div class="field"><label>你的名称</label><input name="displayName" placeholder="例如：妈妈" required></div>
          <div class="field"><label>家庭名称</label><input name="familyName" placeholder="例如：安安的家" required></div>
          <div class="field"><label>宝宝姓名</label><input name="babyName" placeholder="例如：安安" required></div>
          <div class="field"><label>宝宝生日</label><input type="date" name="birthday" value="${today()}" required></div>
          <button class="primary">完成设置</button>
        </form>
        <form class="card form" data-form="join-family">
          <div class="field"><label>已有家庭邀请码</label><input name="inviteCode" placeholder="输入家人分享的邀请码"></div>
          <div class="field"><label>你的名称</label><input name="memberName" placeholder="例如：爸爸"></div>
          <button class="secondary">加入家庭</button>
        </form>
      </section>
    </main>`;
}

function renderShell() {
  const baby = state.baby;
  const stats = todayStats();
  app.innerHTML = `
    <main class="app">
      ${state.tab === "home" ? renderHome(baby, stats) : ""}
      ${state.tab === "trend" ? renderTrend(stats) : ""}
      ${state.tab === "mine" ? renderMine() : ""}
      <nav class="tabs">
        <button class="tab ${state.tab === "home" ? "active" : ""}" data-tab="home">首页</button>
        <button class="tab ${state.tab === "trend" ? "active" : ""}" data-tab="trend">趋势</button>
        <button class="tab ${state.tab === "mine" ? "active" : ""}" data-tab="mine">我的</button>
      </nav>
      <div class="modal-backdrop" data-action="close-modal"></div>
      <section class="modal" id="modal"></section>
      <div class="toast"></div>
    </main>`;
}

function renderHome(baby, stats) {
  const last = lastFeedingText();
  return `
    <section class="page">
      <header class="top"><div><h1 class="h1">奶迹</h1><p class="sub">宝宝喂奶记录助手</p></div><button class="icon-btn night-toggle" data-action="night" aria-label="夜间模式"></button></header>
      ${baby ? `<div class="card soft row"><div class="left"><span class="avatar">${escapeHtml(baby.name.slice(0,1))}</span><div><div class="title">${escapeHtml(baby.name)}</div><div class="muted">${daysFromBirthday(baby.birthday)}</div></div></div><button class="chip" data-action="switch-baby">切换宝宝</button></div>` : `<div class="card">还没有宝宝档案。</div>`}
      <section class="hero"><div class="muted">距离上次喂奶</div><div class="elapsed">${last.elapsed}</div><div>${escapeHtml(last.detail)}</div><div class="hero-grid"><div class="hero-tile"><div class="muted">今日次数</div><b>${stats.count}</b></div><div class="hero-tile"><div class="muted">今日奶量</div><b>${stats.milk}ml</b></div></div></section>
      <section class="section card">
        <div class="section-head"><div><div class="section-title">记录喂养</div><div class="muted">保存真实喂养记录</div></div><button class="chip" data-action="open-feeding">补记</button></div>
        <div class="quick-grid">
          <button data-action="open-feeding" data-type="breast"><span class="mark green">亲</span><strong>亲喂母乳</strong><div class="muted">左右乳计时</div></button>
          <button data-action="open-feeding" data-type="bottle_breast"><span class="mark blue">瓶</span><strong>瓶喂母乳</strong><div class="muted">记录奶量</div></button>
          <button data-action="open-feeding" data-type="formula"><span class="mark orange">粉</span><strong>瓶喂奶粉</strong><div class="muted">快捷保存</div></button>
        </div>
      </section>
      <section class="section"><div class="section-head"><div class="section-title">今日概览</div><button class="chip" data-action="export-csv">导出 CSV</button></div><div class="stats"><div class="card stat"><b>${stats.count}</b><span class="muted">喂奶次数</span></div><div class="card stat"><b>${stats.milk}ml</b><span class="muted">奶量</span></div><div class="card stat"><b>${stats.breast}分</b><span class="muted">亲喂</span></div></div></section>
      <section class="section"><div class="section-head"><div class="section-title">最近记录</div><button class="chip" data-action="open-history">全部</button></div><div class="list">${state.feedings.slice(0, 6).map(renderFeedingRecord).join("") || empty("还没有喂养记录")}</div></section>
    </section>`;
}

function renderTrend(stats) {
  return `
    <section class="page">
      <header class="top"><div><h1 class="h1">趋势</h1><p class="sub">基于真实记录生成</p></div><button class="icon-btn" data-action="export-csv">↓</button></header>
      <section class="card chart-card"><div class="section-head"><div><div class="section-title">每日奶量趋势</div><div class="muted">近 7 天</div></div></div>${renderMilkBars()}</section>
      <section class="section card chart-card"><div class="section-head"><div><div class="section-title">身高体重趋势</div><div class="muted">来自成长记录</div></div><button class="chip" data-action="open-growth">记录</button></div>${renderGrowthCurve()}</section>
      <section class="section card"><div class="section-title">奶迹小结</div><p class="muted">今日已记录 ${stats.count} 次喂奶，瓶喂奶量 ${stats.milk}ml，亲喂 ${stats.breast} 分钟。</p></section>
    </section>`;
}

function renderMine() {
  return `
    <section class="page">
      <header class="top"><div><h1 class="h1">我的</h1><p class="sub">档案、协作与偏好</p></div><button class="icon-btn night-toggle" data-action="night"></button></header>
      <section class="card row"><div><div class="title">${escapeHtml(state.family.name)}</div><div class="muted">邀请码：${state.family.invite_code}</div></div><button class="chip" data-action="copy-invite">复制</button></section>
      <section class="section"><div class="section-head"><div class="section-title">宝宝档案</div><button class="chip" data-action="open-baby">添加宝宝</button></div><div class="list">${state.babies.map(renderBaby).join("")}</div></section>
      <section class="section"><div class="section-head"><div class="section-title">家庭成员</div></div><div class="list">${state.members.map(m => `<div class="record"><span class="avatar">${escapeHtml(m.display_name.slice(0,1))}</span><div><div class="record-title">${escapeHtml(m.display_name)}</div><div class="record-detail">${m.role === "admin" ? "管理员" : "成员"}</div></div></div>`).join("")}</div></section>
      <section class="section stack"><button class="secondary" data-action="open-growth">记录身高体重</button><button class="danger" data-action="logout">退出登录</button></section>
    </section>`;
}

function empty(text) {
  return `<div class="card muted">${text}</div>`;
}

function renderFeedingRecord(r) {
  const [mark, color] = typeMark[r.type];
  const detail = r.type === "breast" ? `左 ${r.left_minutes} 分钟 · 右 ${r.right_minutes} 分钟` : `${r.amount_ml}ml`;
  return `<article class="record"><span class="mark ${color}">${mark}</span><div><div class="record-title">${typeText[r.type]}</div><div class="record-detail">${fmtDate(r.fed_at)} · ${detail}${r.note ? ` · ${escapeHtml(r.note)}` : ""}</div></div><button class="chip" data-action="edit-feeding" data-id="${r.id}">修改</button></article>`;
}

function renderBaby(b) {
  return `<article class="record"><span class="avatar">${escapeHtml(b.name.slice(0,1))}</span><div><div class="record-title">${escapeHtml(b.name)}</div><div class="record-detail">${daysFromBirthday(b.birthday)} · ${b.birthday}</div></div><button class="chip" data-action="select-baby" data-id="${b.id}">${state.baby?.id === b.id ? "当前" : "切换"}</button></article>`;
}

function renderMilkBars() {
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const values = days.map(d => {
    const key = dayKey(d);
    return state.feedings.filter(r => dayKey(r.fed_at) === key).reduce((sum, r) => sum + Number(r.amount_ml || 0), 0);
  });
  const max = Math.max(1, ...values);
  return `<div class="bars">${values.map((v, i) => `<div class="bar"><b>${v}</b><span style="height:${Math.max(8, Math.round(v / max * 132))}px"></span><small>${days[i].getMonth()+1}/${days[i].getDate()}</small></div>`).join("")}</div>`;
}

function renderGrowthCurve() {
  const list = [...state.growth].reverse().slice(-6);
  if (!list.length) return empty("还没有成长记录");
  const hMin = Math.min(...list.map(x => Number(x.height_cm))) - 2;
  const hMax = Math.max(...list.map(x => Number(x.height_cm))) + 2;
  const wMin = Math.min(...list.map(x => Number(x.weight_kg))) - .5;
  const wMax = Math.max(...list.map(x => Number(x.weight_kg))) + .5;
  const points = (key, min, max) => list.map((x, i) => {
    const px = 36 + i * (260 / Math.max(1, list.length - 1));
    const py = 158 - ((Number(x[key]) - min) / Math.max(.1, max - min)) * 112;
    return [px, py, Number(x[key])];
  });
  const hp = points("height_cm", hMin, hMax);
  const wp = points("weight_kg", wMin, wMax);
  return `<svg class="curve" viewBox="0 0 340 190" role="img" aria-label="身高体重趋势">
    <line class="grid" x1="34" y1="46" x2="320" y2="46"></line><line class="grid" x1="34" y1="102" x2="320" y2="102"></line><line class="grid" x1="34" y1="158" x2="320" y2="158"></line>
    <text x="34" y="24">身高 cm / 体重 kg</text>
    <polyline class="hline" points="${hp.map(p => `${p[0]},${p[1]}`).join(" ")}"></polyline>
    <polyline class="wline" points="${wp.map(p => `${p[0]},${p[1]}`).join(" ")}"></polyline>
    ${hp.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--primary)"></circle><text x="${p[0]-10}" y="${p[1]-10}">${p[2].toFixed(1)}</text>`).join("")}
    ${wp.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--accent)"></circle><text x="${p[0]-10}" y="${p[1]+20}">${p[2].toFixed(2)}</text>`).join("")}
  </svg>`;
}

function openModal(html) {
  const modal = $("#modal");
  modal.innerHTML = html;
  modal.classList.add("open");
  $(".modal-backdrop").classList.add("open");
}

function closeModal() {
  $("#modal")?.classList.remove("open");
  $(".modal-backdrop")?.classList.remove("open");
}

function feedingForm(record = null, defaultType = "breast") {
  const type = record?.type || defaultType;
  openModal(`<div class="modal-head"><div class="modal-title">${record ? "修改喂养记录" : "记录喂养"}</div><button class="icon-btn" data-action="close-modal">×</button></div>
    <form class="form" data-form="feeding" data-id="${record?.id || ""}">
      <input type="hidden" name="type" value="${type}">
      <div class="seg">${Object.entries(typeText).map(([k, v]) => `<button type="button" class="${type === k ? "active" : ""}" data-action="set-feed-type" data-type="${k}">${v}</button>`).join("")}</div>
      <div class="field"><label>喂养时间</label><input type="datetime-local" name="fed_at" value="${record ? new Date(record.fed_at).toISOString().slice(0,16) : new Date().toISOString().slice(0,16)}"></div>
      <div class="two breast-fields ${type !== "breast" ? "hidden" : ""}"><div class="field"><label>左乳 分钟</label><input name="left_minutes" type="number" min="0" value="${record?.left_minutes || 0}"></div><div class="field"><label>右乳 分钟</label><input name="right_minutes" type="number" min="0" value="${record?.right_minutes || 0}"></div></div>
      <div class="field amount-field ${type === "breast" ? "hidden" : ""}"><label>奶量 ml</label><input name="amount_ml" type="number" min="0" value="${record?.amount_ml || ""}"></div>
      <div class="field"><label>备注</label><textarea name="note" placeholder="例如：睡着、已拍嗝、吐奶">${escapeHtml(record?.note || "")}</textarea></div>
      <button class="primary">${record ? "保存修改" : "保存记录"}</button>
      ${record ? `<button type="button" class="danger" data-action="delete-feeding" data-id="${record.id}">删除记录</button>` : ""}
    </form>`);
}

function growthForm(record = null) {
  openModal(`<div class="modal-head"><div class="modal-title">${record ? "修改成长记录" : "记录身高体重"}</div><button class="icon-btn" data-action="close-modal">×</button></div>
    <form class="form" data-form="growth" data-id="${record?.id || ""}">
      <div class="field"><label>记录日期</label><input type="date" name="measured_on" value="${record?.measured_on || today()}"></div>
      <div class="two"><div class="field"><label>身高 cm</label><input name="height_cm" type="number" step="0.1" min="0" value="${record?.height_cm || ""}" required></div><div class="field"><label>体重 kg</label><input name="weight_kg" type="number" step="0.01" min="0" value="${record?.weight_kg || ""}" required></div></div>
      <div class="field"><label>备注</label><textarea name="note">${escapeHtml(record?.note || "")}</textarea></div>
      <button class="primary">${record ? "保存修改" : "保存成长记录"}</button>
    </form>`);
}

async function saveFeeding(form) {
  if (!state.family || !state.baby) return toast("请先创建宝宝档案");
  const id = form.dataset.id;
  const type = form.type.value;
  const payload = {
    family_id: state.family.id,
    baby_id: state.baby.id,
    recorder_id: session.user.id,
    type,
    fed_at: new Date(form.fed_at.value).toISOString(),
    left_minutes: type === "breast" ? Number(form.left_minutes.value || 0) : 0,
    right_minutes: type === "breast" ? Number(form.right_minutes.value || 0) : 0,
    amount_ml: type === "breast" ? 0 : Number(form.amount_ml.value || 0),
    note: form.note.value.trim()
  };
  const res = id
    ? await supabase.from("feeding_records").update(payload).eq("id", id)
    : await supabase.from("feeding_records").insert(payload);
  if (res.error) return toast(res.error.message);
  await loadRecords();
  closeModal();
  render();
  toast("喂养记录已保存");
}

async function saveGrowth(form) {
  if (!state.family || !state.baby) return toast("请先创建宝宝档案");
  const id = form.dataset.id;
  const payload = {
    family_id: state.family.id,
    baby_id: state.baby.id,
    recorder_id: session.user.id,
    measured_on: form.measured_on.value,
    height_cm: Number(form.height_cm.value),
    weight_kg: Number(form.weight_kg.value),
    note: form.note.value.trim()
  };
  const res = id
    ? await supabase.from("growth_records").update(payload).eq("id", id)
    : await supabase.from("growth_records").insert(payload);
  if (res.error) return toast(res.error.message);
  await loadRecords();
  closeModal();
  render();
  toast("成长记录已保存");
}

async function onboard(form) {
  const uid = session.user.id;
  const name = form.displayName.value.trim();
  const familyName = form.familyName.value.trim();
  const babyName = form.babyName.value.trim();
  const birthday = form.birthday.value;
  const profile = { id: uid, display_name: name, phone: session.user.phone || "" };
  let res = await supabase.from("profiles").upsert(profile);
  if (res.error) return toast(res.error.message);
  res = await supabase.from("families").insert({ name: familyName, owner_id: uid }).select().single();
  if (res.error) return toast(res.error.message);
  const family = res.data;
  res = await supabase.from("family_members").insert({ family_id: family.id, user_id: uid, display_name: name, role: "admin" });
  if (res.error) return toast(res.error.message);
  res = await supabase.from("babies").insert({ family_id: family.id, name: babyName, birthday, gender: "unknown" });
  if (res.error) return toast(res.error.message);
  await loadAll();
}

async function joinFamily(form) {
  const code = form.inviteCode.value.trim().toUpperCase();
  const name = form.memberName.value.trim();
  if (!code || !name) return toast("请输入邀请码和你的名称");
  let res = await supabase.from("families").select("*").eq("invite_code", code).single();
  if (res.error) return toast("邀请码无效");
  const family = res.data;
  await supabase.from("profiles").upsert({ id: session.user.id, display_name: name, phone: session.user.phone || "" });
  res = await supabase.from("family_members").insert({ family_id: family.id, user_id: session.user.id, display_name: name, role: "member" });
  if (res.error) return toast(res.error.message);
  await loadAll();
}

function exportCsv() {
  const rows = [["date", "type", "left_min", "right_min", "amount_ml", "note"]];
  state.feedings.forEach(r => rows.push([r.fed_at, typeText[r.type], r.left_minutes, r.right_minutes, r.amount_ml, r.note]));
  const csv = rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `naiji-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("submit", async e => {
  const form = e.target.closest("form");
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === "send-otp") {
    const phone = phoneForOtp(form.phone.value);
    localStorage.setItem("naiji_login_phone", phone);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return toast(error.message);
    $('[data-form="verify-otp"]').classList.remove("hidden");
    toast("验证码已发送");
  }
  if (form.dataset.form === "verify-otp") {
    const phone = localStorage.getItem("naiji_login_phone");
    const { error } = await supabase.auth.verifyOtp({ phone, token: form.code.value.trim(), type: "sms" });
    if (error) return toast(error.message);
    await loadAll();
  }
  if (form.dataset.form === "onboard") await onboard(form);
  if (form.dataset.form === "join-family") await joinFamily(form);
  if (form.dataset.form === "feeding") await saveFeeding(form);
  if (form.dataset.form === "growth") await saveGrowth(form);
});

document.addEventListener("click", async e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const a = btn.dataset.action;
  if (btn.dataset.tab) { state.tab = btn.dataset.tab; render(); return; }
  if (a === "reload") loadAll();
  if (a === "night") setNight(!document.body.classList.contains("night"));
  if (a === "close-modal") closeModal();
  if (a === "open-feeding") feedingForm(null, btn.dataset.type || "breast");
  if (a === "edit-feeding") feedingForm(state.feedings.find(r => r.id === btn.dataset.id));
  if (a === "delete-feeding" && confirm("删除这条喂养记录？")) {
    const { error } = await supabase.from("feeding_records").delete().eq("id", btn.dataset.id);
    if (error) return toast(error.message);
    await loadRecords(); closeModal(); render(); toast("已删除");
  }
  if (a === "open-growth") growthForm();
  if (a === "set-feed-type") {
    const form = btn.closest("form");
    form.type.value = btn.dataset.type;
    $$(".seg button", form).forEach(x => x.classList.toggle("active", x === btn));
    $(".breast-fields", form).classList.toggle("hidden", btn.dataset.type !== "breast");
    $(".amount-field", form).classList.toggle("hidden", btn.dataset.type === "breast");
  }
  if (a === "open-history") {
    openModal(`<div class="modal-head"><div class="modal-title">喂养历史</div><button class="icon-btn" data-action="close-modal">×</button></div><div class="list">${state.feedings.map(renderFeedingRecord).join("") || empty("暂无记录")}</div>`);
  }
  if (a === "switch-baby") {
    openModal(`<div class="modal-head"><div class="modal-title">切换宝宝</div><button class="icon-btn" data-action="close-modal">×</button></div><div class="list">${state.babies.map(renderBaby).join("")}</div><button class="primary" data-action="open-baby">添加宝宝</button>`);
  }
  if (a === "open-baby") {
    openModal(`<div class="modal-head"><div class="modal-title">添加宝宝</div><button class="icon-btn" data-action="close-modal">×</button></div><form class="form" data-form="baby"><div class="field"><label>宝宝姓名</label><input name="name" required></div><div class="field"><label>生日</label><input type="date" name="birthday" value="${today()}" required></div><button class="primary">保存宝宝</button></form>`);
  }
  if (a === "select-baby") {
    state.baby = state.babies.find(b => b.id === btn.dataset.id);
    localStorage.setItem("naiji_baby_id", state.baby.id);
    await loadRecords(); closeModal(); render();
  }
  if (a === "copy-invite") {
    await navigator.clipboard?.writeText(state.family.invite_code);
    toast("邀请码已复制");
  }
  if (a === "export-csv") exportCsv();
  if (a === "logout") { await supabase.auth.signOut(); session = null; state = { ...state, profile: null, family: null, baby: null, feedings: [], growth: [], tab: "home" }; render(); }
});

document.addEventListener("submit", async e => {
  const form = e.target.closest('[data-form="baby"]');
  if (!form) return;
  e.preventDefault();
  const { error } = await supabase.from("babies").insert({ family_id: state.family.id, name: form.name.value.trim(), birthday: form.birthday.value, gender: "unknown" });
  if (error) return toast(error.message);
  await loadFamilyData(); closeModal(); render(); toast("宝宝已添加");
});

supabase.auth.onAuthStateChange((_event, nextSession) => {
  session = nextSession;
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
setNight(localStorage.getItem("naiji_night") === "1");
loadAll();
