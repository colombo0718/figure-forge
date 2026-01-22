// main.js — FF 最小可用編輯器骨架（精簡版、中文註解、顏色全用 0xRRGGBB）
//
// 功能：
// - 預設載入 ./John.vox
// - O：開啟本機 .vox
// - W/E/R：移動/旋轉/縮放（TransformControls）
// - Esc：取消選取
// - H / ?：顯示/隱藏左上角說明
// - 左鍵點模型：選取部件（以 AssetRoot 直接子節點為一個「部件」）
// - 選取效果：外框描邊(OutlinePass) + 微提亮(材質 emissive / color)
//
// 依賴：
// - index.html 使用 importmap 提供 three 與 three/addons
// - 同層：VOXLoader_mine_2.js、John.vox(可選)

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";

import { VOXLoader, VOXMesh } from "./VOXLoader_mine_2.js";

// -------------------------
// 基本設定
// -------------------------
const DEFAULT_VOX_URL = "./John.vox";
const TARGET_SIZE = 60; // 模型最大邊縮放到約 60

// -------------------------
// 顏色：全部直接用 0xRRGGBB（不做任何轉換）
// -------------------------
const COLOR = {
  // 這是你一開始驗證過「網格看得到」的搭配
  bg: 0x0b0e14,
  gridMajor: 0xaaaaaa,
  gridMinor: 0x888888,

  // 外框藍：用兩兩重複較好讀
  outline: 0x3388ff,
};

// -------------------------
// Renderer / Scene / Camera
// -------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLOR.bg);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);
camera.position.set(80, 60, 80);

// -------------------------
// OrbitControls（旋轉/平移/縮放視角）
// -------------------------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 18, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.update();

// -------------------------
// 網格 + 座標軸（沿用你最早那套可讀性）
// -------------------------
scene.add(new THREE.GridHelper(200, 20, COLOR.gridMajor, COLOR.gridMinor));
scene.add(new THREE.AxesHelper(30));

// -------------------------
// 燈光（沿用你最早那套）
// -------------------------
scene.add(new THREE.AmbientLight(0xffffff, 1));

const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(80, 120, 40);
scene.add(dir);

const rim = new THREE.DirectionalLight(0xffffff, 0.6);
rim.position.set(-60, 40, -80);
scene.add(rim);

// -------------------------
// 後處理：Outline（外框描邊）
// -------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const outline = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
outline.edgeStrength = 3.0;
outline.edgeThickness = 1.0;
outline.visibleEdgeColor.setHex(COLOR.outline);
outline.hiddenEdgeColor.setHex(COLOR.outline);
composer.addPass(outline);

// -------------------------
// TransformControls（W/E/R 移動/旋轉/縮放）
// -------------------------
const gizmo = new TransformControls(camera, renderer.domElement);

// 移動步進：0.1
gizmo.setTranslationSnap(0.1);
// 旋轉步進：5度（注意是「弧度」）
gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
// 縮放步進：0.1
gizmo.setScaleSnap(0.1);

scene.add(gizmo);

// 拖曳 gizmo 時，暫停 orbit，避免互搶
gizmo.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value;
});

// -------------------------
// 模型根節點：所有載入的 VOX 部件都放在這下面
// -------------------------
const assetRoot = new THREE.Group();
assetRoot.name = "AssetRoot";
scene.add(assetRoot);

// -------------------------
// Help 面板（簡單、可開關）
// -------------------------


function setLoadedName(name) {
  const el = document.getElementById("loadedName");
  if (el) el.textContent = name || "";
}
function toggleHelp() {
    console.log(help)
  help.style.display = help.style.display === "none" ? "block" : "none";
}

// -------------------------
// 檔案選擇器：按 O 叫出來
// -------------------------
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".vox";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

// -------------------------
// 選取：Raycaster 點擊選取 + 高亮（描邊 + 微提亮）
// -------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selected = null;

// 用 WeakMap 記錄「被提亮前」材質狀態，方便還原
const backup = new WeakMap();

// 將點到的 mesh 往上找，直到它的 parent 是 assetRoot（把它當作一個部件）
function partRoot(obj) {
  let o = obj;
  while (o && o.parent && o.parent !== assetRoot) o = o.parent;
  return o || obj;
}

// 微提亮：優先用 emissive（不破壞原本顏色）；沒有就用 color 乘一點點
function setBright(obj, on) {
  if (!obj) return;

  obj.traverse((n) => {
    if (!n.isMesh || !n.material) return;

    const mats = Array.isArray(n.material) ? n.material : [n.material];

    for (const m of mats) {
      if (!backup.has(m)) {
        backup.set(m, {
          color: m.color ? m.color.clone() : null,
          emissive: m.emissive ? m.emissive.clone() : null,
          emissiveIntensity:
            typeof m.emissiveIntensity === "number" ? m.emissiveIntensity : null,
        });
      }

      const b = backup.get(m);

      if (on) {
        if (m.emissive) {
          // 淡淡加亮，不要像霓虹燈
          m.emissive.setRGB(0.10, 0.12, 0.18);
          if (typeof m.emissiveIntensity === "number") m.emissiveIntensity = 1.0;
        } else if (m.color && b.color) {
          m.color.copy(b.color).multiplyScalar(1.12);
        }
      } else {
        if (b.color && m.color) m.color.copy(b.color);
        if (b.emissive && m.emissive) m.emissive.copy(b.emissive);
        if (
          b.emissiveIntensity !== null &&
          typeof m.emissiveIntensity === "number"
        ) {
          m.emissiveIntensity = b.emissiveIntensity;
        }
      }
    }
  });
}

function clearSelection() {
  if (selected) setBright(selected, false);
  selected = null;
  outline.selectedObjects = [];
  gizmo.detach();
}

function select(obj) {
  if (selected === obj) return;

  if (selected) setBright(selected, false);

  selected = obj || null;

  if (selected) {
    setBright(selected, true);
    outline.selectedObjects = [selected];
    gizmo.attach(selected);
  } else {
    outline.selectedObjects = [];
    gizmo.detach();
  }
}

// 左鍵點擊選取
renderer.domElement.addEventListener("pointerdown", (e) => {
    // 如果正在點 TransformControls 的 gizmo，就不要觸發「點空白=取消選取」
  if (gizmo.dragging) return; // 正在拖曳時直接忽略（最安全）
  if (gizmo.axis !== null) return; // 滑過 gizmo 時 axis 會變成 'X'/'Y'/'Z' 等

  if (e.button !== 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

  raycaster.setFromCamera(mouse, camera);

  // 只對 assetRoot 底下物件做碰撞測試
  const hits = raycaster.intersectObjects(assetRoot.children, true);

  if (hits.length) select(partRoot(hits[0].object));
  else select(null);
});

// -------------------------
// VOX 載入：URL / 本機檔
// -------------------------
const voxLoader = new VOXLoader();

// 置中、踩地、縮放，並更新 orbit target
function fitToGroundAndScale(obj3d) {
  // reset，避免多次載入累積偏移
  obj3d.position.set(0, 0, 0);
  obj3d.rotation.set(0, 0, 0);
  obj3d.scale.set(1, 1, 1);

  // bounding box：拿到中心與尺寸
  const box = new THREE.Box3().setFromObject(obj3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // 置中到 (0,0,0)
  obj3d.position.sub(center);

  // 踩地（底部對齊 y=0）
  const box2 = new THREE.Box3().setFromObject(obj3d);
  obj3d.position.y -= box2.min.y;

  // 自動縮放：最大邊長縮到 TARGET_SIZE
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = TARGET_SIZE / maxDim;
  obj3d.scale.setScalar(s);

  // 更新 orbit target 到模型中心
  const box3 = new THREE.Box3().setFromObject(obj3d);
  const c3 = new THREE.Vector3();
  box3.getCenter(c3);
  orbit.target.copy(c3);
  orbit.update();
}

// chunks => VOXMesh，放進 assetRoot
function loadChunks(chunks, name) {
  clearSelection();
  assetRoot.clear();

  chunks.forEach((chunk, i) => {
    const m = new VOXMesh(chunk);
    m.name = chunk.name || `part_${i}`;
    assetRoot.add(m);
  });

  fitToGroundAndScale(assetRoot);
  setLoadedName(name || "Loaded.vox");
}

function loadVoxUrl(url, name) {
  voxLoader.load(
    url,
    (chunks) => loadChunks(chunks, name || url.split("/").pop()),
    undefined,
    (err) => {
      console.error(err);
      alert("載入 VOX 失敗：請確認檔案路徑與伺服器是否正常（不能用 file:// 直接開）");
    }
  );
}

async function loadVoxFile(file) {
  const buf = await file.arrayBuffer();
  const chunks = voxLoader.parse(buf);
  loadChunks(chunks, file.name);
}

// 預設載入 John.vox
loadVoxUrl(DEFAULT_VOX_URL, "John.vox");

// 本機開檔
fileInput.addEventListener("change", async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  await loadVoxFile(f);
  fileInput.value = "";
});

// -------------------------
// 快捷鍵（先用鍵盤，不做視覺按鈕）
// -------------------------
window.addEventListener("keydown", (e) => {
  // 避免在輸入框打字時誤觸
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const k = e.key;

  if (k === "w" || k === "W") gizmo.setMode("translate");
  if (k === "e" || k === "E") gizmo.setMode("rotate");
  if (k === "r" || k === "R") gizmo.setMode("scale");

  if (k === "Escape") clearSelection();

  if (k === "o" || k === "O") fileInput.click();

  if (k === "h" || k === "H" || k === "?") toggleHelp();
});

// -------------------------
// Render loop（用 composer 才能看到 Outline）
// -------------------------
function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  composer.render();
}
animate();

// -------------------------
// Resize
// -------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  outline.setSize(window.innerWidth, window.innerHeight);
});
