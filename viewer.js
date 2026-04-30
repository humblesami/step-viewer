import { loadSTEP } from "./cad/step-loader.js";
import { buildScene } from "./cad/geometry.js";

(function () {
  let scene, camera, renderer, occ;

  function animateStepFile() {
    requestAnimationFrame(animateStepFile);
    renderer.render(scene, camera);
  }

  async function initRenderer() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(100, 100, 100);

    renderer = new THREE.WebGLRenderer({ canvas: document.querySelector("canvas") });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const light = new THREE.AmbientLight(0xffffff, 1);
    scene.add(light);

    animateStepFile();

    occ = await occtimportjs();
  }

  document.getElementById("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];

    const cadModel = await loadSTEP(file, occ);

    const object3D = buildScene(cadModel);

    scene.add(object3D);
  });

  initRenderer();
})();

