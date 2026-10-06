/* MeritScholars – app logic */
const CFG = window.EXCELLENCE_CONFIG || {};
const ICONS = {"MATHEMATICS":"📐","FURTHER MATHEMATICS":"∫","PHYSICS":"⚡","CHEMISTRY":"🧪","BIOLOGY":"🧬","AGRICULTURAL SCIENCE":"🌾","ECONOMICS":"📈","FINANCIAL ACCOUNTING":"💼","COMMERCE":"🏪","USE OF ENGLISH":"📖","LITERATURE-IN-ENGLISH":"📚","GOVERNMENT":"🏛️","CRK":"✝️","IRS":"☪️"};

let FREE_BANK = window.FREE_BANK || [];
const FREE_MAX_QUESTIONS = 15; // free users: max questions per test
let FULL_BANK = [], fullLoaded = false, fullLoading = false;
let BANK_INDEX = {};
const SUBJECT_BANKS = new Map();
const SUBJECT_LOADS = new Map();
let subject = "", examType = "ANY", numQ = 15, quizMode = "practice";
let selectedSubjects = [];
let bankExamFilter = "ALL";
let quiz = [], answers = {}, cur = 0, tLeft = 0, tInt = null, lastSubject = "", quizStartedAt = 0;
let sb = null, sessionUser = null, deferredPrompt = null;

const $ = (id) => document.getElementById(id);

function supabaseConfigured() {
  const url = (CFG.SUPABASE_URL || "").trim();
  const key = (CFG.SUPABASE_ANON_KEY || "").trim();
  return url && key && !url.includes("YOUR_") && !key.includes("YOUR_");
}

function initSupabase() {
  if (!supabaseConfigured()) {
    sb = null;
    console.info("Supabase not configured — using local accounts only.");
    return;
  }
  if (!window.supabase) {
    console.warn("Supabase JS SDK not loaded");
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_ANON_KEY.trim(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  sb.auth.getSession().then(({ data }) => {
    sessionUser = data.session?.user || null;
    if (sessionUser) {
      const meta = sessionUser.user_metadata || {};
      if (meta.display_name) localStorage.setItem("merit_display_name", meta.display_name);
      localStorage.setItem("merit_email", sessionUser.email || "");
    }
    updateAuthUI();
    if (sessionUser) {
      pullRemoteAttempts();
      pullRemoteLeaderboard();
    }
  });
  sb.auth.onAuthStateChange(async (event, session) => {
    sessionUser = session?.user || null;
    if (sessionUser) {
      const meta = sessionUser.user_metadata || {};
      if (meta.display_name) localStorage.setItem("merit_display_name", meta.display_name);
      localStorage.setItem("merit_email", sessionUser.email || "");
    }
    updateAuthUI();
    if (sessionUser) {
      pullRemoteAttempts();
      pullRemoteLeaderboard();
    }
    if (event === "SIGNED_IN") {
      closeAuthModal();
    }
  });
}

let authMode = "login"; // login | signup

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  return "h" + Math.abs(h) + "_" + str.length;
}

function getLocalUsers() {
  try { return JSON.parse(localStorage.getItem("merit_users") || "{}"); } catch { return {}; }
}
function saveLocalUsers(u) {
  localStorage.setItem("merit_users", JSON.stringify(u));
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("on", t.dataset.auth === mode));
  const extra = $("signupExtra");
  if (extra) extra.style.display = isSignup ? "block" : "none";
  const primary = $("btnAuthPrimary");
  if (primary) primary.textContent = isSignup ? "Create Account" : "Log In";
  // modal
  if ($("authModalTitle")) $("authModalTitle").textContent = isSignup ? "Create Account" : "Log In";
  if ($("authModalSub")) $("authModalSub").textContent = isSignup ? "Join MeritScholars CBT" : "Welcome back to MeritScholars";
  if ($("modalSignupExtra")) $("modalSignupExtra").hidden = !isSignup;
  if ($("btnModalAuth")) $("btnModalAuth").textContent = isSignup ? "Create Account" : "Log In";
  if ($("authSwitchMode")) $("authSwitchMode").textContent = isSignup ? "Already have an account? Log in" : "Need an account? Create one";
}

function openAuthModal(mode) {
  setAuthMode(mode || "login");
  const m = $("authModal");
  if (m) m.hidden = false;
  if ($("modalAuthMsg")) $("modalAuthMsg").textContent = "";
}
function closeAuthModal() {
  const m = $("authModal");
  if (m) m.hidden = true;
}

function updateAuthUI() {
  const logged = !!sessionUser;
  if ($("authBox")) $("authBox").hidden = logged;
  if ($("userBox")) $("userBox").hidden = !logged;
  const name = localStorage.getItem("merit_display_name") || (sessionUser && sessionUser.email && sessionUser.email.split("@")[0]) || "Student";
  if (sessionUser) {
    if ($("userEmail")) $("userEmail").textContent = sessionUser.email || "";
    if ($("userName")) $("userName").textContent = name;
    if ($("userAvatar")) $("userAvatar").textContent = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }
  // header buttons — keep .btn-header-* + short/full spans so mobile labels stay compact
  const hl = $("btnHeaderLogin"), hs = $("btnHeaderSignup");
  if (hl && hs) {
    if (logged) {
      const first = (name.split(" ")[0] || "Account").slice(0, 12);
      hl.textContent = first;
      hl.className = "btn-outline btn-header-login topbar-user";
      hl.onclick = () => go("account");
      hs.textContent = "Sign out";
      hs.className = "btn-outline btn-header-signup";
      hs.onclick = () => signOut();
    } else {
      hl.textContent = "Log In";
      hl.className = "btn-outline btn-header-login";
      hl.onclick = () => openAuthModal("login");
      // Restore dual labels so CSS can show short "Sign up" on mobile
      hs.innerHTML = '<span class="signup-full">Create Account</span><span class="signup-short">Sign up</span>';
      hs.className = "btn-dark btn-header-signup";
      hs.onclick = () => openAuthModal("signup");
    }
  }
  if ($("authMsg") && !logged) {
    $("authMsg").innerHTML = sb
      ? "Cloud accounts enabled. After signup, <strong>verify your email</strong> before logging in."
      : "Local accounts only. Set <code>SUPABASE_URL</code> & <code>SUPABASE_ANON_KEY</code> in config.js for email verification.";
  }
  // account stats
  const all = typeof getAttempts === "function" ? getAttempts() : [];
  if ($("accAttempts")) {
    $("accAttempts").textContent = all.length;
    if (all.length) {
      $("accAvg").textContent = Math.round(all.reduce((s, a) => s + a.score_pct, 0) / all.length) + "%";
      $("accBest").textContent = Math.max(...all.map(a => a.score_pct)) + "%";
    } else {
      $("accAvg").textContent = "0%";
      $("accBest").textContent = "0%";
    }
  }
  if (typeof renderLeaderboards === "function") renderLeaderboards();
}

async function doAuth(email, password, name, mode) {
  email = (email || "").trim().toLowerCase();
  password = password || "";
  name = (name || "").trim() || (email ? email.split("@")[0] : "Student");
  if (!email || !email.includes("@")) return "Enter a valid email.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  if (mode === "signup" && name.length < 2) return "Enter your full name.";

  // ---- Cloud auth (Supabase + email verification) ----
  if (sb) {
    if (mode === "signup") {
      const redirectTo = window.location.origin + window.location.pathname;
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: redirectTo
        }
      });
      if (error) return error.message;
      localStorage.setItem("merit_display_name", name);
      localStorage.setItem("merit_email", email);
      // If email confirmation is required, session is null
      if (!data.session) {
        return "Account created. Check your email and click the verification link, then log in.";
      }
      sessionUser = data.session.user;
      updateAuthUI();
      closeAuthModal();
      go("account");
      return "Account created and verified. You are signed in.";
    }
    // login
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("confirm") || msg.includes("verified") || msg.includes("email not confirmed")) {
        return "Email not verified yet. Check your inbox for the confirmation link.";
      }
      return error.message || "Login failed.";
    }
    sessionUser = data.session?.user || null;
    const meta = sessionUser?.user_metadata || {};
    localStorage.setItem("merit_display_name", meta.display_name || name);
    localStorage.setItem("merit_email", email);
    updateAuthUI();
    closeAuthModal();
    go("home");
    return "Signed in successfully.";
  }

  // ---- Local fallback (only when Supabase keys not set) ----
  const users = getLocalUsers();
  if (mode === "signup") {
    if (users[email]) return "An account with this email already exists. Log in instead.";
    users[email] = { hash: simpleHash(password), name, created: new Date().toISOString() };
    saveLocalUsers(users);
    localStorage.setItem("merit_display_name", name);
    localStorage.setItem("merit_email", email);
    localStorage.setItem("merit_local_user", JSON.stringify({ email, name }));
    sessionUser = { email };
    updateAuthUI();
    closeAuthModal();
    go("account");
    return "Account created (local device only). Add Supabase for email verification & cloud sync.";
  }
  let rec = users[email];
  if (!rec) {
    const legacy = JSON.parse(localStorage.getItem("merit_local_user") || "null");
    if (legacy && legacy.email === email) {
      users[email] = { hash: simpleHash(password), name: legacy.name || name, created: new Date().toISOString() };
      saveLocalUsers(users);
      rec = users[email];
    } else return "No account found. Create an account first.";
  }
  if (!rec || rec.hash !== simpleHash(password)) return "Incorrect email or password.";
  localStorage.setItem("merit_display_name", rec.name || name);
  localStorage.setItem("merit_email", email);
  localStorage.setItem("merit_local_user", JSON.stringify({ email, name: rec.name || name }));
  sessionUser = { email };
  updateAuthUI();
  closeAuthModal();
  go("home");
  return "Signed in (local mode).";
}

async function resendVerificationEmail() {
  if (!sb) return "Supabase not configured.";
  const email = ($("modalEmail")?.value || $("authEmail")?.value || localStorage.getItem("merit_email") || "").trim();
  if (!email) return "Enter your email first.";
  const { error } = await sb.auth.resend({ type: "signup", email });
  if (error) return error.message;
  return "Verification email resent. Check your inbox.";
}

async function signUp() {
  const msg = await doAuth(
    $("authEmail")?.value,
    $("authPass")?.value,
    $("authName")?.value,
    "signup"
  );
  if ($("authMsg")) $("authMsg").textContent = msg;
}
async function signIn() {
  const msg = await doAuth(
    $("authEmail")?.value,
    $("authPass")?.value,
    $("authName")?.value,
    "login"
  );
  if ($("authMsg")) $("authMsg").textContent = msg;
}
async function signOut() {
  if (sb) await sb.auth.signOut();
  sessionUser = null;
  localStorage.removeItem("merit_local_user");
  updateAuthUI();
  go("home");
}

async function submitAuthForm(fromModal) {
  const mode = authMode;
  const email = fromModal ? $("modalEmail")?.value : $("authEmail")?.value;
  const pass = fromModal ? $("modalPass")?.value : $("authPass")?.value;
  const name = fromModal ? $("modalName")?.value : $("authName")?.value;
  const msg = await doAuth(email, pass, name, mode);
  if (fromModal && $("modalAuthMsg")) $("modalAuthMsg").textContent = msg;
  if (!fromModal && $("authMsg")) $("authMsg").textContent = msg;
}

function saveAttemptLocal(att) {
  const all = getAttempts();
  all.unshift(att);
  localStorage.setItem("merit_attempts", JSON.stringify(all.slice(0, 200)));
}
async function pushAttemptRemote(att) {
  if (!sb || !sessionUser) return;
  await sb.from("attempts").insert({
    user_id: sessionUser.id, subject: att.subject, exam_type: att.exam_type, mode: att.mode,
    total: att.total, correct: att.correct, score_pct: att.score_pct,
    duration_sec: att.duration_sec, topic_breakdown: att.topic_breakdown
  });
}
async function pullRemoteAttempts() {
  if (!sb || !sessionUser) return;
  const { data } = await sb.from("attempts").select("*").order("created_at", { ascending: false }).limit(100);
  if (data?.length) {
    localStorage.setItem("merit_attempts", JSON.stringify(data.map(r => ({
      id: r.id, subject: r.subject, exam_type: r.exam_type, mode: r.mode,
      total: r.total, correct: r.correct, score_pct: r.score_pct,
      duration_sec: r.duration_sec, topic_breakdown: r.topic_breakdown || {},
      created_at: r.created_at
    }))));
    renderAnalytics();
  }
}

function getPremiumUntil() {
  const exp = localStorage.getItem("premium_until");
  if (!exp) return null;
  const d = new Date(exp);
  return isNaN(d.getTime()) ? null : d;
}
function isPremium() {
  const d = getPremiumUntil();
  return !!(d && d > new Date());
}
/** Had premium before but date has passed */
function isPremiumExpired() {
  const d = getPremiumUntil();
  return !!(d && d <= new Date());
}
function daysLeftPremium() {
  const d = getPremiumUntil();
  if (!d) return 0;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function setPremium(days, paymentRef) {
  const add = days || CFG.PREMIUM_DAYS || 90;
  // Renewing: extend from current end date if still active; otherwise from today
  let base = new Date();
  const cur = getPremiumUntil();
  if (cur && cur > base) base = cur;
  const d = new Date(base);
  d.setDate(d.getDate() + add);
  localStorage.setItem("premium_until", d.toISOString());
  sessionStorage.removeItem("merit_expired_prompted");
  sessionStorage.removeItem("merit_renew_dismissed");
  if (paymentRef) {
    const hist = JSON.parse(localStorage.getItem("merit_payments") || "[]");
    hist.unshift({ ref: paymentRef, at: new Date().toISOString(), days: days || CFG.PREMIUM_DAYS || 90 });
    localStorage.setItem("merit_payments", JSON.stringify(hist.slice(0, 20)));
  }
  refreshPlanUI();
  schedulePremiumExpiryNotif(d);
}
function freeQuestionLimit() {
  return FREE_MAX_QUESTIONS; // 15
}
function premiumQuestionLimit() {
  return 50;
}
function getBankStats(bank) {
  const list = bank || activeBank() || [];
  const by = {};
  list.forEach(q => { by[q.subject] = (by[q.subject] || 0) + 1; });
  const subjects = Object.keys(by).length;
  const per = subjects ? Math.round(list.length / subjects) : 0;
  return { total: list.length, subjects, perSubject: per, by };
}
function activeBank() {
  return isPremium() ? (FULL_BANK || []) : FREE_BANK;
}

async function loadBankIndex() {
  if (Object.keys(BANK_INDEX).length) return BANK_INDEX;
  for (const path of ["bank/index.json", "./bank/index.json"]) {
    try {
      const res = await fetch(path, { cache: "force-cache" });
      if (res.ok) { BANK_INDEX = await res.json(); return BANK_INDEX; }
    } catch (_) {}
  }
  throw new Error("Could not load question bank index");
}

function addYearsFromQuestions(arr) {
  const sel = $("filterYear");
  if (!sel) return;
  [...new Set((arr || []).map(q => q.year).filter(Boolean))].sort((a,b) => b-a).forEach(y => {
    if (![...sel.options].some(o => String(o.value) === String(y))) {
      const o = document.createElement("option"); o.value = y; o.textContent = y; sel.appendChild(o);
    }
  });
}

function rebuildLoadedBank() { FULL_BANK = [...SUBJECT_BANKS.values()].flat(); fullLoaded = FULL_BANK.length > 0; }

function dedupeLoadedQuestions(arr) {
  const seen = new Set();
  return (arr || []).filter(q => {
    const key = q.question_id || [q.subject,q.exam_type,q.year,q.question_text,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option].map(v => String(v || "").trim().toLowerCase()).join("\u001f");
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}

async function loadSubjectBank(subjectName, opts = {}) {
  if (!isPremium()) return FREE_BANK.filter(q => q.subject === subjectName);
  if (SUBJECT_BANKS.has(subjectName) && !opts.force && !opts.all && (SUBJECT_BANKS.get(subjectName)||[]).length >= Number(opts.minQuestions||0)) return SUBJECT_BANKS.get(subjectName);
  if (SUBJECT_LOADS.has(subjectName)) return SUBJECT_LOADS.get(subjectName);
  await loadBankIndex();
  const entry = BANK_INDEX[subjectName];
  if (!entry || !Array.isArray(entry.chunks)) throw new Error("No question bank found for " + subjectName);
  const limit = Number(opts.minQuestions || 0);
  const all = opts.all === true;
  const promise = (async () => {
    const bar = $("loadBar");
    if (bar) { bar.classList.add("show"); bar.textContent = "Loading " + subjectName + " questions…"; }
    const parts = [];
    const existing = SUBJECT_BANKS.get(subjectName) || [];
    if (existing.length) parts.push(existing);
    const loadedPaths = new Set(opts.skipLoaded === false ? [] : (entry._loadedChunks || []));
    for (const path of entry.chunks) {
      if (!all && limit > 0 && dedupeLoadedQuestions(parts.flat()).length >= limit) break;
      if (loadedPaths.has(path)) continue;
      let arr = null;
      for (const u of [path,"./"+path,"/"+path]) {
        try { const r=await fetch(u,{cache:"force-cache"}); if(r.ok){const x=await r.json(); if(Array.isArray(x)){arr=x;break;}} } catch(_) {}
      }
      if (arr) { parts.push(arr); loadedPaths.add(path); }
    }
    const clean = dedupeLoadedQuestions(parts.flat());
    if (!clean.length) throw new Error("No questions loaded for " + subjectName);
    entry._loadedChunks = [...loadedPaths];
    SUBJECT_BANKS.set(subjectName, clean); SUBJECT_LOADS.delete(subjectName); rebuildLoadedBank(); addYearsFromQuestions(clean);
    if (bar) { bar.textContent = subjectName + ": " + clean.length.toLocaleString() + " questions loaded."; setTimeout(()=>bar.classList.remove("show"),1200); }
    return clean;
  })().catch(e => { SUBJECT_LOADS.delete(subjectName); throw e; });
  SUBJECT_LOADS.set(subjectName, promise);
  return promise;
}

async function ensureSubjectsLoaded(subjects) {
  await loadBankIndex();
  return Promise.all([...new Set(subjects || [])].map(s => loadSubjectBank(s, { all: true })));
}

async function loadFullBank() {
  if (!isPremium()) return FREE_BANK;
  const names = selectedSubjects.length ? selectedSubjects : (subject ? [subject] : []);
  if (names.length) await ensureSubjectsLoaded(names);
  return FULL_BANK;
}

function refreshPlanUI() {
  const prem = isPremium();
  const expired = isPremiumExpired();
  const left = daysLeftPremium();
  if ($("planBadge")) {
    if (prem) {
      $("planBadge").textContent = left <= 7 ? "Premium · " + left + "d left" : "Premium";
      $("planBadge").className = "badge prem";
    } else if (expired) {
      $("planBadge").textContent = "Expired";
      $("planBadge").className = "badge";
    } else {
      $("planBadge").textContent = "Free";
      $("planBadge").className = "badge";
    }
  }
  const n = prem && Object.keys(BANK_INDEX).length ? Object.values(BANK_INDEX).reduce((sum,e)=>sum+Number(e.count||0),0) : activeBank().length;
  if ($("homeSub")) {
    if (prem) {
      $("homeSub").textContent = "Premium · " + n.toLocaleString() + " questions unlocked";
    } else {
      $("homeSub").textContent = "Free · max " + FREE_MAX_QUESTIONS + " questions per test · Unlock full bank with Premium";
    }
  }
  if ($("premStatus")) {
    if (prem) {
      const until = getPremiumUntil();
      $("premStatus").innerHTML = '<p style="color:var(--ok);font-weight:600">✅ Premium preview unlocked</p><p class="muted" style="margin-top:6px">Full question bank available. No payment or subscription is required.</p>';
    } else {
      $("premStatus").innerHTML = '<p class="muted">Free plan: up to 15 questions per test. Unlock Premium Preview for the full bank at no cost.</p>';
    }
  }
  // Pay button label
  if ($("btnPay")) $("btnPay").textContent = prem ? "Premium Unlocked ✓" : "Unlock Premium — FREE";
  if ($("paywallTitle")) $("paywallTitle").textContent = prem ? "⭐ Premium Preview Unlocked" : "⭐ Unlock Premium — Free Preview";
  const hint = $("payHint");
  if (hint) hint.textContent = "Preview mode: no payment, Paystack key, Groq key, or subscription is required.";
  showRenewBanner();
  if (typeof buildNumChips === "function") buildNumChips();
  if (typeof renderHomeGrid === "function") renderHomeGrid();
}

function showRenewBanner() {
  const ban = $("renewBanner");
  if (ban) ban.classList.remove("show");
}

function checkPremiumExpiryOnBoot() {
  refreshPlanUI();
}

function schedulePremiumExpiryNotif() {
  // Disabled in the free preview build.
}


function getLeaderboard() {
  try { return JSON.parse(localStorage.getItem("merit_leaderboard") || "[]"); } catch { return []; }
}
function saveLeaderboard(list) {
  localStorage.setItem("merit_leaderboard", JSON.stringify(list.slice(0, 100)));
}
function updateLeaderboardFromAttempt(att) {
  const name = localStorage.getItem("merit_display_name") || (sessionUser && sessionUser.email) || "Student";
  const email = (sessionUser && sessionUser.email) || localStorage.getItem("merit_email") || "local";
  let list = getLeaderboard();
  const idx = list.findIndex(x => x.email === email);
  const entry = {
    email,
    name: String(name).split("@")[0],
    best: att.score_pct,
    attempts: 1,
    last: att.created_at
  };
  if (idx >= 0) {
    entry.best = Math.max(list[idx].best || 0, att.score_pct);
    entry.attempts = (list[idx].attempts || 0) + 1;
    entry.name = list[idx].name || entry.name;
    list[idx] = entry;
  } else list.push(entry);
  list.sort((a, b) => b.best - a.best || b.attempts - a.attempts);
  saveLeaderboard(list);
  renderLeaderboards();
}
function renderLeaderboards() {
  let list = getLeaderboard();
  list = (list || []).filter(e => e && (e.best > 0 || e.attempts > 0));
  list.sort((a, b) => (b.best || 0) - (a.best || 0) || (b.attempts || 0) - (a.attempts || 0));
  list = list.slice(0, 100);

  const render = (containerId, limit) => {
    const box = $(containerId);
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="muted lb-empty">No rankings yet. Complete a CBT test while logged in to appear here.</p>';
      return;
    }
    box.innerHTML = list.slice(0, limit).map((e, i) => {
      const rankCls = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "rn";
      const initials = (e.name || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
      return `<div class="lb-row">
        <div class="lb-rank ${rankCls}">${i + 1}</div>
        <div class="lb-avatar">${initials}</div>
        <div class="lb-meta"><div class="name">${e.name || "Student"}</div><div class="sub">${e.attempts || 0} CBT attempt${(e.attempts||0)===1?"":"s"}</div></div>
        <div class="lb-score"><div class="lab">Best score</div><div class="val">${e.best}%</div></div>
      </div>`;
    }).join("");
  };
  render("homeLeaderboard", 8);
  render("fullLeaderboard", 100);
  const all = getAttempts();
  if ($("miniAttempts")) {
    $("miniAttempts").textContent = all.length;
    if (all.length) {
      $("miniAvg").textContent = Math.round(all.reduce((s, a) => s + a.score_pct, 0) / all.length) + "%";
      $("miniBest").textContent = Math.max(...all.map(a => a.score_pct)) + "%";
      if ($("homeProgressText")) $("homeProgressText").textContent = sessionUser ? "Synced to your account." : "Local progress (log in to sync).";
    } else {
      $("miniAvg").textContent = "0%";
      $("miniBest").textContent = "0%";
    }
  }
}



function bankPool() {
  const bank = activeBank();
  if (bankExamFilter === "JAMB") return bank.filter(q => (q.exam_type || "").toUpperCase() === "JAMB");
  if (bankExamFilter === "WAEC") return bank.filter(q => (q.exam_type || "").toUpperCase() === "WAEC");
  return bank;
}

function renderBank() {
  const pool = bankPool();
  const bySub = {};
  if (isPremium() && Object.keys(BANK_INDEX).length) {
    Object.entries(BANK_INDEX).forEach(([s,e]) => { bySub[s] = Number(e.count || 0); });
  } else {
    pool.forEach(q => { bySub[q.subject] = (bySub[q.subject] || 0) + 1; });
  }
  const subjects = Object.keys(bySub).sort();
  if ($("bankTotal")) $("bankTotal").textContent = pool.length.toLocaleString();
  if ($("bankSubjects")) $("bankSubjects").textContent = subjects.length;
  const attempts = getAttempts();
  if ($("bankAttempts")) $("bankAttempts").textContent = attempts.length;
  if ($("bankPlanNote")) {
    if (isPremium()) {
      const total = Object.values(BANK_INDEX).reduce((sum,e)=>sum+Number(e.count||0),0);
      $("bankPlanNote").textContent = total.toLocaleString() + " questions unlocked · " + Object.keys(BANK_INDEX).length + " subjects · Premium Preview";
    } else {
      $("bankPlanNote").textContent = "Free plan: max " + FREE_MAX_QUESTIONS + " questions per test. Premium Preview unlocks the full bank for free.";
    }
  }
  if ($("bankListTitle")) {
    $("bankListTitle").textContent =
      bankExamFilter === "JAMB" ? "JAMB subjects" :
      bankExamFilter === "WAEC" ? "WAEC subjects" : "All CBT subjects";
  }
  const list = $("bankSubjectList");
  if (list) {
    if (!subjects.length) {
      list.innerHTML = '<p class="muted">No questions available for this filter yet.</p>';
    } else {
      const icons = typeof ICONS !== "undefined" ? ICONS : {};
      list.innerHTML = subjects.map(s => {
        const n = bySub[s];
        const subAttempts = attempts.filter(a => (a.subject || "").includes(s) || a.subject === s);
        const avg = subAttempts.length
          ? Math.round(subAttempts.reduce((x, a) => x + a.score_pct, 0) / subAttempts.length)
          : null;
        const meta = avg != null
          ? `${n.toLocaleString()} questions · Your avg ${avg}% (${subAttempts.length} tries)`
          : `${n.toLocaleString()} questions · Not practised yet`;
        return `<button type="button" class="bank-row" data-subject="${s.replace(/"/g, "&quot;")}">
          <span class="ico">${icons[s] || "📝"}</span>
          <span class="info"><span class="nm">${s}</span><span class="meta">${meta}</span></span>
          <span class="count">${n}</span>
          <span class="go">Practice →</span>
        </button>`;
      }).join("");
      list.querySelectorAll(".bank-row").forEach(btn => {
        btn.onclick = () => startFromBank(btn.getAttribute("data-subject"));
      });
    }
  }
  // progress breakdown for this bank's subjects
  const bp = $("bankProgress");
  if (bp) {
    const relevant = attempts.filter(a => {
      if (!a.subject) return false;
      if (bankExamFilter === "ALL") return true;
      return (a.exam_type || "").toUpperCase() === bankExamFilter || true;
    });
    if (!relevant.length) {
      bp.innerHTML = '<p class="muted">Complete CBT tests to see progress by subject here.</p>';
    } else {
      const agg = {};
      relevant.forEach(a => {
        const key = (a.subject || "General").split(",")[0].trim();
        if (!agg[key]) agg[key] = { sum: 0, n: 0 };
        agg[key].sum += a.score_pct;
        agg[key].n += 1;
      });
      const rows = Object.entries(agg)
        .map(([k, v]) => ({ k, avg: Math.round(v.sum / v.n), n: v.n }))
        .sort((a, b) => a.avg - b.avg);
      bp.innerHTML = rows.slice(0, 12).map(r =>
        `<div class="bank-prog-row"><span class="nm">${r.k}</span>
          <div class="bar-mini"><i style="width:${r.avg}%"></i></div>
          <span>${r.avg}% · ${r.n}x</span></div>`
      ).join("");
    }
  }
}

function startFromBank(subj) {
  selectedSubjects = [subj];
  subject = subj;
  lastSubject = subj;
  // align exam type chip
  if (bankExamFilter === "JAMB" || bankExamFilter === "WAEC") {
    examType = bankExamFilter;
  }
  go("test");
  renderHomeGrid();
  // auto-select subject visually after grid render
  setTimeout(() => {
    selectedSubjects = [subj];
    renderHomeGrid();
  }, 50);
}


function applyTheme() {
  const dark = localStorage.getItem("merit_theme") === "dark";
  document.documentElement.classList.toggle("dark", dark);
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  btn.setAttribute("aria-pressed", dark ? "true" : "false");
  btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
  const moon = btn.querySelector(".theme-ico-moon");
  const sun = btn.querySelector(".theme-ico-sun");
  if (moon && sun) {
    moon.hidden = dark;
    sun.hidden = !dark;
  } else {
    // fallback if markup missing
    btn.textContent = dark ? "☀️" : "🌙";
    btn.style.fontSize = "16px";
  }
}
function toggleDarkMode() {
  const next = localStorage.getItem("merit_theme") === "dark" ? "light" : "dark";
  localStorage.setItem("merit_theme", next);
  applyTheme();
}

function openWhatsApp() {
  const num = (CFG.SUPPORT_WHATSAPP || "2349031512760").replace(/\D/g, "");
  window.open("https://wa.me/" + num, "_blank");
}


// ========== Core navigation & CBT engine (restored) ==========

/** Per-screen SEO: update document title + meta description when navigating */
function updatePageMeta(id) {
  const site = "MeritScholars CBT";
  const map = {
    home: {
      title: "MeritScholars CBT — Free JAMB & WAEC Practice Tests for Nigerian Students",
      desc: "Practice JAMB UTME and WAEC CBT online for free. Timed mock exams, full question bank, progress analytics, leaderboard, and AI tutor built for Nigerian secondary school students."
    },
    test: {
      title: "Custom CBT Simulator — JAMB & WAEC Mock Exams | MeritScholars",
      desc: "Build a timed JAMB or WAEC CBT mock exam. Choose subjects, number of questions, and start practising like the real UTME or WASSCE."
    },
    setup: {
      title: "Exam Setup — Choose Subjects | MeritScholars CBT",
      desc: "Select subjects and configure your JAMB or WAEC practice test before entering the CBT exam hall."
    },
    quiz: {
      title: "CBT Exam in Progress | MeritScholars",
      desc: "Timed computer-based test in progress. Answer JAMB or WAEC-style questions under exam conditions."
    },
    result: {
      title: "Exam Results & Score Breakdown | MeritScholars CBT",
      desc: "View your CBT score, subject breakdown, and review answers from your JAMB or WAEC practice test."
    },
    bank: {
      title: "Question Bank — JAMB & WAEC Past Questions | MeritScholars",
      desc: "Browse the MeritScholars question bank by subject for JAMB UTME and WAEC. Practice topic by topic with instant feedback."
    },
    analytics: {
      title: "Progress Analytics — Track Weak Topics | MeritScholars CBT",
      desc: "See your attempt history, average scores, weak topics, and improvement over time for JAMB and WAEC practice."
    },
    leaderboard: {
      title: "Leaderboard — Top Student Scores | MeritScholars CBT",
      desc: "Compare your CBT practice scores with other Nigerian students on the MeritScholars leaderboard."
    },
    premium: {
      title: "Premium — Unlock Full Question Bank | MeritScholars CBT",
      desc: "One-time Premium unlock for full JAMB & WAEC question bank, higher AI tutor limits, and advanced progress analytics."
    },
    account: {
      title: "Student Account — Login & Sync | MeritScholars CBT",
      desc: "Create or log in to your MeritScholars student account to sync progress across devices and unlock Premium."
    },
    tutor: {
      title: "Merit AI Tutor — Ask JAMB & WAEC Questions | MeritScholars",
      desc: "Ask the Merit AI Tutor exam questions, get step-by-step explanations, and generate practice questions for JAMB and WAEC."
    },
    support: {
      title: "Help & Support | MeritScholars CBT",
      desc: "Get help with MeritScholars CBT. Contact support by email or WhatsApp for account, Premium, or exam practice questions."
    }
  };
  const m = map[id] || map.home;
  document.title = m.title;
  const setMeta = (selector, attr, value) => {
    let el = document.querySelector(selector);
    if (!el && selector.startsWith('meta[name="description"]')) {
      el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
    }
    if (el) el.setAttribute(attr, value);
  };
  setMeta('meta[name="description"]', "content", m.desc);
  setMeta('meta[property="og:title"]', "content", m.title);
  setMeta('meta[property="og:description"]', "content", m.desc);
  setMeta('meta[name="twitter:title"]', "content", m.title);
  setMeta('meta[name="twitter:description"]', "content", m.desc);
}

function go(id) {
  if (!id) return;
  window.__meritScreen = id;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
  else {
    console.warn("Screen not found:", id);
    const home = document.getElementById("home");
    if (home) home.classList.add("active");
    id = "home";
  }
  document.querySelectorAll(".side-item, .bottom-nav button").forEach(b => {
    const g = b.getAttribute("data-go");
    let active = g === id;
    if (g === "test" && ["test","setup","quiz","result"].includes(id)) active = true;
    b.classList.toggle("on", !!active);
  });
  const sb = document.getElementById("sidebar");
  if (sb) sb.classList.remove("open");
  if (id === "analytics" && typeof renderAnalytics === "function") renderAnalytics();
  if ((id === "leaderboard" || id === "home") && typeof renderLeaderboards === "function") renderLeaderboards();
  if (id === "bank" && typeof renderBank === "function") renderBank();
  if (id === "premium" && typeof refreshPlanUI === "function") refreshPlanUI();
  if (id === "account" && typeof updateAuthUI === "function") updateAuthUI();
  if (id === "tutor" && typeof updateTutorQuota === "function") updateTutorQuota();
  if (id === "support") {
    const em = (CFG.SUPPORT_EMAIL || "lumeriqdesigns@gmail.com");
    const wa = String(CFG.SUPPORT_WHATSAPP || "2349031512760").replace(/\D/g, "");
    if ($("supportEmail")) { $("supportEmail").textContent = em; $("supportEmail").href = "mailto:" + em; }
    if ($("supportWa")) { $("supportWa").textContent = "+" + wa; $("supportWa").href = "https://wa.me/" + wa; }
  }
  if (id === "test" && typeof renderHomeGrid === "function") renderHomeGrid();
  if (typeof updatePageMeta === "function") updatePageMeta(id);
  // Keep URL hash in sync for shareable deep links
  try {
    if (["home","test","bank","analytics","leaderboard","premium","account","tutor","support"].includes(id)) {
      if (location.hash.replace(/^#/, "") !== id) {
        history.replaceState(null, "", "#" + (id === "home" ? "" : id));
      }
    }
  } catch (e) {}
}

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function qKey(q) {
  return q.question_id || [q.subject,q.exam_type,q.year,q.question_text,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option].map(v => String(v || "").trim().toLowerCase()).join("||");
}
function getSeenMap() { try { return JSON.parse(localStorage.getItem("merit_seen_q_v2") || "{}"); } catch { return {}; } }
function saveSeenMap(m) { localStorage.setItem("merit_seen_q_v2", JSON.stringify(m)); }
function pickQuiz(pool, limit) {
  const subjectKey = [...new Set(pool.map(q => q.subject || "GENERAL"))].join("|");
  const map = getSeenMap();
  let seen = new Set(Array.isArray(map[subjectKey]) ? map[subjectKey] : []);
  const ids = pool.map(qKey);
  if (seen.size >= ids.length) seen = new Set();
  const fresh = pool.filter(q => !seen.has(qKey(q)));
  const chosen = shuffle(fresh.length >= limit ? fresh : fresh.concat(shuffle(pool.filter(q => seen.has(qKey(q)))))).slice(0, Math.min(limit,pool.length));
  chosen.forEach(q => seen.add(qKey(q)));
  map[subjectKey] = [...seen];
  saveSeenMap(map);
  return chosen;
}

function renderHomeGrid() {
  const g = $("grid"); if (!g) return;
  const entries = Object.entries(BANK_INDEX);
  const source = entries.length ? entries : Object.keys((FREE_BANK||[]).reduce((m,q)=>{m[q.subject]=1;return m;},{})).map(s=>[s,{count:(FREE_BANK||[]).filter(q=>q.subject===s).length}]);
  g.innerHTML = "";
  source.sort((a,b)=>a[0].localeCompare(b[0])).forEach(([s,e]) => {
    const d=document.createElement("div"); d.className="subj"+(selectedSubjects.includes(s)?" selected":""); d.onclick=()=>toggleSubject(s);
    d.innerHTML=`<div class="ic">${ICONS[s]||"📝"}</div><div class="nm">${s}</div><div class="ct">${Number(e.count||0).toLocaleString()} Qs</div>`; g.appendChild(d);
  });
  const sc=$("selCount"); if(sc) sc.textContent=selectedSubjects.length+" selected"+(selectedSubjects.length>4?" (max 4 for JAMB-style)":"");
  buildHomeNumChips();
}

function toggleSubject(s) {
  const i = selectedSubjects.indexOf(s);
  if (i >= 0) selectedSubjects.splice(i, 1);
  else {
    if (selectedSubjects.length >= 4) {
      alert("Maximum 4 subjects (JAMB-style). Deselect one first.");
      return;
    }
    selectedSubjects.push(s);
  }
  renderHomeGrid();
}

function buildHomeNumChips() {
  const box = $("homeNumChips");
  if (!box) return;
  const prem = isPremium();
  const opts = prem ? [10, 20, 40, 50] : [FREE_MAX_QUESTIONS];
  box.innerHTML = "";
  opts.forEach(n => {
    const d = document.createElement("div");
    const defaultOn = prem ? n === 40 : n === FREE_MAX_QUESTIONS;
    d.className = "chip" + ((numQ === n || defaultOn) ? " on" : "");
    d.textContent = n;
    d.onclick = () => {
      if (!prem && n > FREE_MAX_QUESTIONS) { go("premium"); return; }
      box.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
      d.classList.add("on");
      numQ = n;
    };
    box.appendChild(d);
  });
  if (!prem) {
    const lock = document.createElement("div");
    lock.className = "chip";
    lock.style.opacity = ".55";
    lock.textContent = "Full bank 🔒";
    lock.onclick = () => go("premium");
    box.appendChild(lock);
  }
  const on = box.querySelector(".chip.on");
  if (on && !isNaN(+on.textContent)) numQ = +on.textContent;
  else numQ = prem ? 40 : FREE_MAX_QUESTIONS;
}

function buildNumChips() {
  const box = $("numChips");
  if (!box) return;
  const prem = isPremium();
  const opts = prem ? [10, 20, 40, 50] : [FREE_MAX_QUESTIONS];
  box.innerHTML = "";
  opts.forEach(n => {
    const d = document.createElement("div");
    d.className = "chip" + (n === (prem ? 20 : FREE_MAX_QUESTIONS) ? " on" : "");
    d.textContent = n;
    d.onclick = () => {
      if (!prem && n > FREE_MAX_QUESTIONS) { go("premium"); return; }
      box.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
      d.classList.add("on");
      numQ = n;
    };
    box.appendChild(d);
  });
  if (!prem) {
    const lock = document.createElement("div");
    lock.className = "chip";
    lock.style.opacity = ".55";
    lock.textContent = "More 🔒";
    lock.onclick = () => go("premium");
    box.appendChild(lock);
  }
  numQ = prem ? (numQ > FREE_MAX_QUESTIONS ? numQ : 20) : FREE_MAX_QUESTIONS;
}

async function proceedToHall() {
  if (!selectedSubjects.length) return alert("Select at least one subject.");
  try {
    if (isPremium()) {
      await loadBankIndex();
      const needed = Math.max(numQ, 50);
      await Promise.all(selectedSubjects.map(s => loadSubjectBank(s, { minQuestions: needed })));
    }
    const bank = activeBank(); const diff=$("filterDifficulty")?.value||""; const year=$("filterYear")?.value||""; let combined=[];
    const per=isPremium()?Math.min(numQ,premiumQuestionLimit()):Math.min(numQ,freeQuestionLimit());
    for (const subj of selectedSubjects) {
      let pool=bank.filter(q=>q.subject===subj);
      if(examType!=="ANY")pool=pool.filter(q=>q.exam_type===examType);
      if(diff)pool=pool.filter(q=>(q.difficulty||"medium")===diff);
      if(year)pool=pool.filter(q=>String(q.year)===String(year));
      if(isPremium() && pool.length < per) {
        await loadSubjectBank(subj, { all:true });
        pool=activeBank().filter(q=>q.subject===subj);
        if(examType!=="ANY")pool=pool.filter(q=>q.exam_type===examType);
        if(diff)pool=pool.filter(q=>(q.difficulty||"medium")===diff);
        if(year)pool=pool.filter(q=>String(q.year)===String(year));
      }
      combined=combined.concat(pickQuiz(pool,Math.min(per,pool.length)));
    }
    if(!combined.length)return alert("No questions match your filters. Try Mixed exam type or clear filters.");
    quiz=shuffle(combined); subject=selectedSubjects.join(", "); lastSubject=selectedSubjects[0]; answers={}; cur=0; quizStartedAt=Date.now(); tLeft=quizMode==="mock"?quiz.length*60:quiz.length*90; go("quiz"); renderQ(); startT();
  } catch(e) { console.error(e); alert("Could not load the selected questions. Please try again."); }
}

async function openSetup(s) {
  subject=s; lastSubject=s; if($("setupTitle"))$("setupTitle").textContent=s;
  try {
    if(isPremium()) await loadSubjectBank(s, { minQuestions: 1 });
    const topics=[...new Set(activeBank().filter(q=>q.subject===s).map(q=>q.topic).filter(Boolean))].sort();
    if($("filterTopic")){ $("filterTopic").innerHTML='<option value="">All topics</option>'; topics.forEach(t=>{const o=document.createElement("option");o.value=t;o.textContent=t;$("filterTopic").appendChild(o);}); }
    buildNumChips(); go("setup");
  } catch(e) { console.error(e); alert("Could not load this subject. Please try again."); }
}

function clean(s) {
  let t = String(s || "");
  // Strip internal bank markers (id1907, Set 30, etc.)
  t = t.replace(/\s*[·•]\s*id\d+\b/gi, "")
    .replace(/\s+id\d+\b/gi, "")
    .replace(/\s*\(Set\s*\d+\)/gi, "")
    .replace(/\s*\(v\d+\)/gi, "")
    .replace(/\s*#\d+\b/g, "")
    .replace(/\s*\[(?:Set\s*)?\d+\]/gi, "")
    .replace(/\s*·\s*\d+\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([?.!,;:])/g, "$1")
    .trim();
  return t
    .replace(/\$([^$]+)\$/g, "<em>$1</em>")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\\,/g, " ")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1/$2)")
    .replace(/\\/g, "");
}

async function startQuiz() {
  try {
    if(isPremium()) {
      await loadBankIndex();
      const target = Math.max(numQ, 50);
      await loadSubjectBank(subject, { minQuestions: target });
    }
    let pool=activeBank().filter(q=>q.subject===subject); if(examType!=="ANY")pool=pool.filter(q=>q.exam_type===examType); const topic=$("filterTopic")?.value; if(topic)pool=pool.filter(q=>q.topic===topic); const diff=$("filterDifficulty")?.value; if(diff)pool=pool.filter(q=>(q.difficulty||"medium")===diff); const year=$("filterYear")?.value; if(year)pool=pool.filter(q=>String(q.year)===String(year));
    if(isPremium() && pool.length < 1) { await loadSubjectBank(subject, { all: true, force: true, skipLoaded: true }); pool=activeBank().filter(q=>q.subject===subject); if(examType!=="ANY")pool=pool.filter(q=>q.exam_type===examType); if(topic)pool=pool.filter(q=>q.topic===topic); if(diff)pool=pool.filter(q=>(q.difficulty||"medium")===diff); if(year)pool=pool.filter(q=>String(q.year)===String(year)); }
    if(!pool.length)return alert("No questions match these filters."); const limit=isPremium()?Math.min(numQ,premiumQuestionLimit()):freeQuestionLimit(); quiz=pickQuiz(pool,Math.min(limit,pool.length)); answers={};cur=0;quizStartedAt=Date.now();tLeft=quizMode==="mock"?quiz.length*60:quiz.length*90;go("quiz");renderQ();startT();
  } catch(e) { console.error(e); alert("Could not load the questions. Please try again."); }
}

function renderQ() {
  const q = quiz[cur];
  if (!q) return;
  if ($("qnum")) $("qnum").textContent = "Question " + (cur + 1) + " of " + quiz.length;
  if ($("prog")) $("prog").style.width = ((cur + 1) / quiz.length * 100) + "%";
  if ($("qtext")) $("qtext").innerHTML = clean(q.question_text);
  const opts = $("opts");
  if (!opts) return;
  opts.innerHTML = "";
  ["A", "B", "C", "D"].forEach(L => {
    const v = q["option_" + L.toLowerCase()];
    if (!v) return;
    const d = document.createElement("div");
    d.className = "opt" + (answers[cur] === L ? " sel" : "");
    d.innerHTML = '<span class="lt">' + L + ".</span><span>" + clean(v) + "</span>";
    d.onclick = () => { answers[cur] = L; renderQ(); };
    opts.appendChild(d);
  });
  if ($("bpv")) $("bpv").disabled = cur === 0;
  if ($("bnx")) $("bnx").textContent = cur === quiz.length - 1 ? "Submit" : "Next";
}

function nav(d) {
  if (d > 0 && cur === quiz.length - 1) { finish(); return; }
  cur = Math.max(0, Math.min(quiz.length - 1, cur + d));
  renderQ();
}

function startT() {
  clearInterval(tInt);
  updT();
  tInt = setInterval(() => {
    tLeft--;
    updT();
    if (tLeft <= 0) { clearInterval(tInt); finish(); }
  }, 1000);
}
function updT() {
  if (!$("tmr")) return;
  const m = Math.floor(tLeft / 60), s = tLeft % 60;
  $("tmr").textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  $("tmr").className = "timer" + (tLeft < 30 ? " w" : "");
}

function finish() {
  clearInterval(tInt);
  let ok = 0;
  const topics = {};
  quiz.forEach((q, i) => {
    const correct = answers[i] === q.correct_option;
    if (correct) ok++;
    const tp = q.topic || "General";
    if (!topics[tp]) topics[tp] = { ok: 0, n: 0 };
    topics[tp].n++;
    if (correct) topics[tp].ok++;
  });
  const pctVal = quiz.length ? Math.round((ok / quiz.length) * 100) : 0;
  if ($("pct")) $("pct").textContent = pctVal + "%";
  if ($("scor")) $("scor").textContent = ok + "/" + quiz.length;

  const tc = $("topicCard"), tl = $("topicList");
  if (tc && tl) {
    const rows = Object.entries(topics);
    if (rows.length) {
      tc.hidden = false;
      tl.innerHTML = rows.map(([k, v]) => {
        const p = Math.round((v.ok / v.n) * 100);
        return '<div class="topic-bar"><span class="t">' + k + '</span><div class="b"><i style="width:' + p + '%;background:var(--p)"></i></div><span>' + p + '%</span></div>';
      }).join("");
    } else tc.hidden = true;
  }

  const rl = $("rlist");
  if (rl) {
    rl.innerHTML = quiz.map((q, i) => {
      const right = answers[i] === q.correct_option;
      return '<div class="ri ' + (right ? "ok" : "bad") + '"><div class="n">Q' + (i + 1) + " · " + (right ? "Correct" : "Wrong") +
        " · Answer: " + q.correct_option + '</div><div class="e">' + clean(q.explanation || "") + "</div></div>";
    }).join("");
  }

  const att = {
    id: "local_" + Date.now(),
    subject,
    exam_type: examType,
    mode: quizMode,
    total: quiz.length,
    correct: ok,
    score_pct: pctVal,
    duration_sec: Math.round((Date.now() - quizStartedAt) / 1000),
    topic_breakdown: topics,
    created_at: new Date().toISOString()
  };
  saveAttemptLocal(att);
  pushAttemptRemote(att);
  if (typeof updateLeaderboardFromAttempt === "function") updateLeaderboardFromAttempt(att);
  if (typeof pushLeaderboardRemote === "function") pushLeaderboardRemote(att);
  go("result");
}

async function flagCurrent() {
  const q = quiz[cur];
  if (!q) return;
  const reason = prompt("Reason: wrong_answer / unclear / typo / other", "wrong_answer");
  if (!reason) return;
  const note = prompt("Optional note", "") || "";
  const flags = JSON.parse(localStorage.getItem("merit_flags") || "[]");
  flags.unshift({ subject: q.subject, question_text: q.question_text, reason, note, at: new Date().toISOString() });
  localStorage.setItem("merit_flags", JSON.stringify(flags.slice(0, 100)));
  alert("Flagged. Thank you.");
}

function getAttempts() {
  try { return JSON.parse(localStorage.getItem("merit_attempts") || "[]"); } catch { return []; }
}

function renderAnalytics() {
  const all = getAttempts();
  if ($("aAttempts")) $("aAttempts").textContent = all.length;
  if (all.length) {
    const avg = Math.round(all.reduce((s, a) => s + a.score_pct, 0) / all.length);
    const best = Math.max(...all.map(a => a.score_pct));
    if ($("aAvg")) $("aAvg").textContent = avg + "%";
    if ($("aBest")) $("aBest").textContent = best + "%";
  } else {
    if ($("aAvg")) $("aAvg").textContent = "0%";
    if ($("aBest")) $("aBest").textContent = "0%";
  }
  const weak = {};
  all.forEach(a => {
    const tb = a.topic_breakdown || {};
    Object.entries(tb).forEach(([k, v]) => {
      if (!weak[k]) weak[k] = { ok: 0, n: 0 };
      weak[k].ok += v.ok || 0;
      weak[k].n += v.n || 0;
    });
  });
  const wt = $("weakTopics");
  if (wt) {
    const rows = Object.entries(weak).map(([k, v]) => ({ k, p: Math.round((v.ok / v.n) * 100) }))
      .sort((a, b) => a.p - b.p).slice(0, 10);
    wt.innerHTML = rows.length
      ? rows.map(r => '<div class="topic-bar"><span class="t">' + r.k + '</span><div class="b"><i style="width:' + r.p + '%;background:var(--p)"></i></div><span>' + r.p + '%</span></div>').join("")
      : '<p class="muted">Complete tests to see weak topics.</p>';
  }
  const st = $("scoreTrend");
  if (st) {
    st.innerHTML = all.slice(0, 12).map(a =>
      '<div class="muted" style="margin:4px 0">' + (a.created_at || "").slice(0, 10) + " · " + (a.subject || "") + " · <strong>" + a.score_pct + "%</strong></div>"
    ).join("") || '<p class="muted">No attempts yet.</p>';
  }
  if ($("adminStats")) {
    $("adminStats").innerHTML =
      "<p class=\"muted\">Premium: <strong>" + (isPremium() ? "Yes" : "No") + "</strong></p>" +
      "<p class=\"muted\">Questions loaded: <strong>" + activeBank().length.toLocaleString() + "</strong></p>";
  }
}

function startPay() {
  // Preview build: Premium is intentionally free. No Paystack, payment or API key is required.
  setPremium(3650, "PREVIEW_FREE");
  go("home");
  loadBankIndex().then(() => renderHomeGrid()).catch(console.warn);
  alert("Premium preview unlocked for free. The full question bank is now available.");
}

async function pushLeaderboardRemote(att) {
  if (!sb || !sessionUser) return;
  const name = localStorage.getItem("merit_display_name") || sessionUser.email?.split("@")[0] || "Student";
  try {
    const { data: existing } = await sb.from("leaderboard").select("*").eq("user_id", sessionUser.id).maybeSingle();
    const best = Math.max(existing?.best_score || 0, att.score_pct || 0);
    const attempts = (existing?.attempts || 0) + 1;
    await sb.from("leaderboard").upsert({
      user_id: sessionUser.id,
      display_name: name,
      best_score: best,
      attempts,
      updated_at: new Date().toISOString()
    });
  } catch (e) { console.warn(e); }
}

async function pullRemoteLeaderboard() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from("leaderboard").select("*").order("best_score", { ascending: false }).limit(100);
    if (error || !data) return;
    const mapped = data.map(r => ({
      email: r.user_id,
      name: r.display_name || "Student",
      best: r.best_score || 0,
      attempts: r.attempts || 0
    }));
    if (mapped.length) {
      localStorage.setItem("merit_leaderboard", JSON.stringify(mapped));
      renderLeaderboards();
    }
  } catch (e) { console.warn(e); }
}

function enableBrowserNotifs() {
  if (!("Notification" in window)) return alert("Not supported.");
  Notification.requestPermission().then(p => {
    if (p === "granted") {
      new Notification("MeritScholars", { body: "Notifications enabled." });
      scheduleDailyReminder();
    }
  });
}
function loadNotifPrefs() {
  const p = JSON.parse(localStorage.getItem("merit_notif") || '{"daily":true,"prem":true,"exam":true}');
  if ($("nDaily")) $("nDaily").checked = !!p.daily;
  if ($("nPrem")) $("nPrem").checked = !!p.prem;
  if ($("nExam")) $("nExam").checked = !!p.exam;
}
function saveNotifPrefs() {
  localStorage.setItem("merit_notif", JSON.stringify({
    daily: $("nDaily")?.checked,
    prem: $("nPrem")?.checked,
    exam: $("nExam")?.checked
  }));
}


window.go = go;
  // Set initial page meta from current screen
  try {
    const bootScreen = document.querySelector(".screen.active")?.id || "home";
    updatePageMeta(bootScreen);
  } catch (e) {}

  // Deep-link: open screen from URL hash (#bank, #tutor, etc.)
  try {
    const hash = (location.hash || "").replace(/^#/, "").split("?")[0];
    const valid = ["home","test","setup","quiz","result","bank","analytics","leaderboard","premium","account","tutor","support"];
    if (hash && valid.includes(hash) && typeof go === "function") {
      go(hash);
    }
  } catch (e) {}


function bind() {



  // Global click navigation — all data-go / data-go-direct
  if (!window.__meritNavBound) {
    window.__meritNavBound = true;
    document.addEventListener("click", (e) => {
      const direct = e.target.closest("[data-go-direct]");
      if (direct) {
        e.preventDefault();
        go(direct.getAttribute("data-go-direct"));
        return;
      }
      const nav = e.target.closest("[data-go]");
      if (nav && !nav.closest(".calc-keys")) {
        const g = nav.getAttribute("data-go");
        if (g && (nav.classList.contains("side-item") || nav.closest(".bottom-nav") || nav.classList.contains("linkish") || nav.hasAttribute("data-go"))) {
          // only for intentional nav controls
          if (nav.classList.contains("side-item") || nav.closest(".bottom-nav") || nav.classList.contains("linkish") || nav.classList.contains("test-card")) {
            e.preventDefault();
            go(g);
          }
        }
      }
    });
  }
  document.querySelectorAll(".side-item, .bottom-nav button").forEach(b => {
    b.onclick = (ev) => {
      ev.preventDefault();
      const g = b.getAttribute("data-go");
      if (g) go(g);
    };
  });
  document.querySelectorAll(".linkish[data-go]").forEach(b => {
    b.onclick = (ev) => { ev.preventDefault(); go(b.getAttribute("data-go")); };
  });
  document.querySelectorAll(".test-card").forEach(card => {
    card.onclick = () => {
      if (card.getAttribute("data-go-direct")) return go(card.getAttribute("data-go-direct"));
      const ex = card.getAttribute("data-exam");
      if (ex) {
        examType = ex;
        const chips = $("homeExamChips");
        if (chips) {
          chips.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c.dataset.v === ex));
        }
      }
      go("test");
      if (typeof renderHomeGrid === "function") renderHomeGrid();
    };
  });
  const mt = $("menuToggle");
  if (mt) mt.onclick = () => $("sidebar")?.classList.toggle("open");
  if ($("themeToggle")) $("themeToggle").onclick = toggleDarkMode;
  // header auth wired in updateAuthUI
  updateAuthUI();
  const at = $("authTabs");
  if (at) at.onclick = (e) => {
    const tab = e.target.closest("[data-auth]");
    if (tab) setAuthMode(tab.dataset.auth);
  };
  if ($("btnAuthPrimary")) $("btnAuthPrimary").onclick = () => submitAuthForm(false);
  if ($("authModalClose")) $("authModalClose").onclick = closeAuthModal;
  if ($("authModal")) $("authModal").onclick = (e) => { if (e.target.id === "authModal") closeAuthModal(); };
  if ($("btnModalAuth")) $("btnModalAuth").onclick = () => submitAuthForm(true);
  if ($("authSwitchMode")) $("authSwitchMode").onclick = () => setAuthMode(authMode === "login" ? "signup" : "login");
  setAuthMode("login");
  // resend verification helper on auth pages
  document.querySelectorAll("#authMsg, #modalAuthMsg").forEach(el => {
    el.addEventListener("click", async (e) => {
      if (e.target && e.target.id === "btnResendVerify") {
        const m = await resendVerificationEmail();
        el.textContent = m;
      }
    });
  });
  if ($("btnShare")) $("btnShare").onclick = async () => {
    const url = location.href;
    if (navigator.share) try { await navigator.share({ title: "MeritScholars CBT", url }); } catch (_) {}
    else { await navigator.clipboard.writeText(url); alert("Link copied"); }
  };
  if ($("btnCopyLink")) $("btnCopyLink").onclick = async () => {
    await navigator.clipboard.writeText(location.href);
    alert("Link copied");
  };
  if ($("btnInstallPill")) $("btnInstallPill").onclick = () => {
    alert("APK version coming soon.\n\nFor now, install MeritScholars as a web app from your browser (Add to Home Screen), or use the site online.");
  };
  if ($("installBtn")) {
    $("installBtn").onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        $("installBanner")?.classList.remove("show");
      } else {
        alert("APK version coming soon.\n\nOn mobile Chrome/Safari: use browser menu → Add to Home Screen for the web app.");
      }
    };
  }
  renderLeaderboards();

  // Question bank tabs
  const bt = $("bankTabs");
  if (bt) {
    bt.onclick = (e) => {
      const chip = e.target.closest("[data-bank]");
      if (!chip) return;
      bt.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
      chip.classList.add("on");
      bankExamFilter = chip.getAttribute("data-bank");
      renderBank();
    };
  }
  // CBT customizer home controls
  const hec = $("homeExamChips");
  if (hec) hec.onclick = (e) => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    hec.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
    chip.classList.add("on"); examType = chip.dataset.v;
  };
  const hmp = $("homeModePractice"), hmm = $("homeModeMock");
  if (hmp) hmp.onclick = () => { quizMode = "practice"; hmp.classList.add("on"); hmm?.classList.remove("on"); };
  if (hmm) hmm.onclick = () => { quizMode = "mock"; hmm.classList.add("on"); hmp?.classList.remove("on"); };
  const bp = $("btnProceedHall");
  if (bp) bp.onclick = proceedToHall;

  document.querySelectorAll(".bottom-nav button").forEach(b => {
    b.onclick = () => {
      const g = b.getAttribute("data-go");
      if (g) go(g);
      // buttons without data-go (e.g. Calc) use their own listeners
    };
  });
  if ($("filterDifficulty")) $("filterDifficulty").onchange = renderHomeGrid;
  if ($("filterYear")) $("filterYear").onchange = renderHomeGrid;
  if ($("examChips")) $("examChips").onclick = (e) => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    $("examChips").querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
    chip.classList.add("on"); examType = chip.dataset.v;
  };
  if ($("modePractice")) $("modePractice").onclick = () => { quizMode = "practice"; $("modePractice").classList.add("on"); $("modeMock")?.classList.remove("on"); };
  if ($("modeMock")) $("modeMock").onclick = () => { quizMode = "mock"; $("modeMock").classList.add("on"); $("modePractice")?.classList.remove("on"); };
  if ($("btnBackHome")) $("btnBackHome").onclick = () => go("home");
  if ($("btnStart")) $("btnStart").onclick = startQuiz;
  if ($("bpv")) $("bpv").onclick = () => nav(-1);
  if ($("bnx")) $("bnx").onclick = () => nav(1);
  if ($("btnFlag")) $("btnFlag").onclick = flagCurrent;
  if ($("btnResHome")) $("btnResHome").onclick = () => go("home");
  if ($("btnRetry")) $("btnRetry").onclick = () => { if (lastSubject) openSetup(lastSubject); else go("test"); };
  if ($("btnResAnalytics")) $("btnResAnalytics").onclick = () => go("analytics");
  if ($("btnPay")) $("btnPay").onclick = startPay;
    if ($("btnSignIn")) $("btnSignIn").onclick = signIn;
  if ($("btnSignUp")) $("btnSignUp").onclick = signUp;
  if ($("btnSignOut")) $("btnSignOut").onclick = signOut;
  if ($("btnSync")) $("btnSync").onclick = async () => { await pullRemoteAttempts(); alert("Synced."); };
  if ($("nDaily")) $("nDaily").onchange = saveNotifPrefs;
  if ($("nPrem")) $("nPrem").onchange = saveNotifPrefs;
  if ($("nExam")) $("nExam").onchange = saveNotifPrefs;
  if ($("btnNotif")) $("btnNotif").onclick = enableBrowserNotifs;
  if ($("btnWhatsApp")) $("btnWhatsApp").onclick = openWhatsApp;
  if ($("btnContact")) $("btnContact").onclick = () => {
    const msg = $("contactMsg").value.trim(); if (!msg) return;
    const email = CFG.SUPPORT_EMAIL || "lumeriqdesigns@gmail.com";
    location.href = `mailto:${email}?subject=Excellence%20CBT%20Support&body=${encodeURIComponent(msg)}`;
  };
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferredPrompt = e; $("installBanner").classList.add("show");
  });
  // install handled above (APK coming soon + PWA prompt)
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

bind();
initSupabase();
// restore local session
(function(){
  try {
    const local = JSON.parse(localStorage.getItem("merit_local_user") || "null");
    if (!sessionUser && local && local.email) {
      sessionUser = { email: local.email };
      if (local.name) localStorage.setItem("merit_display_name", local.name);
      updateAuthUI();
    }
  } catch(_) {}
})();
loadNotifPrefs();
applyTheme();
setTimeout(applyTheme, 0);
refreshPlanUI();
loadBankIndex().then(() => { renderHomeGrid(); renderBank(); refreshPlanUI(); }).catch(console.warn);
scheduleDailyReminder();
if (typeof renderLeaderboards === 'function') renderLeaderboards();

// ========== Merit AI Tutor & Question Generator ==========
const TUTOR_SYSTEM = `You are Merit AI, a concise WAEC WASSCE and JAMB UTME tutor for Nigerian secondary students.

Rules:
1. Keep every response under 150 words.
2. Structure exactly as:
**Core Concept**: One sentence defining the principle.
**Step-by-Step Solution**: Numbered steps. Use inline LaTeX as $...$ for maths and formulas.
**Exam Tip**: One memory trick or common WAEC/JAMB trap.
3. Align with official JAMB/WAEC syllabus language. No digressions.`;

const GENERATOR_SYSTEM = `You are an expert JAMB UTME and WAEC WASSCE question author for Nigerian secondary schools.

CRITICAL QUALITY RULES:
1. Output ONLY a valid JSON array. No markdown fences, no commentary.
2. Every question MUST be mathematically/factually correct. Solve the problem yourself before writing options.
3. correct_option MUST match the option that is actually right (A, B, C, or D only).
4. explanation must show clear working that leads to that same correct_option. Never contradict the answer. Never say "misprint" or "intended answer".
5. topic must be a REAL syllabus topic (e.g. "Quadratic equations", "Logarithms", "Geometric progression") — never "Core syllabus topic".
6. Exactly 4 options (option_a … option_d). One correct, three plausible distractors.
7. Use simple, exam-style wording. Prefer whole-number answers when possible.
8. For maths: put formulas in $...$ LaTeX. Double-check algebra before finalising.
9. Schema for each object:
{
  "exam_type": "JAMB" or "WAEC",
  "subject": "SUBJECT IN CAPS",
  "topic": "Specific syllabus topic",
  "question_text": "Clear stem",
  "option_a": "...",
  "option_b": "...",
  "option_c": "...",
  "option_d": "...",
  "correct_option": "A" or "B" or "C" or "D",
  "explanation": "Step-by-step solution ending with why that option is correct",
  "year": 2019-2025,
  "difficulty": "easy" or "medium" or "hard"
}
10. Prefer standard JAMB/WAEC difficulty. Avoid pathological cases (undefined inverse, no solution) unless the question is ABOUT that idea and the correct option reflects it.`;

function aiUsageKey() {
  return "merit_ai_usage_" + new Date().toISOString().slice(0, 10);
}
function getAiUsage() {
  try { return JSON.parse(localStorage.getItem(aiUsageKey()) || '{"n":0}'); } catch { return { n: 0 }; }
}
function bumpAiUsage() {
  const u = getAiUsage();
  u.n = (u.n || 0) + 1;
  localStorage.setItem(aiUsageKey(), JSON.stringify(u));
  return u.n;
}
function aiLimit() {
  return isPremium()
    ? (CFG.AI_PREMIUM_DAILY_LIMIT || 40)
    : (CFG.AI_FREE_DAILY_LIMIT || 3);
}
function updateTutorQuota() {
  const u = getAiUsage();
  const lim = aiLimit();
  const left = Math.max(0, lim - (u.n || 0));
  if ($("tutorQuota"))
    $("tutorQuota").textContent = `Asks left today: ${left} / ${lim}${isPremium() ? " (Premium)" : " (Free — upgrade for more)"}.`;
}



async function callChatAPI(system, userContent, opts) {
  const url = CFG.AI_API_URL || "https://api.openai.com/v1/chat/completions";
  const key = CFG.AI_API_KEY || "";
  if (!key) {
    throw new Error("Merit AI is disabled in this free preview. The CBT question bank works without an AI subscription.");
  }
  opts = opts || {};
  // gpt-oss models spend many tokens on internal reasoning; keep max_tokens high
  // or the visible answer is empty ("No response.").
  const maxTokens = opts.max_tokens || CFG.AI_MAX_TOKENS || 2048;
  const body = {
    model: CFG.AI_MODEL || "gpt-4o-mini",
    temperature: opts.temperature != null ? opts.temperature : 0.4,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent }
    ]
  };
  // Prefer low reasoning effort when the model supports it (saves tokens for the answer)
  if (String(body.model).includes("gpt-oss")) {
    body.reasoning_effort = opts.reasoning_effort || "low";
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("AI API error " + res.status + ": " + t.slice(0, 280));
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  let content = (msg.content || "").trim();
  // Some reasoning models return empty content when max_tokens is too low
  if (!content) {
    const finish = data.choices?.[0]?.finish_reason;
    if (finish === "length") {
      throw new Error("AI ran out of tokens before finishing (increase max_tokens). Try fewer questions.");
    }
    throw new Error("AI returned an empty answer. Try again or switch model in config.js.");
  }
  return content;
}

async function askTutor() {
  const q = ($("tutorInput").value || "").trim();
  if (!q) return alert("Type a question first.");
  const u = getAiUsage();
  const lim = aiLimit();
  if ((u.n || 0) >= lim) {
    if (!isPremium()) {
      alert("Free daily AI limit reached (3). Upgrade to Premium for more, or try tomorrow.");
      return go("premium");
    }
    return alert("Daily AI limit reached. Try again tomorrow.");
  }
  $("btnTutorAsk").disabled = true;
  $("btnTutorAsk").textContent = "Thinking…";
  $("tutorOut").hidden = false;
  $("tutorReply").textContent = "…";
  const subject = $("tutorSubject").value;
  const userMsg = (subject ? `[Subject: ${subject}]\n` : "") + q;
  try {
    const reply = await callChatAPI(TUTOR_SYSTEM, userMsg);
    bumpAiUsage();
    updateTutorQuota();
    $("tutorReply").innerHTML = formatTutorHtml(reply);
  } catch (e) {
    $("tutorReply").textContent = "Error: " + e.message + "\n\nCheck AI_API_KEY / AI_API_URL in config.js.";
  }
  $("btnTutorAsk").disabled = false;
  $("btnTutorAsk").textContent = "Ask Merit AI";
}

function formatTutorHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}


const VERIFIER_SYSTEM = `You are a strict exam-question checker for JAMB/WAEC.

Given a JSON array of multiple-choice questions, independently solve EACH question.
Return ONLY a JSON array (no markdown) with one object per question:
{
  "index": 0-based index,
  "status": "ok" or "flag",
  "claimed_correct": "A|B|C|D",
  "your_correct": "A|B|C|D",
  "reason": "one short sentence explaining why ok or why flagged"
}

Rules:
- status "ok" only if claimed_correct is actually right and explanation agrees.
- status "flag" if wrong answer, contradictory explanation, impossible math, or unclear stem.
- Do not rewrite the full question. Only the verification objects.`;

async function verifyGeneratedQuestions() {
  const list = window.__lastGeneratedQuestions;
  if (!Array.isArray(list) || !list.length) {
    alert("Generate questions first.");
    return;
  }
  const u = getAiUsage();
  const lim = aiLimit();
  if ((u.n || 0) >= lim) {
    alert("Daily AI limit reached.");
    return;
  }
  const btn = $("btnVerifyGen");
  const report = $("genVerifyReport");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Verifying…";
  }
  if (report) {
    report.hidden = false;
    report.innerHTML = "<div class='muted'>Checking answers with AI…</div>";
  }
  try {
    const payload = list.map((q, i) => ({
      index: i,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_option: q.correct_option,
      explanation: q.explanation,
      subject: q.subject,
      topic: q.topic
    }));
    const userMsg = "Verify these questions. Return JSON array only:\n" + JSON.stringify(payload);
    const tokens = Math.min(4096, 600 + list.length * 250);
    let reply = await callChatAPI(VERIFIER_SYSTEM, userMsg, {
      max_tokens: tokens,
      temperature: 0.1,
      reasoning_effort: "medium"
    });
    const m = reply.match(/\[[\s\S]*\]/);
    if (m) reply = m[0];
    const results = JSON.parse(reply);
    bumpAiUsage();
    updateTutorQuota();
    if (!report) return;
    if (!Array.isArray(results)) throw new Error("Unexpected verify response");
    const okN = results.filter(r => String(r.status).toLowerCase() === "ok").length;
    const flagN = results.length - okN;
    let html = `<div class="gv-summary"><strong>${okN} OK</strong> · <strong>${flagN} flagged</strong> out of ${results.length}. Flagged items need human review.</div>`;
    results.forEach((r) => {
      const i = Number(r.index);
      const q = list[i] || {};
      const st = String(r.status || "").toLowerCase() === "ok" ? "ok" : "flag";
      const label = st === "ok" ? "✓ OK" : "⚠ Flag";
      const stem = String(q.question_text || "").replace(/</g, "&lt;").slice(0, 120);
      html += `<div class="gen-verify-item ${st}">
        <div class="gv-head">${label} — Q${i + 1} · claimed ${r.claimed_correct || q.correct_option || "?"} · checker says ${r.your_correct || "?"}</div>
        <div class="gv-meta">${(q.topic || q.subject || "").replace(/</g, "&lt;")} — ${stem}${(stem.length >= 120 ? "…" : "")}</div>
        <div>${String(r.reason || "").replace(/</g, "&lt;")}</div>
      </div>`;
    });
    report.innerHTML = html;
  } catch (e) {
    if (report) report.innerHTML = `<div class="gen-verify-item flag">Verify failed: ${String(e.message || e).replace(/</g, "&lt;")}</div>`;
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Verify answers";
  }
}



function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render generated questions as readable exam-style cards */
function renderGeneratedCards(list) {
  const box = $("genCards");
  const jsonWrap = $("genJsonWrap");
  if (!box) return;
  if (!Array.isArray(list) || !list.length) {
    box.hidden = true;
    box.innerHTML = "";
    if (jsonWrap) jsonWrap.hidden = true;
    return;
  }
  const letters = ["A", "B", "C", "D"];
  const keys = ["option_a", "option_b", "option_c", "option_d"];
  let html = "";
  list.forEach((q, i) => {
    const correct = String(q.correct_option || "").trim().toUpperCase().replace(/^OPTION_/, "").charAt(0);
    const diff = String(q.difficulty || "").toLowerCase();
    html += `<article class="gen-q-card">
      <div class="gen-q-top">
        <span class="gen-q-num">Q${i + 1}</span>
        <span class="tag exam">${escapeHtml(q.exam_type || "")}</span>
        <span class="tag">${escapeHtml(q.subject || "")}</span>
        <span class="tag">${escapeHtml(q.topic || "")}</span>
        ${diff ? `<span class="tag diff-${escapeHtml(diff)}">${escapeHtml(diff)}</span>` : ""}
        ${q.year ? `<span class="tag">${escapeHtml(q.year)}</span>` : ""}
      </div>
      <div class="gen-q-stem">${escapeHtml(q.question_text)}</div>
      <div class="gen-q-opts">`;
    keys.forEach((k, j) => {
      const L = letters[j];
      const isC = L === correct;
      html += `<div class="gen-q-opt${isC ? " correct" : ""}"><span class="letter">${L}.</span><span>${escapeHtml(q[k])}</span></div>`;
    });
    html += `</div>
      <div class="gen-q-exp"><strong>Answer: ${escapeHtml(correct || "?")}</strong><br>${escapeHtml(q.explanation || "")}</div>
    </article>`;
  });
  box.innerHTML = html;
  box.hidden = false;
  if (jsonWrap) jsonWrap.hidden = false;
}


async function generateQuestions() {
  const u = getAiUsage();
  const lim = aiLimit();
  if ((u.n || 0) >= lim) {
    alert("Daily AI limit reached.");
    return;
  }
  const subject = $("genSubject").value;
  const topic = ($("genTopic").value || "Core syllabus topic").trim();
  const exam = $("genExam").value;
  const count = $("genCount").value;
  $("btnGenerate").disabled = true;
  $("btnGenerate").textContent = "Generating…";
  const cards = $("genCards");
  const jsonWrap = $("genJsonWrap");
  if (cards) { cards.hidden = false; cards.innerHTML = "<div class='muted'>Generating questions…</div>"; }
  if (jsonWrap) jsonWrap.hidden = true;
  if ($("genOut")) $("genOut").textContent = "";
  if ($("genVerifyReport")) { $("genVerifyReport").hidden = true; $("genVerifyReport").innerHTML = ""; }
  const topicClean = (!topic || /^core syllabus/i.test(topic)) ? "" : topic;
  const userMsg = [
    `Generate exactly ${count} high-quality ${exam} objective questions.`,
    `Subject: ${subject}.`,
    topicClean ? `Topic focus: ${topicClean}.` : `Choose varied real syllabus topics for ${subject} (do not use "Core syllabus topic").`,
    `Rules: each question must be correct; correct_option must match the true answer; explanation must prove that answer; JSON array only.`
  ].join(" ");
  try {
    const n = Math.min(10, Math.max(1, parseInt(count, 10) || 3));
    // Higher token budget so the model can reason AND output full questions
    const genTokens = Math.min(8192, 1200 + n * 700);
    let reply = await callChatAPI(GENERATOR_SYSTEM, userMsg, { max_tokens: genTokens, temperature: 0.2, reasoning_effort: "medium" });
    const m = reply.match(/\[[\s\S]*\]/);
    if (m) reply = m[0];
    let parsed = null;
    try {
      parsed = JSON.parse(reply);
      reply = JSON.stringify(parsed, null, 2);
      window.__lastGeneratedQuestions = Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      window.__lastGeneratedQuestions = null;
    }
    bumpAiUsage();
    updateTutorQuota();
    if ($("genOut")) $("genOut").textContent = reply;
    renderGeneratedCards(window.__lastGeneratedQuestions);
    const vbtn = $("btnVerifyGen");
    const vhint = $("genVerifyHint");
    const vrep = $("genVerifyReport");
    if (vbtn) vbtn.hidden = !window.__lastGeneratedQuestions;
    if (vhint) vhint.hidden = !window.__lastGeneratedQuestions;
    if (vrep) { vrep.hidden = true; vrep.innerHTML = ""; }
  } catch (e) {
    if ($("genOut")) $("genOut").textContent = "Error: " + e.message;
    if ($("genCards")) { $("genCards").hidden = false; $("genCards").innerHTML = "<div class='gen-verify-item flag'>Error: " + escapeHtml(e.message) + "</div>"; }
    if ($("genJsonWrap")) $("genJsonWrap").hidden = true;
    window.__lastGeneratedQuestions = null;
  }
  $("btnGenerate").disabled = false;
  $("btnGenerate").textContent = "Generate questions";
}

// Extend bind for AI controls (safe if elements exist)
(function bindAI() {
  const ask = $("btnTutorAsk");
  const gen = $("btnGenerate");
  const ver = $("btnVerifyGen");
  if (ask) ask.onclick = askTutor;
  if (gen) gen.onclick = generateQuestions;
  if (ver) ver.onclick = verifyGeneratedQuestions;
  // refresh quota when opening tutor
  const _go = window.go || go;
  window.go = function (id) {
    _go(id);
    if (id === "tutor" && typeof updateTutorQuota === "function") updateTutorQuota();
  };
  updateTutorQuota();
})();

// ========== In-app Calculator (compact) ==========
(function initCalc() {
  const fab = document.getElementById("calcFab");
  const bnCalc = document.getElementById("bnCalc");
  const modal = document.getElementById("calcModal");
  const display = document.getElementById("calcDisplay");
  const closeBtn = document.getElementById("calcClose");
  if ((!fab && !bnCalc) || !modal || !display) return;

  let expr = "";

  function show(v) {
    display.textContent = v || "0";
  }
  function open() {
    modal.hidden = false;
    fab.style.opacity = "0.35";
  }
  function close() {
    modal.hidden = true;
    fab.style.opacity = "1";
  }

  function safeEval(s) {
    // allow only digits and basic math symbols
    if (!/^[\d+\-*/().%\s]+$/.test(s)) throw new Error("bad");
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict"; return (' + s + ")")();
    if (typeof r !== "number" || !isFinite(r)) throw new Error("nan");
    return r;
  }

  function press(k) {
    try {
      if (k === "C") { expr = ""; show("0"); return; }
      if (k === "bk") { expr = expr.slice(0, -1); show(expr || "0"); return; }
      if (k === "±") {
        if (!expr) return;
        if (expr.startsWith("-")) expr = expr.slice(1);
        else expr = "-" + expr;
        show(expr);
        return;
      }
      if (k === "sqrt") {
        const n = safeEval(expr || "0");
        expr = String(Math.sqrt(n));
        show(expr);
        return;
      }
      if (k === "sq") {
        const n = safeEval(expr || "0");
        expr = String(n * n);
        show(expr);
        return;
      }
      if (k === "pct") {
        const n = safeEval(expr || "0");
        expr = String(n / 100);
        show(expr);
        return;
      }
      if (k === "=") {
        const n = safeEval(expr);
        expr = String(Math.round(n * 1e10) / 1e10); // trim float noise
        show(expr);
        return;
      }
      // map display operators already stored as * / etc via data-k
      expr += k;
      show(expr);
    } catch {
      show("Error");
      expr = "";
    }
  }

  if (fab) fab.addEventListener("click", open);
  if (bnCalc) bnCalc.addEventListener("click", (e) => { e.preventDefault(); open(); });
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelectorAll(".ck").forEach((btn) => {
    btn.addEventListener("click", () => press(btn.getAttribute("data-k")));
  });
})();
