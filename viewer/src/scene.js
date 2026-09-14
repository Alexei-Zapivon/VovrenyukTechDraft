/**
 * 3D-вьюер модели в hero-блоке. Исходник; в браузер попадает сборка
 * assets/js/viewer.bundle.js (cd viewer && npm run build).
 *
 * Режимы: рендер, каркас, чертёж (ортографическая камера, только видимые рёбра).
 * Слайдер сечения: плоскость отсечения по высоте. Разборка убрана: на цельном теле она
 * выглядит как раздувание; вернётся, когда появится модель из отдельных деталей.
 * Кнопки видов: спереди, сверху, слева, изометрия.
 * Рендер идёт только пока панель видна на экране и вкладка активна.
 */
import {
    Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer, SRGBColorSpace,
    HemisphereLight, DirectionalLight, Group, Mesh, MeshStandardMaterial, MeshBasicMaterial,
    LineSegments, LineBasicMaterial, EdgesGeometry, Box3, Vector3, Plane, DoubleSide, MathUtils,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MODEL_URL = '/models/model.glb';
const MODEL_ROTATION_X = -Math.PI / 2;   // STL был с осью Z вверх, в three.js вверх смотрит Y
const BLUEPRINT = 0x143a7c;              // цвет панели, им закрашиваем невидимые рёбра в режиме чертежа
const EDGE_ANGLE = 28;                   // порог угла между гранями, чтобы ребро попало на чертёж
const VIEWS = {
    front: new Vector3(0, 0, 1),
    top: new Vector3(0, 1, 0.0001),      // чуть смещено, чтобы камера не совпала с осью «вверх»
    left: new Vector3(-1, 0, 0),
    iso: new Vector3(1, 0.8, 1),
};

export function initViewer(opts = {}) {
    const wrap = document.getElementById('modelWrap');
    const canvas = document.getElementById('modelCanvas');
    if (!wrap || !canvas) return null;

    const $ = id => document.getElementById(id);
    const ui = {
        status: $('viewerStatus'),
        statusText: $('viewerStatusText'),
        section: $('section'),
        sectionValue: $('sectionValue'),
        modes: { solid: $('viewSolid'), wire: $('viewWire'), draw: $('viewDraw') },
        views: Array.from(document.querySelectorAll('[data-view]')),
        dims: $('viewerDims'),
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- рендерер, камеры, свет ---------- */
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.localClippingEnabled = true;

    const scene = new Scene();
    const persp = new PerspectiveCamera(42, 1, 0.1, 100);
    const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    let camera = persp;
    let orthoHalf = 1;

    scene.add(new HemisphereLight(0xffffff, 0x1b2e5a, 1.1));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new DirectionalLight(0xbcd0ff, 0.6);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const controlsP = new OrbitControls(persp, canvas);
    const controlsO = new OrbitControls(ortho, canvas);
    for (const c of [controlsP, controlsO]) {
        c.enableDamping = true;
        c.dampingFactor = 0.08;
        c.enablePan = false;
        c.addEventListener('start', () => { controlsP.autoRotate = false; });
    }
    controlsP.autoRotate = !reducedMotion;
    controlsP.autoRotateSpeed = 0.9;
    controlsO.enabled = false;

    /* ---------- материалы ---------- */
    const clipPlane = new Plane(new Vector3(0, -1, 0), 1e6);   // всё, что выше constant, отсекается
    const solidMat = new MeshStandardMaterial({
        color: 0xb4c7ec, metalness: 0.5, roughness: 0.4, side: DoubleSide, clippingPlanes: [clipPlane],
    });
    const occluderMat = new MeshBasicMaterial({
        color: BLUEPRINT, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: [clipPlane],
    });
    const edgeMat = new LineBasicMaterial({ color: 0xffffff, clippingPlanes: [clipPlane] });

    /* ---------- состояние ---------- */
    const group = new Group();
    scene.add(group);
    const state = {
        mesh: null, occluder: null, edges: null,
        mode: 'solid', radius: 1, dist: 3, minY: -1, maxY: 1, loaded: false,
    };

    function setStatus(text, isError = false) {
        if (!ui.status) return;
        if (ui.statusText) ui.statusText.textContent = text || '';
        else ui.status.textContent = text || '';
        ui.status.classList.toggle('is-error', isError);
        ui.status.hidden = !text;
    }

    /* ---------- размеры ---------- */
    function resize() {
        const r = wrap.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        renderer.setSize(w, h, false);
        persp.aspect = w / h;
        persp.updateProjectionMatrix();
        ortho.left = -orthoHalf * persp.aspect;
        ortho.right = orthoHalf * persp.aspect;
        ortho.top = orthoHalf;
        ortho.bottom = -orthoHalf;
        ortho.updateProjectionMatrix();
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(wrap);
    else window.addEventListener('resize', resize);
    resize();

    /* ---------- цикл рендера: только когда панель на экране и вкладка активна ---------- */
    let visible = true;
    let running = false;
    function frame() {
        if (!visible || document.hidden) { running = false; return; }
        (camera === persp ? controlsP : controlsO).update();
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
    }
    function start() {
        if (running) return;
        running = true;
        requestAnimationFrame(frame);
    }
    if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver(entries => {
            visible = entries[0].isIntersecting;
            if (visible) start();
        }, { threshold: 0.02 }).observe(wrap);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) start(); });
    // сторож: если цикл остановился, а панель видна, перезапускаем (start() дёшев, когда цикл уже идёт)
    setInterval(() => { if (visible && !document.hidden) start(); }, 1000);
    start();

    /* ---------- камеры ---------- */
    function fitCameras() {
        const fov = MathUtils.degToRad(persp.fov);
        state.dist = (state.radius / Math.sin(fov / 2)) * 1.05;
        persp.near = state.dist / 50;
        persp.far = state.dist * 20;
        persp.updateProjectionMatrix();
        controlsP.minDistance = state.radius * 1.3;
        controlsP.maxDistance = state.dist * 2.5;
        orthoHalf = state.radius * 1.12;
        ortho.near = state.dist / 50;
        ortho.far = state.dist * 20;
        controlsO.minZoom = 0.6;
        controlsO.maxZoom = 3;
        resize();
        setView('iso', persp);
        setView('front', ortho);
    }

    function setView(name, cam = camera) {
        const dir = VIEWS[name] || VIEWS.iso;
        cam.position.copy(dir).normalize().multiplyScalar(state.dist);
        cam.lookAt(0, 0, 0);
        const c = cam === persp ? controlsP : controlsO;
        c.target.set(0, 0, 0);
        c.update();
        if (cam === ortho) { ortho.zoom = 1; ortho.updateProjectionMatrix(); }
        controlsP.autoRotate = false;
        ui.views.forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
    }

    function useCamera(cam) {
        camera = cam;
        controlsP.enabled = cam === persp;
        controlsO.enabled = cam === ortho;
    }

    /* ---------- режимы ---------- */
    function ensureEdges() {
        if (state.edges || !state.mesh) return;
        const { mesh } = state;
        const edges = new LineSegments(new EdgesGeometry(mesh.geometry, EDGE_ANGLE), edgeMat);
        const occluder = new Mesh(mesh.geometry, occluderMat);
        for (const o of [edges, occluder]) {
            o.position.copy(mesh.position);
            o.quaternion.copy(mesh.quaternion);
            o.scale.copy(mesh.scale);
            mesh.parent.add(o);
        }
        state.edges = edges;
        state.occluder = occluder;
    }

    function setMode(mode) {
        state.mode = mode;
        const draw = mode === 'draw';
        solidMat.wireframe = mode === 'wire';
        if (draw) ensureEdges();
        if (state.mesh) state.mesh.visible = !draw;
        if (state.edges) state.edges.visible = draw;
        if (state.occluder) state.occluder.visible = draw;
        useCamera(draw ? ortho : persp);
        if (draw) setView('front', ortho);
        Object.entries(ui.modes).forEach(([k, b]) => b && b.classList.toggle('is-active', k === mode));
        wrap.classList.toggle('is-draw', draw);
        if (ui.dims) ui.dims.hidden = !draw || !state.loaded;
    }

    function setSection(pct) {
        if (ui.sectionValue) ui.sectionValue.textContent = `${Math.round(pct)}%`;
        const h = state.maxY - state.minY;
        clipPlane.constant = state.loaded ? state.maxY - (pct / 100) * h * 0.98 + h * 0.001 : 1e6;
    }

    /* ---------- загрузка модели ---------- */
    function onModel(gltf) {
        let mesh = null;
        gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh) { setStatus('В модели нет геометрии'); return; }
        mesh.material = solidMat;
        if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();

        gltf.scene.rotation.x = MODEL_ROTATION_X;
        group.add(gltf.scene);
        group.updateMatrixWorld(true);
        const box = new Box3().setFromObject(gltf.scene);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        gltf.scene.position.sub(center);
        group.updateMatrixWorld(true);

        state.mesh = mesh;
        state.radius = size.length() / 2;
        state.minY = -size.y / 2;
        state.maxY = size.y / 2;
        state.loaded = true;
        fitCameras();
        setSection(Number(ui.section ? ui.section.value : 0));
        if (ui.dims) {
            const mm = v => Math.round(v);
            ui.dims.textContent = `Габариты ${mm(size.z)} × ${mm(size.x)} × ${mm(size.y)} мм`;
            ui.dims.hidden = state.mode !== 'draw';
        }
        setStatus('');
        wrap.classList.add('is-ready');
    }

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const onError = err => { console.warn('viewer: model load failed', err); setStatus('Не удалось загрузить модель', true); };
    const progress = (loaded, total) => setStatus(total ? `Загрузка модели ${Math.round((loaded / total) * 100)}%` : 'Загрузка модели');

    // main.js начинает качать модель одновременно с кодом вьюера и передаёт сюда промис ответа
    async function readWithProgress(resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const total = Number(resp.headers.get('content-length')) || 0;
        if (!resp.body || !total) { progress(0, 0); return resp.arrayBuffer(); }
        const reader = resp.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            got += value.length;
            progress(got, total);
        }
        const buf = new Uint8Array(got);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        return buf.buffer;
    }

    setStatus('Загрузка модели');
    if (opts.model) {
        Promise.resolve(opts.model)
            .then(readWithProgress)
            .then(buf => loader.parse(buf, MODEL_URL.replace(/[^/]+$/, ''), onModel, onError))
            .catch(onError);
    } else {
        loader.load(MODEL_URL, onModel, xhr => progress(xhr.loaded, xhr.total), onError);
    }

    /* ---------- события ---------- */
    ui.section?.addEventListener('input', e => setSection(Number(e.target.value)));
    ui.modes.solid?.addEventListener('click', () => setMode('solid'));
    ui.modes.wire?.addEventListener('click', () => setMode('wire'));
    ui.modes.draw?.addEventListener('click', () => setMode('draw'));
    ui.views.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    setMode('solid');

    return { setMode, setView, setSection };
}
