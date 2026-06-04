import * as PIXI from 'pixi.js';

// --- Define particle colors (as hex numbers you can map to rules) ---
const COLORS = {
  RED: 0xff3333,
  GREEN: 0x33ff33,
  BLUE: 0x33aaff,
} as const;

type TypeColorKey = keyof typeof COLORS;


interface vParticle extends PIXI.Particle {
  vx: number,
  vy: number
}
let particles: PIXI.Particle[] = [];
let particleContainer: PIXI.ParticleContainer;
let app: PIXI.Application;

const frictionMultiplier = 0.7;

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
      position: true,  // Update positions each frame
      rotation: false,  // static rotation
      vertex: false,   // Static vertices
      uvs: false,     // Static texture coordinates
      color: false     // Static colors
    },
    // boundsArea: new PIXI.Rectangle(0, 0, app.screen.width, app.screen.height)
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
  const colorKeys = Object.keys(COLORS) as TypeColorKey[];
  for (let i = 0; i < count; i++) {
      let randomCOLORKey = colorKeys[Math.floor(Math.random() * colorKeys.length)];
      let texture = baseTexture;
      const particle = new PIXI.Particle({
        texture,
        x: Math.random() * app.screen.width,
        y: Math.random() * app.screen.height,
        tint: COLORS[randomCOLORKey],
        anchorX: 0.5, // Set the particle centre
        anchorY: 0.5  // to be its origin for rotation/scaling
      }) as vParticle;
      particle.vx = 0;
      particle.vy = 0;
      particles.push(particle);
      particleContainer.addParticle(particle);
  }
}

function calcDistanceStrength(distanceSq: number) {
  let strength: number;
  if (distanceSq <= 100) { // 10^2, x = 10 is where formula starts at 1
    strength = 1;
  } else if (distanceSq >= 10000) { // 100^2, at x = 100 formula is 0.1
    strength = 0;
  } else {
    strength = 10 / Math.sqrt(distanceSq);
  }
  return strength;
}

// --- Apply color-based rules (all logic is yours) ---
// Planned rules to start off:
// Blue attacts both, red and green repel, all same strength
function applyRules(p1: PIXI.Particle, p2: PIXI.Particle): { fx: number; fy: number } {
  // Apply force to p1 based on p2
  // TODO for YOU:
  // - Compute dx = p2.x - p1.x, dy = p2.y - p1.y
  // - Compute distance (or squared distance for performance)
  // - Based on p1.color and p2.color, decide attraction or repulsion
  // - Return force vector to apply to p1 
  let fx = 0;
  let fy = 0;

  // note to self: distance^2 to source is (sourcex - targetx)^2 + (sourcey - targety)^2
  let disx = p2.x - p1.x; // distance in x
  let disy = p2.y - p1.y; // distance in y
  let squareDistance = Math.abs(disx ** 2 + disy ** 2); // total distance squared
  let dirx = Math.sign(disx); // x direction
  let diry = Math.sign(disy); // y direction
  

  let distanceMulti = calcDistanceStrength(squareDistance);
  let baseForce = 0.5;

  let repelx = -dirx * baseForce * distanceMulti;
  let attractx = dirx * baseForce * distanceMulti;
  let repely = -diry * baseForce * distanceMulti;
  let attracty = diry * baseForce * distanceMulti
  
  switch (p2.tint) {
    case COLORS.BLUE:
      switch (p1.tint) {
        case COLORS.BLUE: // blue effect on blue
          fx = attractx // attract
          fy = attracty
          break;
        case COLORS.RED: // blue effect on red
          fx = attractx // attract
          fy = attracty
          break; 
        case COLORS.GREEN: // blue effect on green
          fx = repelx * 0.5// repel
          fy = repely * 0.5
          break;
      }
      break;
    case COLORS.RED:
      switch (p1.tint) {
        case COLORS.BLUE: // red effect on blue
          fx = attractx // attract
          fy = attracty
          break;
        case COLORS.RED: // red effect on red
          fx = attractx // attract
          fy = attracty
          break; 
        case COLORS.GREEN: // red effect on green
          fx = repelx * 0.5// repel
          fy = repely * 0.5
          break;
      }
      break;
    case COLORS.GREEN:
      switch (p1.tint) {
        case COLORS.BLUE: // green effect on blue
          fx = attractx // attract
          fy = attracty
          break;
        case COLORS.RED: // green effect on red
          fx = attractx // attract
          fy = attracty
          break; 
        case COLORS.GREEN: // green effect on green
          fx = repelx * 0.5// repel
          fy = repely * 0.5
          break;
      }
      break; 
  }

  return { fx, fy };
}

// --- Update all particles ---
// Also add slight friction
function updateParticles(dt: number) {
  // TODO for YOU:
  // 1. Reset forces for all particles (use temporary arrays)
  // 2. Nested loops
  //    Accumulate total forces for each particle
  // 3. Update velocities: vx += totalFx * dt, vy += totalFy * dt
  // 4. Update positions: x += vx * dt, y += vy * dt
  // 5. Handle boundaries (bounce, wrap, or contain)
  // 6. Update particle.x and .y to match new positions
  
  // If a "static" property is changed, add the below line to end to update it in the renderer
  // particleContainer.update();
  for (let i = 0; i < particles.length; i++) {
    let forceTarget = particles[i] as vParticle;
    let sumForce = { fx: 0, fy: 0 };
    for (let j = 0; j < particles.length; j++) {
      let forceSource = particles[j];
      if (i != j) {
        let { fx, fy } = applyRules(forceTarget, forceSource);
        sumForce.fx += fx;
        sumForce.fy += fy;
      }
    }
    forceTarget.vx += sumForce.fx * dt; // calc velocity 
    forceTarget.vy += sumForce.fy * dt;
    forceTarget.x += forceTarget.vx * dt; // apply velocity to particle
    forceTarget.y += forceTarget.vy * dt;
    // for now i will clamp for simplicity
    if (forceTarget.x > app.screen.width) {
      forceTarget.x = app.screen.width;
    }
    if (forceTarget.x < 0) {
      forceTarget.x = 0
    }
    if (forceTarget.y > app.screen.height) {
      forceTarget.y = app.screen.height;
    }
    if (forceTarget.y < 0) {
      forceTarget.y = 0
    }
    forceTarget.vx *= frictionMultiplier; // dampen velocity
    forceTarget.vy *= frictionMultiplier;
  }

}

// --- Start the system ---
setup();
