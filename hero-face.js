/* Animate the original mascot in one layer, with continuous local deformation. */
(() => {
  'use strict';
  const image = document.querySelector('#hero-art .mascot');
  const art = document.getElementById('hero-art');
  if (!image || !art) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');

  function init() {
    if (!image.naturalWidth) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'mascot mascot-face';
    canvas.setAttribute('aria-hidden', 'true');
    // Keep texture filtering and page compositing in the same alpha convention.
    // Straight RGB in almost-transparent fur pixels produces bright fringes on iOS.
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return; // The original image always remains underneath.

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      uniform sampler2D u_image;
      uniform vec2 u_resolution;
      uniform vec4 u_fit;
      uniform vec2 u_gaze;
      uniform vec2 u_tongue;
      uniform float u_blink;
      varying vec2 v_uv;

      float eyeMask(vec2 p, vec2 center, vec2 radius) {
        return 1.0 - smoothstep(0.78, 1.0, length((p - center) / radius));
      }

      vec2 eyeSample(vec2 p, vec2 center) {
        vec2 horizontal = vec2(0.94, -0.342);
        vec2 vertical = vec2(0.342, 0.94);
        vec2 delta = p - center;
        vec2 local = vec2(dot(delta, horizontal), dot(delta, vertical));
        // Compress the existing eye between its own upper and lower lids.
        // Outside the aperture, bring in adjacent fur instead of painting a lid.
        float blink = u_blink * (1.0 - smoothstep(19.0, 32.0, abs(local.x)));
        float lidHeight = 23.0 * sqrt(max(0.08, 1.0 - local.x * local.x / 1024.0));
        float aperture = mix(lidHeight, 0.3, blink);
        float curve = blink * 3.0 * max(0.0, 1.0 - local.x * local.x / 1024.0);
        float y = abs(local.y - curve);
        float mapped = y < aperture ? y * lidHeight / aperture
          : lidHeight + (y - aperture) * (40.0 - lidHeight) / (40.0 - aperture);
        local.y = mix(local.y, sign(local.y - curve) * mapped, blink);
        vec2 samplePoint = center + horizontal * local.x + vertical * local.y;
        float iris = 1.0 - smoothstep(14.0, 27.0, length(samplePoint - center));
        return samplePoint - u_gaze * vec2(8.0, 5.5) * iris * (1.0 - blink);
      }

      void main() {
        vec2 uv = (v_uv * u_resolution - u_fit.xy) / u_fit.zw;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0);
          return;
        }
        // Coordinates refer to the original 778 x 1000 WebP, not to layout pixels.
        vec2 size = vec2(778.0, 1000.0);
        vec2 p = uv * size;
        float leftEye = eyeMask(p, vec2(322.0, 210.0), vec2(41.0, 42.0));
        float rightEye = eyeMask(p, vec2(420.0, 168.0), vec2(39.0, 40.0));
        float eyes = max(leftEye, rightEye);
        vec2 offset = vec2(0.0);
        if (leftEye > 0.0) offset = (p - eyeSample(p, vec2(322.0, 210.0))) * leftEye;
        if (rightEye > 0.0) offset = (p - eyeSample(p, vec2(420.0, 168.0))) * rightEye;

        // Anchor the root; the small bend increases toward the existing tongue tip.
        vec2 root = p - vec2(421.0, 287.0);
        vec2 axis = vec2(0.345, 0.939);
        vec2 across = vec2(0.939, -0.345);
        vec2 local = vec2(dot(root, across), dot(root, axis));
        float tongue = 1.0 - smoothstep(0.72, 1.0,
          length(vec2(local.x / 46.0, (local.y - 28.0) / 48.0)));
        float anchored = smoothstep(3.0, 42.0, local.y);
        offset += (axis * u_tongue.y + across * u_tongue.x) * tongue * anchored;

        // Render the entire source once. Fading the displacement (rather than the
        // patch alpha) avoids circular seams and double images over the source.
        vec4 original = texture2D(u_image, (p - offset) / size);
        if (eyes > 0.0 && u_blink > 0.75) {
          vec2 center = leftEye > rightEye ? vec2(322.0, 210.0) : vec2(420.0, 168.0);
          vec2 d = p - center;
          vec2 lid = vec2(dot(d, vec2(0.94, -0.342)), dot(d, vec2(0.342, 0.94)));
          float closed = (1.0 - smoothstep(0.80, 1.12, length(lid / vec2(27.0, 24.0))))
            * smoothstep(0.75, 0.98, u_blink);
          vec3 fur = texture2D(u_image, (p - vec2(0.342, 0.94) * 36.0) / size).rgb;
          float seam = 1.0 - smoothstep(0.6, 1.8, abs(lid.y - 3.0 * max(0.0, 1.0 - lid.x * lid.x / 729.0)));
          original.rgb = mix(original.rgb, fur * (1.0 - seam * 0.55), closed);
        }
        gl_FragColor = vec4(min(original.rgb, vec3(original.a)), original.a);
      }
    `;
    const shaders = [];
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
      shaders.push(shader);
      return shader;
    }
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) { shaders.forEach(s => gl.deleteShader(s)); return; }
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { shaders.forEach(s => gl.deleteShader(s)); gl.deleteProgram(program); return; }
    gl.useProgram(program);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); }
    catch { gl.deleteTexture(texture); gl.deleteBuffer(vertices); shaders.forEach(s => gl.deleteShader(s)); gl.deleteProgram(program); return; }
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    const uniforms = Object.fromEntries(['u_resolution','u_fit','u_gaze','u_tongue','u_blink'].map(name => [name, gl.getUniformLocation(program, name)]));
    image.after(canvas);
    // Match the original full-silhouette shadow, never a shadow around face patches.
    canvas.style.filter = getComputedStyle(image).filter;
    const sourceOpacity = image.style.getPropertyValue('opacity');
    const sourceOpacityPriority = image.style.getPropertyPriority('opacity');
    function showOriginal() {
      if (sourceOpacity) image.style.setProperty('opacity', sourceOpacity, sourceOpacityPriority);
      else image.style.removeProperty('opacity');
      canvas.hidden = true;
    }
    function showAnimation() {
      image.style.setProperty('opacity', '0', 'important');
      canvas.hidden = false;
    }
    // Keep the pre-existing entrance animation exactly in phase with the image.
    const entrance = image.getAnimations().find(a => a.animationName === 'mascot-enter');
    const overlayEntrance = canvas.getAnimations().find(a => a.animationName === 'mascot-enter');
    if (entrance && overlayEntrance) overlayEntrance.currentTime = entrance.currentTime;
    else if (!entrance) canvas.style.animation = 'none';

    let fit = { x: 0, y: 0, width: 0, height: 0 };
    function resize() {
      const width = image.clientWidth, height = image.clientHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      fit = { x: (width - image.naturalWidth * scale) / 2, y: height - image.naturalHeight * scale, width: image.naturalWidth * scale, height: image.naturalHeight * scale };
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform4f(uniforms.u_fit, fit.x, fit.y, fit.width, fit.height);
    }
    new ResizeObserver(resize).observe(image);
    resize();
    // Responsive sources can change after rotation or a window resize.
    image.addEventListener('load', () => {
      if (lost) return;
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); resize(); }
      catch { lost = true; showOriginal(); }
    });
    let targetX = 0, targetY = 0, gazeX = 0, gazeY = 0, lastTouch = -Infinity;
    let frame = 0, previous = 0, inView = true, lost = false, drawn = false;
    let nextBlink = performance.now() + 1800, blinkStart = -Infinity;
    const clamp = v => Math.max(-1, Math.min(1, v));
    function lookAt(event) {
      if (reduced.matches || !inView) return;
      const rect = image.getBoundingClientRect();
      const centerX = rect.left + fit.x + fit.width * (371 / 778);
      const centerY = rect.top + fit.y + fit.height * (189 / 1000);
      targetX = clamp((event.clientX - centerX) / Math.max(140, innerWidth * 0.35));
      targetY = clamp((event.clientY - centerY) / Math.max(100, innerHeight * 0.30));
      if (event.pointerType !== 'mouse') lastTouch = performance.now();
    }
    document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') lookAt(e); }, { passive: true });
    art.addEventListener('pointerdown', lookAt, { passive: true });
    art.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') lookAt(e); }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });

    function tick(now) {
      frame = 0;
      if (reduced.matches) { drawn = false; showOriginal(); return; }
      if (!inView || document.hidden || lost) return;
      if (now - previous >= 1000 / (coarse.matches ? 30 : 60)) {
        const dt = Math.min(now - previous, 100);
        previous = now;
        const seconds = now / 1000;
        if (coarse.matches && now - lastTouch > 1800) {
          targetX = Math.sin(seconds * 0.52) * 0.52;
          targetY = Math.sin(seconds * 0.37 + 0.6) * 0.25;
        }
        const ease = 1 - Math.exp(-dt / 140);
        gazeX += (targetX - gazeX) * ease;
        gazeY += (targetY - gazeY) * ease;
        gl.uniform2f(uniforms.u_gaze, gazeX, gazeY);
        if (now >= nextBlink) {
          blinkStart = now;
          nextBlink = now + 2900 + Math.random() * 2100;
        }
        const blinkAge = now - blinkStart;
        const blink = blinkAge < 110 ? Math.sin(blinkAge / 110 * Math.PI / 2)
          : blinkAge < 155 ? 1
          : blinkAge < 320 ? Math.cos((blinkAge - 155) / 165 * Math.PI / 2) : 0;
        gl.uniform1f(uniforms.u_blink, blink);
        const breath = Math.sin(seconds * 3.4) * (0.8 + Math.sin(seconds * 0.6) * 0.2);
        gl.uniform2f(uniforms.u_tongue, Math.sin(seconds * 2.1) * 2.0, breath * 10.0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!drawn) {
          if (gl.getError() !== gl.NO_ERROR) { lost = true; showOriginal(); return; }
          drawn = true;
          showAnimation();
        }
      }
      frame = requestAnimationFrame(tick);
    }
    function resume() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (reduced.matches) { drawn = false; showOriginal(); return; }
      if (!document.hidden && inView && !lost) { previous = 0; frame = requestAnimationFrame(tick); }
    }
    new IntersectionObserver(entries => { inView = entries[0].isIntersecting; resume(); }, { threshold: 0 }).observe(art);
    document.addEventListener('visibilitychange', resume);
    reduced.addEventListener('change', resume);
    canvas.addEventListener('webglcontextlost', () => { lost = true; cancelAnimationFrame(frame); showOriginal(); });
    resume();
  }
  // Let the original image paint before compiling shaders on slower phones.
  function prepare() {
    const decoded = image.decode ? image.decode() : Promise.resolve();
    decoded.then(() => requestAnimationFrame(() => requestAnimationFrame(init))).catch(() => {});
  }
  if (image.complete) prepare(); else image.addEventListener('load', prepare, { once: true });
})();
