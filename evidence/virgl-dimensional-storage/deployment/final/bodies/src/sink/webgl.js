// E5-T06b: WebGL2 presentation backend for the core FrameSink.

import {
  PresentBackend,
  validateCanvasSize,
  validatePixelWords,
  validatePresentRect,
} from "./present-backend.js";

const DEFAULT_CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: true,
  premultipliedAlpha: false,
});

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 out_color;
void main() {
  out_color = texture(u_texture, v_uv).bgra;
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("WebGL2 could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compilation failed: ${info}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("WebGL2 could not create a program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "unknown program link error";
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link failed: ${info}`);
  }
  return program;
}

function createQuad(gl, program) {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  if (vao === null || buffer === null) {
    if (vao !== null) gl.deleteVertexArray(vao);
    if (buffer !== null) gl.deleteBuffer(buffer);
    throw new Error("WebGL2 could not create the fullscreen quad");
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]),
    gl.STATIC_DRAW,
  );
  const location = gl.getAttribLocation(program, "a_position");
  if (location < 0) {
    gl.bindVertexArray(null);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    throw new Error("WebGL2 fullscreen quad position attribute is unavailable");
  }
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vao, buffer };
}

function uint32ByteView(pixels, expectedWords) {
  if (!(pixels instanceof Uint32Array)) {
    throw new TypeError("WebGL2 present pixels must be a Uint32Array");
  }
  validatePixelWords(pixels, expectedWords);
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}

/**
 * Present the T03 full resource-sized BGRA word view through WebGL2.
 *
 * The source is copied as raw bytes into one private Uint8Array so SharedArrayBuffer-backed guest
 * memory never crosses the WebGL API.  WebGL uploads the damage rectangle with row/skip unpack
 * state, and the fragment shader's `.bgra` swizzle converts the core byte order without a
 * JavaScript loop.  The vertex shader maps texture v=0 to the visual top so guest row zero is
 * not upside down on the canvas.
 */
export class WebGL2Backend extends PresentBackend {
  constructor(canvas, { context = null, contextAttributes = DEFAULT_CONTEXT_ATTRIBUTES } = {}) {
    super();
    if (canvas === null || typeof canvas !== "object" || typeof canvas.getContext !== "function") {
      throw new TypeError("WebGL2Backend requires a canvas-like object");
    }
    const gl = context ?? canvas.getContext("webgl2", contextAttributes);
    if (gl === null || typeof gl !== "object") {
      throw new TypeError("WebGL2 is not available for this canvas");
    }
    const size = validateCanvasSize(canvas.width, canvas.height);
    this.canvas = canvas;
    this.gl = gl;
    this.width = size.width;
    this.height = size.height;
    this._canvasBytes = size.bytes;
    this._staging = new Uint8Array(0);
    this._presentCount = 0;
    this._disposed = false;

    this._program = createProgram(gl);
    this._quad = createQuad(gl, this._program);
    this._texture = gl.createTexture();
    if (this._texture === null) {
      this.dispose();
      throw new Error("WebGL2 could not create the scanout texture");
    }
    this._sampler = gl.getUniformLocation(this._program, "u_texture");
    if (this._sampler === null) {
      this.dispose();
      throw new Error("WebGL2 scanout sampler uniform is unavailable");
    }
    this._configureTexture();
    this._allocateTexture(size.width, size.height);
  }

  _assertAlive() {
    if (this._disposed) throw new Error("WebGL2 presentation backend is disposed");
  }

  _configureTexture() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _allocateTexture(width, height) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Resize the canvas and reallocate the texture, releasing old private staging. */
  resize(width, height) {
    this._assertAlive();
    const size = validateCanvasSize(width, height);
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.width = size.width;
    this.height = size.height;
    this._canvasBytes = size.bytes;
    this._staging = new Uint8Array(0);
    this.gl.viewport(0, 0, size.width, size.height);
    this._allocateTexture(size.width, size.height);
    return { width: this.width, height: this.height };
  }

  _copySource(pixels) {
    const source = uint32ByteView(pixels, this.width * this.height);
    if (source.byteLength !== this._canvasBytes) {
      throw new RangeError("WebGL2 pixel byte view does not match the current canvas");
    }
    if (this._staging.byteLength !== this._canvasBytes) {
      this._staging = new Uint8Array(this._canvasBytes);
    }
    this._staging.set(source);
  }

  _upload(damage) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, damage.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, damage.y);
    try {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        damage.x,
        damage.y,
        damage.width,
        damage.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this._staging,
      );
    } finally {
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  _draw() {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this._program);
    gl.bindVertexArray(this._quad.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.uniform1i(this._sampler, 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  /** Upload one full-frame BGRA view, update its damage rectangle, and redraw the quad. */
  present(rect, pixels) {
    this._assertAlive();
    const damage = validatePresentRect(rect, this.width, this.height);
    this._copySource(pixels);
    this._upload(damage);
    this._draw();
    this._presentCount += 1;
    return damage;
  }

  /** Release GL objects and the private full-frame byte staging buffer. */
  dispose() {
    if (this._disposed) return;
    const gl = this.gl;
    if (this._texture !== undefined && this._texture !== null) gl.deleteTexture(this._texture);
    if (this._quad?.buffer !== undefined && this._quad.buffer !== null) gl.deleteBuffer(this._quad.buffer);
    if (this._quad?.vao !== undefined && this._quad.vao !== null) gl.deleteVertexArray(this._quad.vao);
    if (this._program !== undefined && this._program !== null) gl.deleteProgram(this._program);
    this._texture = null;
    this._quad = null;
    this._program = null;
    this._sampler = null;
    this._staging = new Uint8Array(0);
    this._disposed = true;
  }

  get stagingCapacity() {
    return this._staging.byteLength;
  }

  get canvasByteBudget() {
    return this._canvasBytes;
  }

  get presentCount() {
    return this._presentCount;
  }
}
