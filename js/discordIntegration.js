const SUPABASE_URL = 'https://lgdhantafmbmzwfgfzdi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZGhhbnRhZm1ibXp3ZmdmemRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwOTg4NjUsImV4cCI6MjEwNjY3NDg2NX0.B0YgR9SLNSdk7bECi28XyDK-9KzdzGTdAGkoHcUwkS8';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const DISCORD_INVITE_URL = 'https://discord.gg/manuelleweyt-691138101367668736';
const GUILD_CACHE_KEY = 'discordGuildVerified';
const GUILD_CACHE_TTL_MS = 15 * 60 * 1000;

let checkSessionRunning = false;

const AVATAR_TINT_COLORS = [
  "#eb459e", // fuchsia
  "#57f287", // green
  "#fee75c", // yellow
  "#ed4245", // red
  "#3ba55c", // darker green
  "#faa81a", // orange
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#e67e22", // carrot
];

function pickAvatarColor(userId) {
  if (!userId) return AVATAR_TINT_COLORS[0];
  let hash = 0;
  const s = String(userId);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return AVATAR_TINT_COLORS[Math.abs(hash) % AVATAR_TINT_COLORS.length];
}

function tintDefaultAvatar(color) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 128;
        c.height = img.naturalHeight || 128;
        const cx = c.getContext("2d");
        cx.drawImage(img, 0, 0);
        const id = cx.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        const tintR = parseInt(color.slice(1, 3), 16);
        const tintG = parseInt(color.slice(3, 5), 16);
        const tintB = parseInt(color.slice(5, 7), 16);
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a === 0) continue;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const strength = 1 - brightness;
          d[i]     = r * (1 - strength) + tintR * strength;
          d[i + 1] = g * (1 - strength) + tintG * strength;
          d[i + 2] = b * (1 - strength) + tintB * strength;
        }
        cx.putImageData(id, 0, 0);
        resolve(c.toDataURL("image/png"));
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = "/images/ui/icons/icon_profile_default.png";
  });
}

async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session && session.user ? session : null;
}

function openExclusiveLayer() {
  const scaleContainerLayer = document.getElementById("scale-container-layer");
  const exclusiveLayer = document.getElementById("exclusiveLayer");
  if (scaleContainerLayer) scaleContainerLayer.classList.remove("hidden");
  if (exclusiveLayer) exclusiveLayer.classList.remove("hidden");
  if (typeof showStatic === "function") showStatic();
}

function closeExclusiveLayer() {
  const scaleContainerLayer = document.getElementById("scale-container-layer");
  const exclusiveLayer = document.getElementById("exclusiveLayer");
  if (exclusiveLayer) exclusiveLayer.classList.add("hidden");
  if (scaleContainerLayer) scaleContainerLayer.classList.add("hidden");
  if (typeof hideStatic === "function") hideStatic();
}

function openJoinLayer() {
  const scaleContainerLayer = document.getElementById("scale-container-layer");
  const joinLayer = document.getElementById("joinLayer");
  if (scaleContainerLayer) scaleContainerLayer.classList.remove("hidden");
  if (joinLayer) joinLayer.classList.remove("hidden");
  if (typeof showStatic === "function") showStatic();
}

function closeJoinLayer() {
  const scaleContainerLayer = document.getElementById("scale-container-layer");
  const joinLayer = document.getElementById("joinLayer");
  if (joinLayer) joinLayer.classList.add("hidden");
  if (scaleContainerLayer) scaleContainerLayer.classList.add("hidden");
  if (typeof hideStatic === "function") hideStatic();
}

async function requireLogin() {
  const session = await getSession();
  if (!session) {
    openExclusiveLayer();
    return false;
  }
  return true;
}

async function requireGuildMembership() {
  const session = await getSession();
  if (!session) {
    openExclusiveLayer();
    return false;
  }
  const inGuild = await checkGuildMembership();
  if (inGuild === true) return true;
  if (inGuild === false) openJoinLayer();
  return false;
}

function getDiscordUserId(session) {
  const meta = session.user.user_metadata || {};
  return String(meta.provider_id || meta.sub || session.user.id || '');
}

function writeGuildCache(ok, userId) {
  try {
    localStorage.setItem(GUILD_CACHE_KEY, JSON.stringify({ ok: !!ok, at: Date.now(), userId }));
  } catch (_) {}
}

function readGuildCache(userId) {
  try {
    const raw = localStorage.getItem(GUILD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ok !== "boolean") return null;
    if (typeof parsed.at !== "number") return null;
    if (parsed.userId !== userId) return null;
    return { ok: parsed.ok, at: parsed.at };
  } catch (_) {
    return null;
  }
}

async function checkGuildMembership(force = false) {
  const session = await getSession();
  if (!session) return false;
  const userId = getDiscordUserId(session);
  const cached = readGuildCache(userId);
  if (!force) {
    if (cached && Date.now() - cached.at <= GUILD_CACHE_TTL_MS) return cached.ok;
  }
  const verifiedFallback = cached?.ok === true ? true : null;
  try {
    const { data, error } = await supabaseClient.functions.invoke("verify-discord-membership", {
      body: {}
    });
    if (error) {
      console.error("Could not verify Discord server membership.", error);
      return verifiedFallback;
    }
    if (typeof data?.inGuild !== "boolean") {
      console.error("Discord membership function returned an invalid response.");
      return verifiedFallback;
    }
    const inGuild = data.inGuild;
    writeGuildCache(inGuild, userId);
    return inGuild;
  } catch (error) {
    console.error("Could not verify Discord server membership.", error);
    return verifiedFallback;
  }
}

async function handleDebugClick() {
  const btnDebug = document.getElementById('btnDebug');
  const btnMenu = document.getElementById('btnMenu');
  if (!btnDebug || !btnMenu) return;
  const isActive = btnDebug.classList.contains("active");
  document.querySelectorAll(".btn.menu").forEach(b => {
    b.classList.remove("active");
    b.setAttribute("aria-pressed", "false");
  });
  document.querySelectorAll(".menuContent").forEach(sec => sec.classList.remove("active"));
  if (!isActive) {
    btnDebug.classList.add("active");
    btnDebug.setAttribute("aria-pressed", "true");
    const id = btnDebug.dataset.target;
    const target = document.getElementById(id);
    if (target) target.classList.add("active");
  }
}

function signInWithDiscord() {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      scopes: 'identify',
      redirectTo: window.location.origin + window.location.pathname
    }
  });
}

function openDiscordInvite() {
  window.open(DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer');
}

function setupUserDropdown() {
  const userWrap = document.querySelector('.btnDiscordUser');
  const btnUser = document.getElementById('btnDiscordUser');
  const bgLogout = document.querySelector('.bgLogout');
  const btnLogout = document.getElementById('btnLogout');
  if (!userWrap || !btnUser || !bgLogout) return;
  btnUser.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bgLogout.classList.toggle('active');
  });
  userWrap.addEventListener('mouseleave', () => {
    bgLogout.classList.remove('active');
  });
  if (btnLogout) {
    btnLogout.addEventListener('click', async (e) => {
      e.stopPropagation();
      bgLogout.classList.remove('active');
      localStorage.removeItem(GUILD_CACHE_KEY);
      try {
        const { error: signOutError } = await supabaseClient.auth.signOut();
        if (signOutError) console.error("Could not sign out from Discord.", signOutError);
      } catch (error) {
        console.error("Could not sign out from Discord.", error);
      }
      window.location.reload();
    });
  }
}

async function checkDiscordSession() {
  if (checkSessionRunning) return;
  checkSessionRunning = true;
  try {
    const session = await getSession();
    const loginWrap = document.querySelector('.btnDiscord');
    const userWrap = document.querySelector('.btnDiscordUser');
    if (!loginWrap || !userWrap) return;
    if (session) {
      const meta = session.user.user_metadata || {};
      loginWrap.classList.add('hidden');
      userWrap.classList.remove('hidden');
      const avatarImg = document.querySelector('.profileDiscord');
      if (avatarImg) {
        if (meta.avatar_url) {
          avatarImg.src = meta.avatar_url;
        } else {
          const userId = meta.provider_id || meta.sub || session.user.id || "";
          const color = pickAvatarColor(userId);
          const tinted = await tintDefaultAvatar(color);
          if (tinted) avatarImg.src = tinted;
        }
      }
      const nameSpan = document.querySelector('.textProfile');
      if (nameSpan) {
        nameSpan.textContent =
          meta.custom_claims?.global_name ||
          meta.full_name ||
          meta.name ||
          '';
      }
    } else {
      loginWrap.classList.remove('hidden');
      userWrap.classList.add('hidden');
      const btnMenu = document.getElementById('btnMenu');
      if (btnMenu) btnMenu.classList.remove('showDebug');
      localStorage.removeItem(GUILD_CACHE_KEY);
      const nameSpan = document.querySelector('.textProfile');
      if (nameSpan) nameSpan.textContent = '';
    }
  } finally {
    checkSessionRunning = false;
  }
}

function setupDiscordAuth() {
  const loginBtn = document.querySelector('.btnDiscord #btnDiscord');
  const exclusiveClose = document.getElementById('exclusiveClose');
  const joinClose = document.getElementById('joinClose');
  const btnExclusive = document.getElementById('btnExclusive');
  const btnJoin = document.getElementById('btnJoin');
  const btnDebug = document.getElementById('btnDebug');
  if (loginBtn) loginBtn.addEventListener('click', () => signInWithDiscord());
  if (exclusiveClose) exclusiveClose.addEventListener('click', closeExclusiveLayer);
  if (joinClose) joinClose.addEventListener('click', closeJoinLayer);
  if (btnExclusive) btnExclusive.addEventListener('click', () => signInWithDiscord());
  if (btnJoin) {
    btnJoin.addEventListener('click', openDiscordInvite);
  }
  bindGated(btnDebug, handleDebugClick);
  supabaseClient.auth.onAuthStateChange(() => checkDiscordSession());
  checkDiscordSession();
}

function onAuthChanged(callback) {
  supabaseClient.auth.onAuthStateChange(callback);
}

window.discordIntegration = {
  getSession,
  requireLogin,
  requireGuildMembership,
  checkGuildMembership,
  checkGuildMembershipForced: () => checkGuildMembership(true),
  clearGuildCache: () => { try { localStorage.removeItem(GUILD_CACHE_KEY); } catch (_) {} },
  setupDiscordAuth,
  setupUserDropdown,
  checkDiscordSession,
  closeExclusiveLayer,
  closeJoinLayer,
  signInWithDiscord,
  openDiscordInvite,
  onAuthChanged
};