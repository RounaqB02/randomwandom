import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GUI } from 'dat.gui';
import Chart from 'chart.js/auto';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- SCENE, CAMERA, RENDERER ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 5, 30);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// --- ENHANCED ORBIT CONTROLS (FULL MOVEMENT CAPABILITY) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.enablePan = true; // Full panning enabled
controls.enableRotate = true; // Full rotation enabled
controls.maxPolarAngle = Math.PI; // Allow full rotation range
controls.minDistance = 5;
controls.maxDistance = 500;
controls.panSpeed = 2.0; // Increased pan speed for better movement
controls.rotateSpeed = 1.0;
controls.zoomSpeed = 1.2;

// --- POST-PROCESSING (BLOOM EFFECT) ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0;
bloomPass.strength = 1.2;
bloomPass.radius = 0.5;
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// --- LIGHTING & HELPERS ---
const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(10, 10, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

// --- EXPANDED COORDINATE GRID SYSTEM ---
// Main large grid
const mainGrid = new THREE.GridHelper(500, 100, 0x00ffff, 0x444444); // 500 units, 100 divisions
mainGrid.material.emissive = new THREE.Color(0x00ffff);
mainGrid.material.emissiveIntensity = 0.02;
mainGrid.position.y = -0.01;
scene.add(mainGrid);

// Secondary fine grid for close-up work
const fineGrid = new THREE.GridHelper(100, 100, 0x00aaaa, 0x333333); // 100 units, 100 divisions
fineGrid.material.emissive = new THREE.Color(0x00aaaa);
fineGrid.material.emissiveIntensity = 0.01;
fineGrid.position.y = -0.005;
scene.add(fineGrid);

// Add coordinate axes
const axesHelper = new THREE.AxesHelper(50);
scene.add(axesHelper);

// --- PHYSICS WORLD WITH AIR RESISTANCE ---
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;

// --- MODULE STATE & OBJECTS ---
let cannon = null;
let projectile = {};
let ghosts = {};
let vectors = {};
let tracer = { positions: [] };
let particles = [];
let simulationActive = false;
let chart = null;
let timeElapsed = 0;
let maxHeight = 0;
let cameraFollowMode = false;

// --- UI ELEMENTS ---
const dataOverlay = {
    time: document.getElementById('time-data'),
    position: document.getElementById('position-data'),
    velocity: document.getElementById('velocity-data'),
    results: document.getElementById('results-data'),
};

// --- IMPROVED CANNON FACTORY (FIXED ORIENTATION) ---
function createCannon() {
    console.log('Creating cannon...');
    const cannonGroup = new THREE.Group();

    const barrelMat = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 0.7,
        roughness: 0.3,
        emissive: 0x666666,
        emissiveIntensity: 0.2
    });

    const baseMat = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        metalness: 0.8,
        roughness: 0.4,
        emissive: 0x555555,
        emissiveIntensity: 0.2
    });

    // Create barrel geometry and fix rotation orientation
    const barrelGeometry = new THREE.CylinderGeometry(0.3, 0.4, 4, 32);
    // Translate geometry so rotation happens around the base (bottom)
    barrelGeometry.translate(0, 2, 0);

    const barrel = new THREE.Mesh(barrelGeometry, barrelMat);
    barrel.name = 'barrel';
    barrel.castShadow = true;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 2, 32), baseMat);
    base.castShadow = true;

    const accent = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.0, 16),
        new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 0.5
        })
    );
    accent.position.y = 2;
    accent.rotation.x = Math.PI / 2;

    cannonGroup.add(barrel);
    cannonGroup.add(base);
    cannonGroup.add(accent);
    cannonGroup.position.y = 1;
    scene.add(cannonGroup);
    console.log('Cannon created successfully');
    return cannonGroup;
}

// --- VISIBILITY HELPERS ---
function setVectorVisibility(visible) {
    if (vectors.velocity) vectors.velocity.visible = visible;
    if (vectors.acceleration) vectors.acceleration.visible = visible;
}
function setGhostVisibility(visible) {
    if (ghosts.x) ghosts.x.visible = visible;
    if (ghosts.y) ghosts.y.visible = visible;
}
function setTraceVisibility(visible) {
    if (tracer.line) tracer.line.visible = visible;
}

// --- AIR RESISTANCE FUNCTION ---
function applyAirResistance(body, dragCoefficient) {
    if (dragCoefficient <= 0) return;

    const velocity = body.velocity;
    const speed = velocity.length();

    if (speed > 0.01) {
        // Quadratic drag force: F_drag = -0.5 * ρ * Cd * A * v² * v̂
        // Simplified: F_drag = -dragCoefficient * v² * v̂
        const dragMagnitude = dragCoefficient * speed * speed;

        // Normalize velocity to get direction
        const dragDirection = velocity.clone();
        dragDirection.normalize();
        dragDirection.scale(-dragMagnitude, dragDirection);

        // Apply drag force
        body.applyForce(dragDirection, body.position);
    }
}

// --- PARTICLE CREATION FUNCTION ---
function createParticles(position) {
    console.log('Creating particles at:', position);
    for (let i = 0; i < 20; i++) {
        const p_geo = new THREE.SphereGeometry(Math.random() * 0.1 + 0.05, 8, 8);
        const p_mat = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            emissive: 0xffff00,
            emissiveIntensity: 1
        });
        const particle = new THREE.Mesh(p_geo, p_mat);
        particle.position.copy(position);
        particle.userData.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8
        );
        particle.userData.life = 1.0;
        particles.push(particle);
        scene.add(particle);
    }
}

// --- CHART SETUP ---
function setupChart() {
    const ctx = document.getElementById('kinematics-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Height (y) vs. Distance (x)',
                data: [],
                borderColor: 'rgba(0, 255, 255, 1)',
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                tension: 0.1,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    title: { display: true, text: 'Distance (m)', color: '#00ffff' },
                    grid: { color: 'rgba(0, 255, 255, 0.2)' },
                    ticks: { color: '#00ffff' }
                },
                y: {
                    title: { display: true, text: 'Height (m)', color: '#00ffff' },
                    grid: { color: 'rgba(0, 255, 255, 0.2)' },
                    ticks: { color: '#00ffff' }
                }
            },
            plugins: {
                legend: { labels: { color: '#00ffff' } }
            }
        }
    });
}

// --- RESET FUNCTION ---
function resetSimulation(fullReset = true) {
    console.log('Resetting simulation...');
    simulationActive = false;
    timeElapsed = 0;
    maxHeight = 0;

    // Clean up physics and visuals
    if (projectile.body) world.removeBody(projectile.body);
    if (projectile.mesh) scene.remove(projectile.mesh);
    if (ghosts.x) scene.remove(ghosts.x);
    if (ghosts.y) scene.remove(ghosts.y);
    if (vectors.velocity) scene.remove(vectors.velocity);
    if (vectors.acceleration) scene.remove(vectors.acceleration);
    if (tracer.line) scene.remove(tracer.line);

    // Clear particle effects
    particles.forEach(p => scene.remove(p));
    particles = [];

    // Reset objects
    projectile = {};
    ghosts = {};
    vectors = {};
    tracer = { positions: [] };

    if (fullReset) {
        setupChart();
        const barrel = cannon.getObjectByName('barrel');
        if (barrel) barrel.rotation.z = -params.launchAngle * (Math.PI / 180);
        dataOverlay.results.innerHTML = '';
    }

    // Re-enable controls
    controls.enabled = true;
}

// --- FIRE PROJECTILE FUNCTION (WITH AIR RESISTANCE) ---
function fireProjectile() {
    console.log('Fire button clicked!');

    if (simulationActive) {
        console.log('Simulation already active, returning...');
        return;
    }

    console.log('Starting projectile launch...');
    resetSimulation(false);
    simulationActive = true;
    timeElapsed = 0;
    maxHeight = 0;

    const barrel = cannon.getObjectByName('barrel');
    console.log('Barrel found:', barrel);

    if (!barrel) {
        console.error('Barrel not found!');
        alert('Error: Cannon barrel not found!');
        return;
    }

    const angleRad = params.launchAngle * (Math.PI / 180);
    // Calculate start position from barrel tip
    const startPos = new THREE.Vector3(0, 4, 0); // Tip of the 4-unit barrel
    barrel.localToWorld(startPos);

    console.log('Launch parameters:', {
        angle: params.launchAngle,
        speed: params.initialSpeed,
        airResistance: params.airResistance,
        startPos: startPos
    });

    // Create fire particles
    createParticles(startPos);

    // Create projectile physics body
    projectile.body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Sphere(0.5),
        material: new CANNON.Material({ friction: 0.1, restitution: 0.3 })
    });
    projectile.body.position.set(startPos.x, startPos.y, startPos.z);
    projectile.body.velocity.set(
        params.initialSpeed * Math.cos(angleRad),
        params.initialSpeed * Math.sin(angleRad),
        0
    );
    world.addBody(projectile.body);

    // Create projectile mesh
    const mat = new THREE.MeshStandardMaterial({
        color: 0xff00ff,
        emissive: 0xff00ff,
        emissiveIntensity: 1
    });
    projectile.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), mat);
    projectile.mesh.castShadow = true;
    scene.add(projectile.mesh);

    // Create ghost objects
    ghosts.x = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.5,
            emissive: 0x00ffff,
            emissiveIntensity: 0.2
        })
    );
    ghosts.y = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.5,
            emissive: 0xffff00,
            emissiveIntensity: 0.2
        })
    );
    scene.add(ghosts.x);
    scene.add(ghosts.y);

    // Create vector arrows
    const vel = projectile.body.velocity;
    vectors.velocity = new THREE.ArrowHelper(
        new THREE.Vector3(vel.x, vel.y, 0).normalize(),
        projectile.mesh.position,
        3,
        0x00ff00
    );
    vectors.acceleration = new THREE.ArrowHelper(
        new THREE.Vector3(0, -1, 0),
        projectile.mesh.position,
        2,
        0xff0000
    );
    scene.add(vectors.velocity);
    scene.add(vectors.acceleration);

    // Create tracer line
    tracer.geometry = new THREE.BufferGeometry();
    tracer.positions = [];
    const traceMat = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.3
    });
    tracer.line = new THREE.Line(tracer.geometry, traceMat);
    scene.add(tracer.line);

    // Apply visibility settings
    setVectorVisibility(params.showVectors);
    setGhostVisibility(params.showGhosts);
    setTraceVisibility(params.showTrace);

    console.log('Projectile launched successfully!');
}

// --- CAMERA CONTROL FUNCTIONS ---
function resetCameraView() {
    camera.position.set(0, 5, 30);
    controls.target.set(0, 0, 0);
    controls.update();
    cameraFollowMode = false;
    params.cameraFollow = false;
    controls.enabled = true;
}

// --- INITIALIZE CANNON FIRST ---
cannon = createCannon();

// --- SIMULATION PARAMETERS (WITH AIR RESISTANCE) ---
const params = {
    launchAngle: 45,
    initialSpeed: 25,
    gravity: 9.82,
    airResistance: 0.0, // New air resistance parameter
    showVectors: true,
    showGhosts: true,
    showTrace: true,
    cameraFollow: false,
    fire: fireProjectile,
    resetSim: () => resetSimulation(),
    resetCamera: resetCameraView,
};

// --- ENHANCED GUI SETUP ---
const gui = new GUI({ autoPlace: false });
document.body.appendChild(gui.domElement);
gui.domElement.style.position = 'fixed';
gui.domElement.style.top = '20px';
gui.domElement.style.right = '20px';
gui.domElement.style.zIndex = '1000';

// Basic controls
gui.add(params, 'launchAngle', 0, 90, 1).name('Launch Angle (°)').onChange(angle => {
    if (!simulationActive && cannon) {
        const barrel = cannon.getObjectByName('barrel');
        if (barrel) barrel.rotation.z = -angle * (Math.PI / 180);
    }
});
gui.add(params, 'initialSpeed', 1, 100, 1).name('Initial Speed (m/s)');
gui.add(params, 'gravity', 0, 20, 0.01).name('Gravity (m/s²)').onChange(g => world.gravity.set(0, -g, 0));

// NEW: Air resistance control
gui.add(params, 'airResistance', 0, 0.01, 0.0001).name('Air Resistance');

// Visual controls
const visFolder = gui.addFolder('Visuals');
visFolder.add(params, 'showVectors').name('Show Vectors').onChange(v => setVectorVisibility(v));
visFolder.add(params, 'showGhosts').name('Show Ghosts').onChange(v => setGhostVisibility(v));
visFolder.add(params, 'showTrace').name('Show Trace').onChange(v => setTraceVisibility(v));
visFolder.add(params, 'cameraFollow').name('Camera Follow').onChange(v => {
    cameraFollowMode = v;
    if (!v) controls.enabled = true;
});
visFolder.open();

// Control buttons
const controlFolder = gui.addFolder('Controls');
controlFolder.add(params, 'fire').name('🚀 FIRE');
controlFolder.add(params, 'resetSim').name('🔄 RESET');
controlFolder.add(params, 'resetCamera').name('📷 Reset Camera');
controlFolder.open();

// Set initial cannon angle
const barrel = cannon.getObjectByName('barrel');
if (barrel) barrel.rotation.z = -params.launchAngle * (Math.PI / 180);

// --- ANIMATION LOOP (WITH AIR RESISTANCE) ---
const clock = new THREE.Clock();
const fixedTimeStep = 1/60;

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    // Update controls
    controls.update();

    // Apply air resistance before physics step
    if (simulationActive && projectile.body && params.airResistance > 0) {
        applyAirResistance(projectile.body, params.airResistance);
    }

    // Fixed physics timestep
    world.step(fixedTimeStep, deltaTime, 3);

    // Update particles
    particles.forEach((p, index) => {
        p.userData.life -= deltaTime * 2;
        if (p.userData.life <= 0) {
            scene.remove(p);
            particles.splice(index, 1);
        } else {
            p.position.addScaledVector(p.userData.velocity, deltaTime);
            p.material.opacity = p.userData.life;
            p.userData.velocity.multiplyScalar(0.98);
        }
    });

    if (simulationActive && projectile.body) {
        const pos = projectile.body.position;
        const vel = projectile.body.velocity;

        if (projectile.mesh) {
            projectile.mesh.position.copy(pos);
            projectile.mesh.quaternion.copy(projectile.body.quaternion);
        }

        if (params.showGhosts && ghosts.x && ghosts.y) {
            ghosts.x.position.set(pos.x, 0.25, 0);
            ghosts.y.position.set(0, pos.y, 0);
        }

        if (params.showVectors && vectors.velocity && vectors.acceleration) {
            vectors.velocity.position.copy(pos);
            if (vel.length() > 0.1) {
                vectors.velocity.setDirection(new THREE.Vector3(vel.x, vel.y, vel.z).normalize());
                vectors.velocity.setLength(Math.min(vel.length() * 0.2, 5));
            }
            vectors.acceleration.position.copy(pos);
        }

        if (params.showTrace && tracer.line) {
            tracer.positions.push(pos.x, pos.y, pos.z);
            tracer.geometry.setAttribute('position', new THREE.Float32BufferAttribute(tracer.positions, 3));
        }

        timeElapsed += deltaTime;
        if (pos.y > maxHeight) maxHeight = pos.y;

        dataOverlay.time.innerText = `Time: ${timeElapsed.toFixed(2)} s`;
        dataOverlay.position.innerText = `Position (x, y): (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) m`;
        dataOverlay.velocity.innerText = `Velocity (vx, vy): (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}) m/s`;

        if (Math.floor(timeElapsed * 10) % 2 === 0) {
            chart.data.labels.push(pos.x.toFixed(1));
            chart.data.datasets[0].data.push(pos.y.toFixed(2));
            chart.update('none');
        }

        if (cameraFollowMode) {
            controls.enabled = false;
            const camTarget = new THREE.Vector3(pos.x / 2, Math.max(pos.y / 2 + 2, 3), 0);
            camera.lookAt(camTarget);
            const requiredZ = Math.max(pos.x * 0.8 + 20, 25);
            camera.position.lerp(new THREE.Vector3(camTarget.x, camTarget.y + 3, requiredZ), 0.03);
        }

        if (pos.y < 0 && timeElapsed > 0.5) {
            simulationActive = false;
            const range = pos.x;
            const theoreticalRange = params.airResistance > 0 ?
                'N/A (with air resistance)' :
                (params.initialSpeed**2 * Math.sin(2 * params.launchAngle * Math.PI/180) / params.gravity).toFixed(2) + ' m';

            dataOverlay.results.innerHTML = `
                <hr style="border-color: #00ffff;">
                <strong style="color: #00ffff;">MISSION RESULTS:</strong><br>
                Range: ${range.toFixed(2)} m<br>
                Max Height: ${maxHeight.toFixed(2)} m<br>
                Time of Flight: ${timeElapsed.toFixed(2)} s<br>
                <small>Theoretical Range (no air resistance): ${theoreticalRange}</small>
            `;
        }
    }

    composer.render();
}

// --- INITIALIZE ---
setupChart();
animate();

