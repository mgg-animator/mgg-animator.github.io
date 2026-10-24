const DEFAULT_BG_VALUE = "detroit_01";
const canvasLoad = document.getElementById("canvasLoad");
const btn_menu = document.querySelectorAll(".btn.menu");
const btnDebug = document.getElementById("btnDebug");
const btnMenu = document.getElementById("btnMenu");
const menuContent = document.querySelectorAll(".menuContent");
const infoClose = document.getElementById("infoClose");
const infoLayer = document.getElementById("infoLayer");
const clickBlocker = document.getElementById("clickBlocker");
const clickToClose = document.getElementById("clickToClose");
const loadingScreen = document.getElementById("loadingScreen");
const scaleContainerLayer = document.getElementById("scale-container-layer");
const coverContainer = document.getElementById("cover-container");
const mutantSelect = document.getElementById("mutantSelect");
const rivalSelect = document.getElementById("rivalSelect");
const skinSelect = document.getElementById("skinSelect");
const animationSelect = document.getElementById("animationSelect");
const btnLang = document.getElementById("btnLang");
const langLayer = document.getElementById("langLayer");
const logoManu = document.getElementById("logoManu");
const btnStats = document.getElementById("btnStats");
const btnPlay = document.getElementById("btnPlay");
const btnBack = document.getElementById("btnBack");
const btnForward = document.getElementById("btnForward");
const btnStop = document.getElementById("btnStop");
const btnSpeed = document.getElementById("btnSpeed");
const btnLoop = document.getElementById("btnLoop");
const btnFullscreen = document.getElementById("btnFullscreen");
const playerTimeline = document.getElementById("playerTimeline");
const playerLine = document.getElementById("playerLine");
const playerBar = document.getElementById("playerBar");
const btnSound = document.getElementById("btnSound");
const btnScreenshot = document.getElementById("btnScreenshot");
const btnDelete = document.getElementById("btnDelete");
const rivalSkinSelect = document.getElementById("rivalSkinSelect");
const COMBAT_PATTERN = /^(attack|hit)/i;
const ATTACK_PATTERN = /^attack/i;
const ATTACK_SPEED_MULTIPLIER = 1.5;
const DEATH_PATTERN = /^death/i;
const MID_WATERMARK_PATH = "/images/ui/logo_manu.png";
const MID_WATERMARK_OPACITY = 0.25;
const MID_WATERMARK_WIDTH_RATIO = 1.0;
const THUMBNAIL_CONCURRENCY = 4;
const SCREENSHOT_JPEG_QUALITY = 0.9;
const BOOT_TIMEOUT_MS = 10000;
const BOOT_ATTEMPT_KEY = "mgg_boot_attempts";
const MAX_BOOT_ATTEMPTS = 3;
const rivalAnimationCache = new Map();
const listControllers = {};
const preloadedThumbnails = new Set();
const bgButtonsForBlock = [];
const accessRules = {
  exemptUserIds: new Set(),
  blockedForEveryone: new Set(),
  membersOnly: new Set(),
  blockedBackgroundsForEveryone: new Set(),
  membersOnlyBackgrounds: new Set(),
  newMutants: new Set(),
  newMutantEntries: [],
  newSkins: new Set(),
  newSkinEntries: [],
  newBackgrounds: new Set(),
  newBackgroundEntries: [],
};
const BG_BUTTONS = [
  { id: "btnCampaign", type: "bg_cmp" },
  { id: "btnPve", type: "bg_pve" },
  { id: "btnRaid", type: "bg_rid" },
  { id: "btnValentines", type: "bg_val" },
  { id: "btnEaster", type: "bg_eas" },
  { id: "btnAnniversary", type: "bg_anv" },
  { id: "btnHalloween", type: "bg_hal" },
  { id: "btnXmas", type: "bg_xms" }
];
const playerButtons = [
  btnPlay, btnBack, btnForward, btnStop,
  btnSpeed, btnLoop, btnSound, btnScreenshot
];
const DEBUG_STATE_KEY = "debugState";

let deathShaderReadyPromise = null;
let availableLangs = [];
let currentLang = (document.documentElement.lang || "en").trim().toLowerCase().split("-")[0] || "en";
let currentScale = 1;
let allMutants = [];
let currentFilters = { mutant: "default_", rival: "default_" };
let selectedValues = { mutant: null, rival: null };
let allSkins = [];
let allAnimations = [];
let selectedSkin = null;
let selectedAnimation = null;
let allRivalSkins = [];
let selectedRivalSkin = null;
let itemListMode = null;
let allBackgrounds = [];
let currentBgFilter = null;
let availableSpeeds = [];
let currentSpeedIndex = 0;
let timelineDragging = false;
let timelineDraggingPaused = false;
let timelineLastFrame = -1;
let timelinePlaceholder = null;
let loopEnabled = true;
let savedAncestorStyles = [];
let cameraDragging = false;
let cameraDragLastX = 0;
let cameraDragLastY = 0;
let showHiddenMutants = false;
let showHiddenBg = false;
let backgroundFromEventEnabled = false;
let currentRivalStandTree = null;
let currentRivalStandImage = null;
let currentRivalAssets = null;
let transportSchedule = null;
let watermarkImage = null;
let showRivalEnabled = true;
let rivalHitPlaying = false;
let rivalHitTicksElapsed = 0;
let rivalHitDurationTicks = 0;
let lastAnimationTime = 0;
let lastSeenTick = 0;
let midWatermarkImage = null;
let midWatermarkLoaded = false;
let firstMutantLoaded = false;
let fxLastTick = -0.001;
let momentIdx = {};
let soundSchedule = [];
let currentUserExempt = false;
let currentUserInGuild = false;
let mutantAttackData = {};
let multipleRivalsEnabled = true;
let thumbnailQueueRunning = false;
let currentBgLayer = 0;
let fullscreenLocked = false;
let fullscreenLockTimer = null;

function loadPersistedDebugState() {
  try {
    const raw = localStorage.getItem(DEBUG_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function savePersistedDebugState() {
  const prevRaw = localStorage.getItem(DEBUG_STATE_KEY);
  let prev = {};
  try { prev = prevRaw ? JSON.parse(prevRaw) : {}; } catch (_) { prev = {}; }

  const preserveGuildFlags = !currentUserInGuild;

  const data = {
    showRivalEnabled: preserveGuildFlags ? prev.showRivalEnabled : showRivalEnabled,
    multipleRivalsEnabled: preserveGuildFlags ? prev.multipleRivalsEnabled : multipleRivalsEnabled,
    showHiddenMutants: preserveGuildFlags ? prev.showHiddenMutants : showHiddenMutants,
    showHiddenBg: preserveGuildFlags ? prev.showHiddenBg : showHiddenBg,
    backgroundFromEventEnabled: preserveGuildFlags ? prev.backgroundFromEventEnabled : backgroundFromEventEnabled,
    effectsEnabled: preserveGuildFlags ? prev.effectsEnabled : window.fxManager.isEffectsEnabled(),
    lightsEnabled: preserveGuildFlags
      ? prev.lightsEnabled
      : (typeof window.fxManager.isLightsEnabled === "function" ? window.fxManager.isLightsEnabled() : true),
    framesEnabled: window.sceneRenderer.isFrameCounterEnabled(),
    boundsEnabled: window.animationEngine.getShowBounds(),
    boundsColor: window.animationEngine.getBoundsColor(),
  };
  try { localStorage.setItem(DEBUG_STATE_KEY, JSON.stringify(data)); } catch (_) {}
}