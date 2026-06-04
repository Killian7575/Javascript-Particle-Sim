import * as PIXI from 'pixi.js';

// --- Define particle colors (as hex numbers you can map to rules) ---
const COLORS = {
  RED: 0xff3333,
  GREEN: 0x33ff33,
  BLUE: 0x33aaff,
} as const;

type TypeColorKey = keyof typeof COLORS;

// --- Type for a particle ---
// Note: In v8, we use the lightweight Particle class instead of Sprite
type Particle = {
  particle: PIXI.Particle;     // v8 Particle object (not Sprite)
  color: TypeColorKey;
  x: number;
  y: number;
};

let particles: Particle[] = [];
let particleContainer: PIXI.ParticleContainer;
let app: PIXI.Application;

// --- Create a texture (shared across all particles for performance) ---
// In v8, we create a single CanvasTexture that all particles reuse
const baseTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(4, 4, 3, 0, 2 * Math.PI);
  ctx.fill();
  return PIXI.Texture.from(canvas);
})();

// --- Initialize the application (v8 requires async init) ---
async function setup() {
  // Create app instance (constructor takes no arguments in v8)
  app = new PIXI.Application();
  
  // Initialize asynchronously with options
  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x111111,
    resizeTo: window,
  });
  
  document.body.appendChild(app.canvas);
  
  // Create ParticleContainer for v8
  // v8 ParticleContainer uses dynamicProperties to declare what changes each frame
  // Position must be dynamic (particles move). Other properties can be static for performance.
  particleContainer = new PIXI.ParticleContainer({
    dynamicProperties: {
      position: true,   // Particles move every frame → dynamic
      scale: false,     // Scale doesn't change → static
      rotation: false,  // Rotation doesn't change → static
      color: false,     // Color tint doesn't change → static
    },
  });
  
  app.stage.addChild(particleContainer);
  
  // Create particles (you write this)
  initParticles(100);
  
  // Start the update loop
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    updateParticles(dt);
  });
}
// --- Initialize particles ---
function initParticles(count: number) {
  // TODO for YOU:
  // - Loop 'count' times
  // - Assign random positions (x, y) within screen width/height
  // - Assign random color from COLORS keys
  // - Create a Particle using: new PIXI.Particle({ texture: colorTextures[color], x, y })
  // - Add to particleContainer using: particleContainer.addParticle(particle)
  // - Store particle, color, x, y in the particles array
  // Hint: Use Math.random() * app.screen.width, etc.
  // let allParticles: PIXI.Particle[] = []
  const colorKeys = Object.keys(COLORS) as TypeColorKey[];
  for (let i = 0; i < count; i++) {
      let randomCOLORKey = colorKeys[Math.floor(Math.random() * colorKeys.length)];
      let texture = baseTexture;
      const particle = new PIXI.Particle({
        texture,
        x: Math.random() * app.screen.width,
        y: Math.random() * app.screen.height,
        tint: COLORS[randomCOLORKey]
      });
      // particles.push(particle)
      particleContainer.addParticle(particle)
  }
}

// --- Apply color-based rules (all logic is yours) ---
// Planned rules to start off:
// Blue attacts both, red and green repel, all same strength
function applyRules(p1: Particle, p2: Particle): { fx: number; fy: number } {
  // TODO for YOU:
  // - Compute dx = p2.x - p1.x, dy = p2.y - p1.y
  // - Compute distance (or squared distance for performance)
  // - Based on p1.color and p2.color, decide attraction or repulsion
  // - Return force vector to apply to p1 (opposite force applied to p2 later)
  return { fx: 0, fy: 0 };
}

// --- Update all particles ---
// Also add slight friction
function updateParticles(dt: number) {
  // TODO for YOU:
  // 1. Reset forces for all particles (use temporary arrays)
  // 2. Nested loops: for i, for j = i+1, compute forces using applyRules()
  //    Accumulate total forces for each particle
  // 3. Update velocities: vx += totalFx * dt, vy += totalFy * dt
  // 4. Update positions: x += vx * dt, y += vy * dt
  // 5. Handle boundaries (bounce, wrap, or contain)
  // 6. Update particle.particle.x and .y to match new positions
  
  // Important: In v8, you must call container.update() after modifying particle properties
  // to sync changes to GPU. 
  // particleContainer.update(); // Uncomment when you start updating particles
}

// --- Start the system ---
setup();
