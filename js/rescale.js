function getBaseScale() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return Math.min(w / 1920, h / 1080);
}

function scaleSite() {
  const container = document.getElementById("scale-container");
  const containerLayer = document.getElementById("scale-container-layer");
  if (!container || !containerLayer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = getBaseScale();
  currentScale = scale;
  const newsLayer = document.getElementById("newsLayer");
  if (newsLayer) newsLayer.style.width = `${w / scale}px`;
  const scaledW = 1920 * scale;
  const scaledH = 1080 * scale;
  const offsetX = (w - scaledW) / 2;
  const offsetY = (h - scaledH) / 2;
  for (const el of [container, containerLayer]) {
    el.style.transform = `scale(${scale})`;
    el.style.transformOrigin = "top left";
    el.style.position = "absolute";
    el.style.left = `${offsetX}px`;
    el.style.top = `${offsetY}px`;
  }
  document.body.style.margin = "0";
  document.body.style.width = `${w}px`;
  document.body.style.height = `${h}px`;
}

function scaleCover() {
  const container = document.getElementById("cover-container");
  if (!container) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.max(w / 1920, h / 1080);
  const scaledW = 1920 * scale;
  const scaledH = 1080 * scale;
  const offsetX = (w - scaledW) / 2;
  const offsetY = (h - scaledH) / 2;
  container.style.transform = `scale(${scale})`;
  container.style.transformOrigin = "top left";
  container.style.position = "fixed";
  container.style.left = `${offsetX}px`;
  container.style.top = `${offsetY}px`;
  container.style.width = "1920px";
  container.style.height = "1080px";
}

function applyLayout() {
  scaleSite();
  scaleCover();
}

window.addEventListener("load", applyLayout);
window.addEventListener("resize", () => {
  if (!document.fullscreenElement) applyLayout();
});