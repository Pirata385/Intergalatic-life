// WebGL sphere renderer for close-up planet views (per-pixel lighting, clouds,
// city lights / lava glow and atmosphere scattering rim).
import type { PlanetTexture } from '../gen/planet';

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uClouds;
uniform sampler2D uEmissive;
uniform float uRot, uCloudRot, uHasClouds, uHasEmissive, uAtmoStrength, uPad, uTime;
uniform vec3 uLight, uAtmo;
void main(){
  vec2 p = (vUv*2.0-1.0) * (1.0 + uPad);
  float d2 = dot(p,p);
  if (d2 > 1.0) {
    float d = sqrt(d2);
    float glow = uAtmoStrength * pow(smoothstep(1.0 + uPad, 1.0, d), 2.2) * 0.75;
    float l = clamp(dot(normalize(vec3(p, 0.2)), uLight)*0.7+0.35, 0.0, 1.0);
    float a = glow * l;
    gl_FragColor = vec4(uAtmo * a, a);
    return;
  }
  vec3 n = vec3(p, sqrt(1.0-d2));
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.x, n.z);
  vec2 uv = vec2((lon + uRot)/6.2831853, (lat + 1.5707963)/3.1415926);
  vec3 col = texture2D(uColor, uv).rgb;
  if (uHasClouds > 0.5) {
    vec4 c = texture2D(uClouds, vec2((lon + uCloudRot)/6.2831853, uv.y));
    col = mix(col, c.rgb, c.a);
  }
  float lam = dot(n, uLight);
  float lit = clamp(lam*1.15+0.06, 0.0, 1.0);
  vec3 lc = col * (0.035 + lit*0.965);
  // specular glint on oceans (dark blue-ish pixels)
  float water = clamp((col.b - col.r) * 2.5, 0.0, 1.0);
  vec3 h = normalize(uLight + vec3(0.0,0.0,1.0));
  lc += water * pow(max(dot(n,h),0.0), 40.0) * 0.5 * vec3(1.0,0.95,0.85);
  if (uHasEmissive > 0.5) {
    vec4 e = texture2D(uEmissive, uv);
    float night = 1.0 - clamp(lam*3.0+0.3, 0.0, 1.0);
    lc += e.rgb * e.a * (night*0.95+0.12);
  }
  float edge = sqrt(d2);
  float rim = pow(edge, 5.0) * uAtmoStrength * clamp(lam+0.45, 0.04, 1.0);
  lc = mix(lc, uAtmo, rim*0.85);
  float a = 1.0 - smoothstep(0.992, 1.0, edge);
  gl_FragColor = vec4(lc*a, a);
}`;

export class PlanetGL {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext | null;
  prog: WebGLProgram | null = null;
  tex: { color: WebGLTexture | null; clouds: WebGLTexture | null; emissive: WebGLTexture | null } = { color: null, clouds: null, emissive: null };
  current: PlanetTexture | null = null;
  uniforms: Record<string, WebGLUniformLocation | null> = {};
  ok = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false }) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    this.gl = gl;
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.warn(gl!.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return;
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const u of ['uColor', 'uClouds', 'uEmissive', 'uRot', 'uCloudRot', 'uHasClouds', 'uHasEmissive', 'uAtmoStrength', 'uPad', 'uLight', 'uAtmo', 'uTime']) this.uniforms[u] = gl.getUniformLocation(p, u);
    gl.uniform1i(this.uniforms.uColor, 0);
    gl.uniform1i(this.uniforms.uClouds, 1);
    gl.uniform1i(this.uniforms.uEmissive, 2);
    this.ok = true;
  }

  private upload(unit: number, data: Uint8ClampedArray, w: number, h: number, old: WebGLTexture | null): WebGLTexture {
    const gl = this.gl!;
    const t = old ?? gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  setTexture(t: PlanetTexture): void {
    if (!this.ok || this.current === t) return;
    this.current = t;
    this.tex.color = this.upload(0, t.color, t.w, t.h, this.tex.color);
    if (t.clouds) this.tex.clouds = this.upload(1, t.clouds, t.w, t.h, this.tex.clouds);
    if (t.emissive) this.tex.emissive = this.upload(2, t.emissive, t.w, t.h, this.tex.emissive);
  }

  /** Renders the current planet into its canvas; size = sphere diameter in pixels. */
  render(size: number, rot: number, cloudRot: number, light: [number, number, number], pad = 0.18): HTMLCanvasElement {
    const gl = this.gl!;
    const t = this.current!;
    const full = Math.round(size * (1 + pad));
    if (this.canvas.width !== full) {
      this.canvas.width = full;
      this.canvas.height = full;
    }
    gl.viewport(0, 0, full, full);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.color);
    if (t.clouds) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.clouds); }
    if (t.emissive) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tex.emissive); }
    const u = this.uniforms;
    gl.uniform1f(u.uRot, rot);
    gl.uniform1f(u.uCloudRot, cloudRot);
    gl.uniform1f(u.uHasClouds, t.clouds ? 1 : 0);
    gl.uniform1f(u.uHasEmissive, t.emissive ? 1 : 0);
    gl.uniform1f(u.uAtmoStrength, t.pal.atmoStrength);
    gl.uniform1f(u.uPad, pad);
    const l = Math.hypot(...light) || 1;
    gl.uniform3f(u.uLight, light[0] / l, -light[1] / l, light[2] / l);
    gl.uniform3f(u.uAtmo, t.pal.atmo[0] / 255, t.pal.atmo[1] / 255, t.pal.atmo[2] / 255);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

let shared: PlanetGL | null = null;
export function planetGL(): PlanetGL {
  if (!shared) shared = new PlanetGL();
  return shared;
}
