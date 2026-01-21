import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

// 你的 VOX loader
import { VOXLoader, VOXMesh } from './VOXLoader_mine_2.js';

/* ------------------------------
  Renderer / Scene / Camera
------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 2000);
camera.position.set(80, 60, 80);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 18, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

/* ------------------------------
  Postprocessing: Outline
------------------------------ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outlinePass.edgeStrength = 3.2;
outlinePass.edgeThickness = 1.0;
outlinePass.visibleEdgeColor.set('#3b82f6'); // blue
outlinePass.hiddenEdgeColor.set('#3b82f6');
composer.addPass(outlinePass);

/* ------------------------------
  TransformControls
------------------------------ */
const tControls = new TransformControls(camera, renderer.domElement);
scene.add(tControls);

tControls.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
});

/* ------------------------------
  Helpers / Lights
------------------------------ */
scene.add(new THREE.GridHelper(200, 20, 0x334155, 0x1f2937));
scene.add(new THREE.AxesHelper(30));

// Lights (editor-friendly)
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

// 天空光：讓陰影面也不會黑成一片（非常關鍵）
const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.85);
hemi.position.set(0, 200, 0);
scene.add(hemi);

// 主光：從上前方打下來
const key = new THREE.DirectionalLight(0xffffff, 1.25);
key.position.set(80, 140, 120);
scene.add(key);

// 補光：從另一側把暗面提亮
const fill = new THREE.DirectionalLight(0xffffff, 0.55);
fill.position.set(-120, 60, -80);
scene.add(fill);

/* ------------------------------
  Model root group
------------------------------ */
const johnGroup = new THREE.Group();
johnGroup.name = 'AssetRoot';
scene.add(johnGroup);

/* ------------------------------
  Selection: outline + slight brighten
------------------------------ */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let selectedPartRoot = null;

// 用 WeakMap 存材質原狀，避免重複乘亮度造成越來越亮
const matOrig = new WeakMap(); // material -> { color, emissive, emissiveIntensity }

function getPartRoot(obj) {
  // 把點到的 mesh 往上找，直到它的 parent 是 johnGroup（= 一個部件根）
  let o = obj;
  while (o && o.parent && o.parent !== johnGroup) o = o.parent;
  return o || obj;
}

function setBright(obj, on) {
  obj.traverse((n) => {
    if (!n.isMesh || !n.material) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];

    for (const m of mats) {
      if (!matOrig.has(m)) {
        matOrig.set(m, {
          color: m.color ? m.color.clone() : null,
          emissive: m.emissive ? m.emissive.clone() : null,
          emissiveIntensity: typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : null
        });
      }

      const orig = matOrig.get(m);

      if (on) {
        // 優先用 emissive（比較像“被選取發亮”，不太破壞原色）
        if (m.emissive) {
          m.emissive.setRGB(0.18, 0.22, 0.35);
          if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = 1.0;
        } else if (m.color) {
          m.color.copy(orig.color).multiplyScalar(1.12);
        }
      } else {
        // 還原
        if (orig.emissive && m.emissive) m.emissive.copy(orig.emissive);
        if (orig.emissiveIntensity !== null && typeof m.emissiveIntensity === 'number') {
          m.emissiveIntensity = orig.emissiveIntensity;
        }
        if (orig.color && m.color) m.color.copy(orig.color);
      }
    }
  });
}

function clearSelection() {
  if (selectedPartRoot) setBright(selectedPartRoot, false);
  selectedPartRoot = null;
  outlinePass.selectedObjects = [];
  tControls.detach();
}

function setSelection(partRoot) {
  if (selectedPartRoot === partRoot) return;

  if (selectedPartRoot) setBright(selectedPartRoot, false);

  selectedPartRoot = partRoot || null;

  if (selectedPartRoot) {
    setBright(selectedPartRoot, true);
    outlinePass.selectedObjects = [selectedPartRoot];
    tControls.attach(selectedPartRoot);
  } else {
    outlinePass.selectedObjects = [];
    tControls.detach();
  }
}

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObjects(johnGroup.children, true);
  if (hits.length > 0) {
    const partRoot = getPartRoot(hits[0].object);
    setSelection(partRoot);
  } else {
    setSelection(null);
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  // 左鍵才選取，避免右鍵 pan 時亂選
  if (e.button !== 0) return;
  // 拖 gizmo 的時候別做 pick（避免抖）
  // TransformControls 沒有公開 dragging flag，這裡用 enabled/controls.enabled 的狀態側面避免干擾
  pick(e);
});

/* ------------------------------
  VOX loading (URL + File)
------------------------------ */
const voxLoader = new VOXLoader();

function fitAndFocus(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  object3d.position.sub(center);

  // 踩地
  const box2 = new THREE.Box3().setFromObject(object3d);
  object3d.position.y -= box2.min.y;

  // 自動縮放（可改 target）
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const target = 60;
  const s = target / maxDim;
  object3d.scale.setScalar(s);

  // 更新 target
  const box3 = new THREE.Box3().setFromObject(object3d);
  const c3 = new THREE.Vector3();
  box3.getCenter(c3);
  controls.target.copy(c3);
  controls.update();
}

function loadFromChunks(chunks, displayName = 'Loaded.vox') {
  clearSelection();

  johnGroup.clear();
  johnGroup.name = displayName;

  chunks.forEach((chunk, idx) => {
    const m = new VOXMesh(chunk);
    m.name = chunk.name || `part_${idx}`;
    johnGroup.add(m);
  });

  fitAndFocus(johnGroup);

  const label = document.getElementById('loadedName');
  if (label) label.textContent = displayName;
}

function loadVoxFromUrl(url, displayName) {
  voxLoader.load(
    url,
    (chunks) => loadFromChunks(chunks, displayName || url.split('/').pop()),
    undefined,
    (err) => {
      console.error('Failed to load VOX:', err);
      alert('載入 VOX 失敗：請確認路徑與伺服器狀態');
    }
  );
}

async function loadVoxFromFile(file) {
  const buf = await file.arrayBuffer();
  const chunks = voxLoader.parse(buf);
  loadFromChunks(chunks, file.name);
}

// 預設載入 John.vox
loadVoxFromUrl('./John.vox', 'John.vox');

/* ------------------------------
  Help toggle + Shortcuts
------------------------------ */
const helpEl = document.getElementById('help');
const voxFileEl = document.getElementById('voxFile');

function toggleHelp() {
  if (!helpEl) return;
  helpEl.classList.toggle('collapsed');
}

window.addEventListener('keydown', (e) => {
  // 如果你之後加 input UI，這段可以避免在輸入時觸發快捷鍵
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
  if (isTyping) return;

  if (e.key === 'w' || e.key === 'W') tControls.setMode('translate');
  if (e.key === 'e' || e.key === 'E') tControls.setMode('rotate');
  if (e.key === 'r' || e.key === 'R') tControls.setMode('scale');

  if (e.key === 'Escape') clearSelection();

  // Help
  if (e.key === 'h' || e.key === 'H' || e.key === '?') toggleHelp();

  // Open VOX
  if (e.key === 'o' || e.key === 'O') {
    voxFileEl?.click();
  }
});

voxFileEl?.addEventListener('change', async () => {
  const file = voxFileEl.files && voxFileEl.files[0];
  if (!file) return;
  await loadVoxFromFile(file);
  voxFileEl.value = ''; // 允許再次選同一檔
});

/* ------------------------------
  Render loop + Resize
------------------------------ */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  composer.render();
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  outlinePass.setSize(window.innerWidth, window.innerHeight);
});
