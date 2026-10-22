let glCanvas = null;
let gl = null;
let shaderProgram = null;
let uniforms = {};
let noiseTexture = null;
let quadBuffer = null;
let sourceTexture = null;
let initialized = false;
let initPromise = null;
let initFailed = false;

const GENE_COLORS = {
  A: [0xcd / 255, 0x90 / 255, 0x15 / 255, 1],
  B: [0x96 / 255, 0xa4 / 255, 0x34 / 255, 1],
  C: [0x98 / 255, 0x22 / 255, 0x0c / 255, 1],
  D: [0x79 / 255, 0x47 / 255, 0x24 / 255, 1],
  E: [0x58 / 255, 0x65 / 255, 0x84 / 255, 1],
  F: [0x73 / 255, 0x4a / 255, 0x87 / 255, 1],
};

function getGeneColor(specimenCode) {
  const m = String(specimenCode || "").match(/_([A-Fa-f])/);
  const g = m ? m[1].toUpperCase() : null;
  return GENE_COLORS[g] || [0xd3 / 255, 0xe0 / 255, 0xde / 255, 1];
}

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("Shader compile error: " + log);
  }
  return sh;
}

function linkProgram(vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error("Program link error: " + log);
  }
  return prog;
}

function loadNoiseTexture() {
  return loadImageWithRetry("/data/fx/shaders/noise.jpg").then(img => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  });
}

async function init() {
  if (initialized) return true;
  if (initFailed) return false;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      glCanvas = document.createElement("canvas");
      glCanvas.width = 512;
      glCanvas.height = 512;
      gl = glCanvas.getContext("webgl", {
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
        alpha: true,
      });
      if (!gl) throw new Error("WebGL no disponible");
      const [vsSrc, fsSrc, noiseTex] = await Promise.all([
        retryResource(async signal => {
          const url = "/data/fx/shaders/death.vert";
          const res = await fetch(url, { signal });
          if (!res.ok) throw createHttpError(res, url);
          return res.text();
        }, 10000, "shader death.vert"),
        retryResource(async signal => {
          const url = "/data/fx/shaders/death.frag";
          const res = await fetch(url, { signal });
          if (!res.ok) throw createHttpError(res, url);
          return res.text();
        }, 10000, "shader death.frag"),
        loadNoiseTexture(),
      ]);
      const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      shaderProgram = linkProgram(vs, fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      noiseTexture = noiseTex;
      uniforms = {
        u_texture: gl.getUniformLocation(shaderProgram, "u_texture"),
        texture2: gl.getUniformLocation(shaderProgram, "texture2"),
        u_fboSize: gl.getUniformLocation(shaderProgram, "u_fboSize"),
        u_fboBufferSize: gl.getUniformLocation(shaderProgram, "u_fboBufferSize"),
        param: gl.getUniformLocation(shaderProgram, "param"),
        fireColor: gl.getUniformLocation(shaderProgram, "fireColor"),
      };
      quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1, 0, 0,
           1, -1, 1, 0,
          -1,  1, 0, 1,
           1,  1, 1, 1,
        ]),
        gl.STATIC_DRAW
      );
      sourceTexture = gl.createTexture();
      initialized = true;
      return true;
    } catch (e) {
      initFailed = true;
      return false;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

function applyToCanvas(ctx, sourceCanvas, progress, fireColor) {
  if (!initialized) return false;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) return false;
  if (glCanvas.width !== w) glCanvas.width = w;
  if (glCanvas.height !== h) glCanvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(shaderProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(uniforms.u_texture, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.uniform1i(uniforms.texture2, 1);
  gl.uniform2f(uniforms.u_fboSize, w, h);
  gl.uniform2f(uniforms.u_fboBufferSize, w, h);
  gl.uniform1f(uniforms.param, Math.max(0, Math.min(1, progress)));
  const c = fireColor || [1, 1, 1, 1];
  gl.uniform4f(uniforms.fireColor, c[0], c[1], c[2], c[3]);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const aPos = gl.getAttribLocation(shaderProgram, "a_position");
  const aUv = gl.getAttribLocation(shaderProgram, "a_texCoord");
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  }
  if (aUv >= 0) {
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.drawImage(glCanvas, 0, 0, w, h, 0, 0, w, h);
  return true;
}

window.deathFxManager = {
  init,
  applyToCanvas,
  getGeneColor,
  isInitialized: () => initialized,
};