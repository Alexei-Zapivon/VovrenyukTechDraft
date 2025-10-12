import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export function initThree() {
    const wrap = document.getElementById("modelWrap");
    const canvas = document.getElementById("modelCanvas");
    const slider = document.getElementById("explode");
    const sliderValue = document.getElementById("explodeValue");
    const btnSolid = document.getElementById("viewSolid");
    const btnWire = document.getElementById("viewWire");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    camera.position.set(0, 1.6, 3.2);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(4, 5, 6);
    scene.add(dir);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 6;

    function resize() {
        const r = wrap.getBoundingClientRect();
        const w = Math.max(1, r.width), h = Math.max(1, r.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    }
    resize();
    addEventListener("resize", resize);

    const group = new THREE.Group();
    scene.add(group);

    const loader = new STLLoader();
    const MATERIAL = new THREE.MeshStandardMaterial({ color: 0x9fb6ff, metalness: 0.7, roughness: 0.3 });
    let explodeScale = 1;

    MATERIAL.onBeforeCompile = (shader) => {
        shader.uniforms.uExplode = { value: 0.0 };
        MATERIAL.userData.shader = shader;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uExplode;")
            .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        transformed += normalize(objectNormal) * uExplode;
      `);
    };

    loader.load("/models/model.stl", (geometry) => {
        geometry.computeVertexNormals();
        geometry.center();

        const mesh = new THREE.Mesh(geometry, MATERIAL);
        mesh.rotation.set(-Math.PI / 2, 0, 0);
        group.add(mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const target = 2.0;
        mesh.scale.setScalar(target / maxDim);
        explodeScale = target * 1.5;

        if (slider) setExplode(Number(slider.value || 0));
    });

    function setExplode(pct) {
        if (sliderValue) sliderValue.textContent = `${Math.round(pct)}%`;
        const shader = MATERIAL.userData?.shader;
        if (shader) shader.uniforms.uExplode.value = (pct / 100) * explodeScale;
    }

    slider?.addEventListener("input", (e) => setExplode(Number(e.target.value)));

    function setMode(mode) {
        const isWire = mode === "wire";
        MATERIAL.wireframe = isWire;
        btnWire?.classList.toggle("is-active", isWire);
        btnSolid?.classList.toggle("is-active", !isWire);
    }
    btnWire?.addEventListener("click", () => setMode("wire"));
    btnSolid?.addEventListener("click", () => setMode("solid"));
    setMode("solid");

    (function animate() {
        requestAnimationFrame(animate);
        group.rotation.y += 0.005;
        controls.update();
        renderer.render(scene, camera);
    })();
}
