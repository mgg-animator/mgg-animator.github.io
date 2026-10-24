(() => {
  const NEWS_SEEN_KEY_PREFIX = "mggNewsSeen";
  const NEWS_LAST_ENTRY_KEY_PREFIX = "mggNewsLastEntry";
  const NEWS_AUTO_ADVANCE_MS = 10000;
  const NEWS_SLIDE_HEIGHT = 460.5;

  const layer = document.getElementById("newsLayer");
  const newsButton = document.getElementById("btnNews");
  const newsButtonWrap = document.querySelector(".btnNews");
  const closeButton = document.getElementById("newsClose");
  const graph = document.getElementById("mutantGraph");
  const leftArrow = document.querySelector(".newsArrowLeft");
  const rightArrow = document.querySelector(".newsArrowRight");
  const exclusiveText = document.querySelector(".textExclusive");
  const joinButton = document.getElementById("btnJoinNews");
  const loginButton = document.getElementById("btnLoginNews");

  let entries = [];
  let currentIndex = -1;
  let currentImage = null;
  let imageRequestId = 0;
  let autoAdvanceTimer = null;
  let seenEntries = new Set();
  let initialized = false;
  let seenStorageKey = null;

  function getStorageKey() {
    const userId = accessUserId || "guest";
    return `${NEWS_SEEN_KEY_PREFIX}:${userId}`;
  }

  function getLastEntryStorageKey() {
    const userId = accessUserId || "guest";
    return `${NEWS_LAST_ENTRY_KEY_PREFIX}:${userId}`;
  }

  function readSeenEntries() {
    try {
      seenStorageKey = getStorageKey();
      const saved = JSON.parse(localStorage.getItem(seenStorageKey) || "[]");
      seenEntries = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
    } catch (error) {
      console.error("Could not read viewed news from local storage.", error);
      seenEntries = new Set();
    }
  }

  function saveSeenEntries() {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify([...seenEntries]));
    } catch (error) {
      console.error("Could not save viewed news to local storage.", error);
    }
  }

  function getEntryKey(entry) {
    return `${entry.type}:${normalizeAccessKey(entry.value)}`;
  }

  function hasUnseenEntries() {
    return entries.some(entry => !seenEntries.has(getEntryKey(entry)));
  }

  function updateNewsButton() {
    if (newsButtonWrap) newsButtonWrap.classList.toggle("shake", hasUnseenEntries());
  }

  function getEntryAccess(entry) {
    const key = normalizeAccessKey(entry.value);
    if (entry.type === "mutant") {
      const membersOnly = accessRules.membersOnly.has(key);
      const blockedForEveryone = accessRules.blockedForEveryone.has(key);
      const restricted = membersOnly;
      const needsToggle = currentUserInGuild && !showHiddenMutants &&
        (membersOnly || (blockedForEveryone && currentUserExempt));
      return {
        restricted,
        needsToggle,
        activeMessage: "active_mutants",
        allowed: needsToggle ? false : restricted
          ? currentUserInGuild && showHiddenMutants
          : canViewMutant(entry.value),
      };
    }
    if (entry.type === "skin") {
      const mutant = allMutants.find(candidate =>
        entry.value.toLowerCase().startsWith(`${candidate.value}_`.toLowerCase())
      );
      const skinValue = mutant ? entry.value.slice(mutant.value.length + 1) : "";
      const mutantKey = mutant ? normalizeAccessKey(mutant.value) : "";
      const membersOnly = accessRules.membersOnly.has(key) ||
        (!!mutant && accessRules.membersOnly.has(mutantKey));
      const blockedForEveryone = accessRules.blockedForEveryone.has(key) ||
        (!!mutant && accessRules.blockedForEveryone.has(mutantKey));
      const needsToggle = currentUserInGuild && !showHiddenMutants &&
        (membersOnly || (blockedForEveryone && currentUserExempt));
      return {
        restricted: membersOnly,
        needsToggle,
        activeMessage: "active_mutants",
        allowed: !!mutant && (needsToggle ? false : membersOnly
          ? currentUserInGuild && showHiddenMutants
          : canViewSkin(mutant.value, skinValue)),
      };
    }
    const membersOnly = accessRules.membersOnlyBackgrounds.has(key);
    const blockedForEveryone = accessRules.blockedBackgroundsForEveryone.has(key);
    const needsToggle = currentUserInGuild && !showHiddenBg &&
      (membersOnly || (blockedForEveryone && currentUserExempt));
    return {
      restricted: membersOnly,
      needsToggle,
      activeMessage: "active_backgrounds",
      allowed: needsToggle ? false : membersOnly
        ? currentUserInGuild && showHiddenBg
        : canViewBackground(entry.value),
    };
  }

  function isEntryBlockedForEveryone(entry) {
    if (currentUserExempt) return false;
    const key = normalizeAccessKey(entry.value);
    if (entry.type === "mutant") return accessRules.blockedForEveryone.has(key);
    if (entry.type === "background") return accessRules.blockedBackgroundsForEveryone.has(key);
    if (entry.type === "skin") {
      const mutant = allMutants.find(candidate =>
        entry.value.toLowerCase().startsWith(`${candidate.value}_`.toLowerCase())
      );
      return accessRules.blockedForEveryone.has(key) ||
        (!!mutant && accessRules.blockedForEveryone.has(normalizeAccessKey(mutant.value)));
    }
    return false;
  }

  function updateEntryAccess(entry) {
    const { restricted, needsToggle, activeMessage, allowed } = getEntryAccess(entry);
    const showExclusive = restricted && !currentUserInGuild;
    const showLogin = showExclusive && !accessUserId;
    const showJoin = showExclusive && !!accessUserId;
    const showActive = needsToggle;
    graph.classList.toggle("btn", allowed);
    graph.setAttribute("aria-label", allowed ? "Open news item" : "");
    if (allowed) {
      graph.setAttribute("role", "button");
      graph.setAttribute("tabindex", "0");
    } else {
      graph.removeAttribute("role");
      graph.removeAttribute("tabindex");
    }
    exclusiveText.classList.toggle("hidden", !showExclusive);
    document.querySelectorAll(".textActive").forEach(message => {
      message.classList.toggle("hidden", !showActive || message.dataset.lang !== activeMessage);
    });
    loginButton.classList.toggle("hidden", !showLogin);
    joinButton.classList.toggle("hidden", !showJoin);
  }

  function markEntrySeen(entry) {
    seenEntries.add(getEntryKey(entry));
    saveSeenEntries();
    updateNewsButton();
  }

  function saveLastEntry(entry) {
    try {
      localStorage.setItem(getLastEntryStorageKey(), getEntryKey(entry));
    } catch (error) {
      console.error("Could not save the last news entry to local storage.", error);
    }
  }

  function getImagePath(entry) {
    const fileName = entry.type === "background"
      ? `arena_${entry.value}_obtain.jpg`
      : `${entry.value}_obtain.jpg`;
    return `/images/news/${encodeURIComponent(fileName.toLowerCase())}`;
  }

  function setImage(entry, direction) {
    const requestId = ++imageRequestId;
    const image = new Image();
    image.className = "newsSlideImage";
    image.alt = entry.value;
    image.onload = () => {
      if (requestId !== imageRequestId) return;
      graph.querySelectorAll("img:not(.newsSlideImage)").forEach(placeholder => placeholder.remove());
      graph.querySelectorAll(".newsSlideImage").forEach(existing => {
        if (existing !== currentImage) existing.remove();
      });
      if (currentImage) currentImage.classList.remove("newsSlideExitLeft", "newsSlideExitRight");
      const width = image.naturalWidth * (NEWS_SLIDE_HEIGHT / image.naturalHeight);
      graph.style.width = `${width}px`;
      image.style.height = `${NEWS_SLIDE_HEIGHT}px`;
      if (!currentImage || !direction) {
        if (currentImage) currentImage.remove();
        image.classList.add("newsSlideCurrent");
        graph.appendChild(image);
        currentImage = image;
        return;
      }
      const outgoingImage = currentImage;
      image.classList.add("newsSlideIncoming");
      if (direction === "previous") image.classList.add("newsSlideFromLeft");
      graph.appendChild(image);
      void image.offsetWidth;
      outgoingImage.classList.add(direction === "next" ? "newsSlideExitLeft" : "newsSlideExitRight");
      requestAnimationFrame(() => image.classList.add("newsSlideActive"));
      image.addEventListener("transitionend", () => {
        if (requestId !== imageRequestId) return;
        outgoingImage.remove();
        image.classList.remove("newsSlideIncoming", "newsSlideActive");
        image.classList.add("newsSlideCurrent");
        currentImage = image;
      }, { once: true });
    };
    image.onerror = () => {
      if (requestId === imageRequestId) {
        console.error(`Could not load news image: ${image.src}`);
      }
    };
    image.src = getImagePath(entry);
  }

  function displayEntry(index, direction) {
    if (!entries.length) return;
    currentIndex = (index + entries.length) % entries.length;
    const entry = entries[currentIndex];
    setImage(entry, direction);
    updateEntryAccess(entry);
    saveLastEntry(entry);
    markEntrySeen(entry);
  }

  function stopAutoAdvance() {
    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function scheduleAutoAdvance() {
    stopAutoAdvance();
    if (entries.length < 2 || layer.classList.contains("hidden")) return;
    autoAdvanceTimer = setTimeout(() => {
      displayEntry(currentIndex + 1, "next");
      scheduleAutoAdvance();
    }, NEWS_AUTO_ADVANCE_MS);
  }

  function navigate(direction) {
    if (entries.length < 2) return;
    displayEntry(currentIndex + (direction === "next" ? 1 : -1), direction);
    scheduleAutoAdvance();
  }

  function firstUnseenIndex() {
    const index = entries.findIndex(entry => !seenEntries.has(getEntryKey(entry)));
    if (index >= 0) return index;
    try {
      const lastEntryKey = localStorage.getItem(getLastEntryStorageKey());
      const lastIndex = entries.findIndex(entry => getEntryKey(entry) === lastEntryKey);
      return lastIndex >= 0 ? lastIndex : 0;
    } catch (error) {
      console.error("Could not read the last news entry from local storage.", error);
      return 0;
    }
  }

  function openNews(index = firstUnseenIndex()) {
    if (!entries.length) return;
    layer.classList.remove("hidden");
    if (scaleContainerLayer) scaleContainerLayer.classList.remove("hidden");
    showStatic();
    displayEntry(index);
    scheduleAutoAdvance();
  }

  function closeNews() {
    layer.classList.add("hidden");
    if (scaleContainerLayer) scaleContainerLayer.classList.add("hidden");
    hideStatic();
    stopAutoAdvance();
  }

  function buildEntries() {
    entries = [
      ...accessRules.newMutantEntries.map(value => ({ type: "mutant", value })),
      ...accessRules.newSkinEntries.map(value => ({ type: "skin", value })),
      ...accessRules.newBackgroundEntries.map(value => ({ type: "background", value })),
    ].filter(entry => !isEntryBlockedForEveryone(entry));
  }

  function updateArrowVisibility() {
    const hideArrows = entries.length < 2;
    leftArrow.classList.toggle("hidden", hideArrows);
    rightArrow.classList.toggle("hidden", hideArrows);
  }

  async function openEntry() {
    const entry = entries[currentIndex];
    if (!entry || !getEntryAccess(entry).allowed) return;
    closeNews();
    if (entry.type === "mutant") {
      const mutant = allMutants.find(candidate => normalizeAccessKey(candidate.value) === normalizeAccessKey(entry.value));
      if (!mutant) {
        console.error(`Could not find the mutant for news entry: ${entry.value}`);
        return;
      }
      await selectCharacter("mutant", mutant);
      return;
    }
    if (entry.type === "skin") {
      const mutant = allMutants.find(candidate =>
        entry.value.toLowerCase().startsWith(`${candidate.value}_`.toLowerCase())
      );
      if (!mutant) {
        console.error(`Could not find the mutant for news skin: ${entry.value}`);
        return;
      }
      const skinValue = entry.value.slice(mutant.value.length + 1);
      await selectCharacter("mutant", mutant);
      const skin = allSkins.find(candidate => normalizeAccessKey(candidate.value) === normalizeAccessKey(skinValue));
      if (!skin) {
        console.error(`Could not find the skin for news entry: ${entry.value}`);
        return;
      }
      await selectSkin(skin);
      return;
    }
    const background = allBackgrounds.find(candidate =>
      normalizeAccessKey(candidate.value) === normalizeAccessKey(entry.value)
    );
    if (!background) {
      console.error(`Could not find the background for news entry: ${entry.value}`);
      return;
    }
    await selectBg(background);
  }

  function activateArrow(element, direction) {
    if (!element) return;
    element.addEventListener("click", () => navigate(direction));
    element.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigate(direction);
    });
  }

  function updateNewsAccess() {
    if (initialized && seenStorageKey !== getStorageKey()) {
      readSeenEntries();
    }
    const previousEntry = currentIndex >= 0 ? entries[currentIndex] : null;
    buildEntries();
    updateArrowVisibility();
    currentIndex = previousEntry
      ? entries.findIndex(entry => getEntryKey(entry) === getEntryKey(previousEntry))
      : -1;
    if (currentIndex < 0 && !layer.classList.contains("hidden") && entries.length) {
      displayEntry(firstUnseenIndex());
    } else if (!entries.length && !layer.classList.contains("hidden")) {
      closeNews();
    }
    updateNewsButton();
    if (currentIndex >= 0 && entries[currentIndex]) updateEntryAccess(entries[currentIndex]);
  }

  function initializeNews() {
    if (initialized) return;
    initialized = true;
    buildEntries();
    readSeenEntries();
    updateNewsButton();
    updateArrowVisibility();
    newsButton.addEventListener("click", () => openNews());
    closeButton.addEventListener("click", closeNews);
    activateArrow(leftArrow, "previous");
    activateArrow(rightArrow, "next");
    graph.addEventListener("click", openEntry);
    graph.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openEntry();
    });
    loginButton.addEventListener("click", () => window.discordIntegration.signInWithDiscord());
    joinButton.addEventListener("click", () => window.discordIntegration.openDiscordInvite());
    if (hasUnseenEntries()) openNews();
  }

  window.initializeNews = initializeNews;
  window.updateNewsAccess = updateNewsAccess;
})();
