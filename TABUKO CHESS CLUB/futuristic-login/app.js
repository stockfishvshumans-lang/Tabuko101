// Scene Setup
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02030a, 0.025);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 28); 

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

// Cinematic Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
scene.add(ambientLight);

// Rim light from back-left (Purple)
const rimLight1 = new THREE.SpotLight(0xd946ef, 25, 100, 0.6, 0.5, 2);
rimLight1.position.set(-15, 10, -15);
rimLight1.lookAt(0, 0, 0);
scene.add(rimLight1);

// Rim light from back-right (Cyan)
const rimLight2 = new THREE.SpotLight(0x0ea5e9, 25, 100, 0.6, 0.5, 2);
rimLight2.position.set(15, 10, -15);
rimLight2.lookAt(0, 0, 0);
scene.add(rimLight2);

// Fill light from bottom (Cyan/Purple underlighting)
const underLight = new THREE.PointLight(0x8b5cf6, 6, 40);
underLight.position.set(0, -6, 5);
scene.add(underLight);

// Key light front soft
const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
keyLight.position.set(0, 5, 15);
scene.add(keyLight);

// Floor & Holographic Chessboard Environment
const floorGeom = new THREE.PlaneGeometry(200, 200);
const floorMat = new THREE.MeshStandardMaterial({
    color: 0x010103,
    metalness: 0.9,
    roughness: 0.15, // Glossy reflective look
});
const floor = new THREE.Mesh(floorGeom, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -8;
scene.add(floor);

// Fragmented Grid Lines (Chessboard)
const gridHelper = new THREE.GridHelper(80, 40, 0x8b5cf6, 0x0ea5e9);
gridHelper.position.y = -7.95;
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.2;
scene.add(gridHelper);

// Futuristic Chess Monolith Geometry
function createKnightGeometry() {
    const geometries = [];
    const segments = 12; // Faceted crystal look
    
    const base = new THREE.CylinderGeometry(4, 4.5, 1, segments);
    base.translate(0, -7, 0); geometries.push(base);

    const ped = new THREE.CylinderGeometry(3.5, 4, 1.5, segments);
    ped.translate(0, -5.75, 0); geometries.push(ped);

    for(let i=0; i<12; i++) {
        const t = i / 11;
        const radius = 3.0 - t * 1.4;
        const slice = new THREE.CylinderGeometry(radius, radius + 0.1, 0.7, segments);
        slice.rotateX(Math.cos(t * Math.PI) * 0.2);
        slice.translate(0, -4.5 + t * 7, Math.sin(t * Math.PI) * 1.2);
        geometries.push(slice);
    }

    const head = new THREE.CylinderGeometry(1.8, 2.4, 5, segments);
    head.rotateX(Math.PI / 2 + 0.3); head.translate(0, 3, 2.5); geometries.push(head);
    
    const snout = new THREE.CylinderGeometry(1.4, 1.8, 4, segments);
    snout.rotateX(Math.PI / 2 + 0.3); snout.translate(0, 2.2, 6.0); geometries.push(snout);

    const mane = new THREE.BoxGeometry(1, 8, 3.5);
    mane.rotateX(-0.4); mane.translate(0, 1.5, -2.0); geometries.push(mane);

    const earL = new THREE.ConeGeometry(0.5, 2.5, 4); 
    earL.rotateX(-0.3); earL.rotateZ(0.2); earL.translate(-1.2, 6.0, 1.0); geometries.push(earL);

    const earR = new THREE.ConeGeometry(0.5, 2.5, 4);
    earR.rotateX(-0.3); earR.rotateZ(-0.2); earR.translate(1.2, 6.0, 1.0); geometries.push(earR);

    // Merge non-indexed to compute flat normals for faceted look
    let totalVertices = 0;
    geometries.forEach(g => {
        const nonIndexed = g.toNonIndexed();
        g.nonIndexedPos = nonIndexed.attributes.position.array;
        totalVertices += g.nonIndexedPos.length / 3;
    });
    
    const positions = new Float32Array(totalVertices * 3);
    let offset = 0;
    geometries.forEach(g => {
        positions.set(g.nonIndexedPos, offset);
        offset += g.nonIndexedPos.length;
    });
    
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.computeVertexNormals(); 
    return merged;
}

const mergedGeom = createKnightGeometry();

const solidMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x010206, // Deep obsidian
    metalness: 1.0,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
});
const monolith = new THREE.Mesh(mergedGeom, solidMaterial);

// Glowing Edges
const edges = new THREE.EdgesGeometry(mergedGeom);
const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x8b5cf6, // Starts Purple
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending
});
const wireframe = new THREE.LineSegments(edges, edgeMaterial);
monolith.add(wireframe);

// Wrapper for animation
const knightWrapper = new THREE.Group();
knightWrapper.add(monolith);
knightWrapper.position.set(-3, 0, 0); // Position slightly left of center
scene.add(knightWrapper);

// Atmospheric particles (Embers/Dust)
const bgGeom = new THREE.BufferGeometry();
const bgPos = new Float32Array(1000 * 3);
for(let i=0; i<3000; i++) {
    bgPos[i] = (Math.random() - 0.5) * 80;
    if (i % 3 === 1) bgPos[i] = Math.random() * 30 - 8; // Focus some towards bottom
}
bgGeom.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
const bgMat = new THREE.PointsMaterial({
    color: 0x0ea5e9, // Cyan
    size: 0.1,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending
});
const bgParticles = new THREE.Points(bgGeom, bgMat);
scene.add(bgParticles);

// Cinematic Animations - Calm, hypnotic motion
gsap.to(knightWrapper.rotation, { y: Math.PI * 2, duration: 60, repeat: -1, ease: "none" });
gsap.to(knightWrapper.position, { y: 0.8, duration: 6, repeat: -1, yoyo: true, ease: "sine.inOut" });

// Energy Pulse through edges
gsap.to(edgeMaterial, {
    opacity: 0.8,
    duration: 4,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut"
});

// Color shift edges
gsap.to(edgeMaterial.color, {
    r: 0.05, g: 0.65, b: 0.9, // Shifts to Cyan (0x0ea5e9)
    duration: 8,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut"
});

// Pulse grid
gsap.to(gridHelper.material, {
    opacity: 0.4,
    duration: 5,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut"
});

// UI Interactions (Parallax)
const card = document.getElementById('login-card');
const brand = document.querySelector('.brand-section');

document.addEventListener('mousemove', (e) => {
    const xAxis = (window.innerWidth / 2 - e.pageX) / 80;
    const yAxis = (window.innerHeight / 2 - e.pageY) / 80;
    
    // UI Parallax
    gsap.to(card, { rotationY: -xAxis, rotationX: yAxis, duration: 1, ease: "power2.out" });
    gsap.to(brand, { x: xAxis * 2, y: yAxis * 2, duration: 1, ease: "power2.out" });

    // Subtle lighting response to mouse
    gsap.to(underLight.position, {
        x: -xAxis * 10,
        z: 5 + yAxis * 5,
        duration: 2,
        ease: "power2.out"
    });
});

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Render Loop
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() * 0.001;
    bgParticles.rotation.y = time * 0.01;
    bgParticles.rotation.x = time * 0.005;
    renderer.render(scene, camera);
}
animate();
