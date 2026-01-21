import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 這支就是你上傳的 loader（確保與 index.html 同層）
import { VOXLoader, VOXMesh } from './VOXLoader_mine_2.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);
camera.position.set(80, 60, 80);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 18, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Helpers
scene.add(new THREE.GridHelper(200, 20, 0x334155, 0x1f2937));
scene.add(new THREE.AxesHelper(30));

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(80, 120, 40);
dir.castShadow = false;
scene.add(dir);

const rim = new THREE.DirectionalLight(0xffffff, 0.6);
rim.position.set(-60, 40, -80);
scene.add(rim);

// A group to hold John
const johnGroup = new THREE.Group();
johnGroup.name = 'John';
scene.add(johnGroup);

// Load John.vox
const voxLoader = new VOXLoader();

// 如果 John.vox 不在同層，改這行：voxLoader.setPath('./assets/');
voxLoader.load(
  './John.vox',
  (chunks) => {
    // chunks 是 VOXLoader.parse() 回傳的 array（每個 chunk 一個 model/part）
    // 目前 John 是單體：通常會只有 1 個 chunk；但多個也照樣能顯示
    johnGroup.clear();

    const partMeshes = chunks.map((chunk, idx) => {
      const m = new VOXMesh(chunk);
      m.name = chunk.name || `part_${idx}`;
      johnGroup.add(m);
      return m;
    });

    // 讓模型「置中 + 合理大小」：用 bounding box 自動對齊
    const box = new THREE.Box3().setFromObject(johnGroup);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // 把 group 平移到中心 (0,0,0)
    johnGroup.position.sub(center);

    // 讓腳踩地：把底部移到 y=0
    const box2 = new THREE.Box3().setFromObject(johnGroup);
    johnGroup.position.y -= box2.min.y;

    // 自動縮放：讓最大邊長落在 ~60 單位左右（你可自己調）
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const target = 60;
    const s = target / maxDim;
    johnGroup.scale.setScalar(s);

    // 重算一次 bbox，讓鏡頭 target 更準
    const box3 = new THREE.Box3().setFromObject(johnGroup);
    const c3 = new THREE.Vector3();
    box3.getCenter(c3);
    controls.target.copy(c3);
    controls.update();

    console.log('VOX loaded:', chunks);
    console.log('Parts:', partMeshes.map(p => p.name));
  },
  (evt) => {
    // progress (optional)
    // console.log('loading...', evt);
  },
  (err) => {
    console.error('Failed to load John.vox', err);
    alert('載入 John.vox 失敗：請確認檔案路徑與伺服器是否正常（不能用 file:// 直接開）');
  }
);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
