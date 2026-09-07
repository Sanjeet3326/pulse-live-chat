const VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uCalm;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
      total += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return total;
  }

  float mapScene(vec3 p) {
    float breathe = 0.04 * sin(uTime * 0.8);
    float sphere  = length(p) - (0.92 + breathe);
    float warp    = fbm(p * 1.5 + vec3(0.0, uTime * 0.12, uTime * 0.05));
    return (sphere + 0.30 * warp - 0.15) * 0.6;
  }

  vec3 surfaceNormal(vec3 p) {
    vec2 e = vec2(0.0025, 0.0);
    return normalize(vec3(
      mapScene(p + e.xyy) - mapScene(p - e.xyy),
      mapScene(p + e.yxy) - mapScene(p - e.yxy),
      mapScene(p + e.yyx) - mapScene(p - e.yyx)
    ));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);

    uv.x += 0.10;
    uv.y -= 0.02;

    float yaw   = uMouse.x * 0.6 + uTime * 0.05;
    float pitch = uMouse.y * 0.35;

    vec3 rayOrigin = vec3(sin(yaw) * 3.2, pitch * 2.0, cos(yaw) * 3.2);
    vec3 forward = normalize(-rayOrigin);
    vec3 right   = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up      = cross(forward, right);
    vec3 rayDir  = normalize(uv.x * right + uv.y * up + 1.6 * forward);

    float travelled = 0.0;
    bool  hit = false;

    for (int step = 0; step < 56; step++) {
      vec3 samplePoint = rayOrigin + rayDir * travelled;
      float distance = mapScene(samplePoint);

      if (distance < 0.0015) { hit = true; break; }
      travelled += distance;
      if (travelled > 8.0) break;
    }

    vec3 colour = mix(vec3(0.047, 0.031, 0.037),
                      vec3(0.098, 0.043, 0.043),
                      smoothstep(-1.0, 1.0, uv.y));

    colour += vec3(0.32, 0.11, 0.04) * exp(-2.2 * length(uv + vec2(0.6, 0.3)));

    if (hit) {
      vec3 position = rayOrigin + rayDir * travelled;
      vec3 normal   = surfaceNormal(position);

      vec3 keyLight  = normalize(vec3(0.8, 0.9, 0.4));
      vec3 rimLight  = normalize(vec3(-0.7, 0.2, -0.5));

      float key = max(dot(normal, keyLight), 0.0);
      float rim = max(dot(normal, rimLight), 0.0);
      float fresnel = pow(1.0 - max(dot(normal, -rayDir), 0.0), 2.5);

      vec3 coral = vec3(1.000, 0.420, 0.290);
      vec3 amber = vec3(1.000, 0.651, 0.169);
      vec3 gold  = vec3(1.000, 0.788, 0.290);
      vec3 deepRed = vec3(0.545, 0.106, 0.086);

      vec3 surface = amber * key * 0.95;
      surface += gold * rim * 0.60;
      surface += coral * fresnel * 1.25;
      surface += deepRed * 0.22;

      float veins = fbm(position * 2.6 + vec3(uTime * 0.25, 0.0, 0.0));
      surface += gold * smoothstep(0.52, 0.86, veins) * 0.55;

      colour = mix(colour, surface, 0.94);
    }

    colour *= mix(0.55, 1.0, uCalm);
    colour *= 1.0 - 0.35 * length(uv) * 0.5;
    colour += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) * 0.02;

    gl_FragColor = vec4(colour, 1.0);
  }
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[background] shader failed:", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

export function startBackground(canvas) {
  const gl =
    canvas.getContext("webgl", { antialias: false, alpha: false }) ||
    canvas.getContext("experimental-webgl");

  if (!gl) {
    canvas.remove();
    return { setCalm() {} };
  }

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

  if (!vertex || !fragment) {
    canvas.remove();
    return { setCalm() {} };
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[background] link failed:", gl.getProgramInfoLog(program));
    canvas.remove();
    return { setCalm() {} };
  }

  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );

  const aPosition = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, "uResolution");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uMouse = gl.getUniformLocation(program, "uMouse");
  const uCalm = gl.getUniformLocation(program, "uCalm");

  const RESOLUTION_SCALE = 0.6;

  function resize() {
    const width = Math.floor(window.innerWidth * RESOLUTION_SCALE);
    const height = Math.floor(window.innerHeight * RESOLUTION_SCALE);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  window.addEventListener("resize", resize);
  resize();

  let targetX = 0;
  let targetY = 0;
  let smoothX = 0;
  let smoothY = 0;

  window.addEventListener("pointermove", (event) => {
    targetX = (event.clientX / window.innerWidth) * 2 - 1;
    targetY = (event.clientY / window.innerHeight) * 2 - 1;
  });

  let calm = 1;
  let targetCalm = 1;
  const startedAt = performance.now();

  function draw() {
    smoothX += (targetX - smoothX) * 0.045;
    smoothY += (targetY - smoothY) * 0.045;
    calm += (targetCalm - calm) * 0.03;

    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, (performance.now() - startedAt) / 1000);
    gl.uniform2f(uMouse, smoothX, smoothY);
    gl.uniform1f(uCalm, calm);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  draw();

  function frame() {
    if (!document.hidden) draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return {
    setCalm(value) {
      targetCalm = value;
    },
  };
}
