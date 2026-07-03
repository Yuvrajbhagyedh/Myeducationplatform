/* ================= YK Face ID lock ================= */
(function () {
  const lock = document.getElementById('lock');
  const ring = document.getElementById('faceRing');
  const cam = document.getElementById('camVideo');
  const tick = document.getElementById('tick');
  const status = document.getElementById('lockStatus');
  const enrollBtn = document.getElementById('enrollBtn');
  const retryBtn = document.getElementById('lockRetry');

  let stream = null;
  let stopped = false;

  document.body.style.overflow = 'hidden'; // no scrollbar behind the lock screen

  const OPTS = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

  function say(msg) { status.textContent = msg; }

  function fail(msg) {
    ring.classList.remove('scanning');
    say(msg + ' — if you are locked out, delete E:\\LearnHub\\data\\face.json and reload.');
    retryBtn.classList.remove('hidden');
  }

  retryBtn.onclick = () => { retryBtn.classList.add('hidden'); start(); };

  async function loadModels() {
    say('Loading face recognition…');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models')
    ]);
  }

  // prefer the laptop's HP webcam; never auto-pick phone/virtual cameras
  const GOOD_CAM = /hp|truevision|integrated|built-?in/i;
  const BAD_CAM = /samsung|s22|galaxy|phone|link|virtual|obs|droidcam|iriun|epoccam|ip camera/i;

  function chooseCam(cams) {
    return cams.find(c => GOOD_CAM.test(c.label))
        || cams.find(c => c.label && !BAD_CAM.test(c.label))
        || cams[0];
  }

  async function listCams() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  }

  async function openCamera() {
    say('Starting camera…');
    let picked = null;
    try {
      let cams = await listCams();
      if (cams.length && !cams.some(c => c.label)) {
        // labels are hidden until camera permission is granted once
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cams = await listCams();
        tmp.getTracks().forEach(t => t.stop());
      }
      if (cams.length) picked = chooseCam(cams);
    } catch (e) { if (e.name === 'NotAllowedError') throw e; }

    const base = { width: { ideal: 640 }, height: { ideal: 640 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: picked ? { deviceId: { exact: picked.deviceId }, ...base } : { facingMode: 'user', ...base },
        audio: false
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw e;
      // preferred camera busy/unplugged — fall back to any camera
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...base }, audio: false });
    }
    const label = stream.getVideoTracks()[0] ? stream.getVideoTracks()[0].label : '';
    if (label) say('Camera: ' + label);
    cam.srcObject = stream;
    await new Promise(r => { cam.onloadedmetadata = r; });
    await cam.play().catch(() => {});
  }

  function closeCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  async function descriptorOnce() {
    const det = await faceapi.detectSingleFace(cam, OPTS())
      .withFaceLandmarks().withFaceDescriptor();
    return det ? Array.from(det.descriptor) : null;
  }

  function unlock() {
    stopped = true;
    ring.classList.remove('scanning');
    ring.classList.add('success');
    tick.classList.remove('hidden');
    say('Welcome back, Yuvraj.');
    setTimeout(() => {
      lock.classList.add('unlocked');
      document.body.style.overflow = '';
      closeCamera();
    }, 1200);
  }

  /* ---------- enrollment (first time) ---------- */
  async function enroll() {
    enrollBtn.classList.add('hidden');
    ring.classList.add('scanning');
    const samples = [];
    say('Look straight at the circle (keep your spectacles on)…');
    let tries = 0;
    while (samples.length < 5 && tries < 40 && !stopped) {
      const d = await descriptorOnce();
      if (d) {
        samples.push(d);
        say(`Capturing your face… ${samples.length}/5`);
      }
      tries++;
      await new Promise(r => setTimeout(r, 450));
    }
    if (samples.length < 5) return fail('Could not capture your face clearly. More light helps.');
    const r = await fetch('/api/face/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descriptors: samples })
    }).then(x => x.json());
    if (!r.ok) return fail('Enrollment failed.');
    unlock();
  }

  /* ---------- recognition loop ---------- */
  async function recognize() {
    ring.classList.add('scanning');
    say('Looking for you…');
    let misses = 0;
    while (!stopped) {
      const d = await descriptorOnce();
      if (d) {
        const r = await fetch('/api/face/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descriptor: d })
        }).then(x => x.json());
        if (r.ok) return unlock();
        misses++;
        say(misses > 3 ? 'Face not matching. Come closer, face the light.' : 'Checking…');
      } else {
        say('Position your face inside the circle…');
      }
      await new Promise(r2 => setTimeout(r2, 500));
    }
  }

  /* ---------- boot ---------- */
  async function start() {
    stopped = false;
    try {
      if (typeof faceapi === 'undefined') return fail('Face library missing.');
      const st = await fetch('/api/face').then(x => x.json());
      await loadModels();
      await openCamera();
      if (!st.enrolled) {
        say('First time: register your face to lock this app to you.');
        enrollBtn.classList.remove('hidden');
        enrollBtn.onclick = enroll;
      } else {
        recognize();
      }
    } catch (e) {
      fail(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow the camera and retry.'
         : e.name === 'NotFoundError' ? 'No camera found on this device.'
         : 'Could not start Face ID (' + (e.message || e.name) + ')');
    }
  }

  start();
})();
