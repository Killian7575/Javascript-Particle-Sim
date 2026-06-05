import * as PIXI from 'pixi.js';

// --- Define particle colors (as hex numbers you can map to rules) ---
const COLORS = {
  RED: 0xff3333,
  GREEN: 0x33ff33,
  BLUE: 0x33aaff,
} as const;

type TypeColorKey = keyof typeof COLORS;

const buffer = 20

interface vParticle extends PIXI.Particle {
  vx: number,
  vy: number
}
let particles: vParticle[] = [];
let particleContainer: PIXI.ParticleContainer;
let app: PIXI.Application;

let debugCounter = 0;
let debugCounter2 = 0;
const targetFriction = 0.15;

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
    width: window.innerWidth - buffer,
    height: window.innerHeight - buffer,
    backgroundColor: 0x111111,
    // resizeTo: window,
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
  
  // Create particles 
  initParticles(1000);
  
  // Start the update loop
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime;
    updateParticles(dt);
  });
}
// --- Initialize particles ---

function initParticles(count: number) {
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

function normaliseVector(p1: { x: number, y:number }, p2: { x: number, y: number }): {nx: number; ny: number; distance: number } {
  // d^2 = x^2 + y^2
  // normalise direction vector: directions / magnitude
  if (p1.x === p2.x && p1.y === p2.y) { // duplicate position bypass
    return { nx: 0, ny: 0, distance: 0 }
  }
  let dx = p2.x - p1.x; // distance in x
  let dy = p2.y - p1.y; // distance in y

  let magnitude = Math.sqrt(dx ** 2 + dy ** 2)

  let nx = dx / magnitude // normalised x and y vector
  let ny = dy / magnitude

  if (debugCounter === 0) { //first particle pair snapshot
    debugCounter++;
    console.log(`Debug:`)
    console.log(`p1 x, y: ${p1.x}, ${p1.y}`)
    console.log(`p2 x, y: ${p2.x}, ${p2.y}`)
    console.log(`dx: ${dx}`)
    console.log(`dy: ${dy}`)
    console.log(`magnitude: ${magnitude}`)
    console.log(`nx, ny: ${nx}, ${ny}`)
    console.log(`should equal 1 theoretically: ${Math.sqrt(nx**2 + ny**2)}`)
  }

  return { nx, ny, distance: magnitude }
}

function calcDistanceStrength(distance: number) {
  let strength: number;
  if (distance <= 10) { // 10, x = 10 is where formula starts at 1
    strength = 1;
  } else if (distance > 100) { // 100, at x = 100, formula would be 0.1
    strength = 0;
  } else {
    strength = 10 / distance;
  }
  return strength;
}

// --- Apply color-based rules ---
// Planned rules to start off:
// Blue attacts both, red and green repel, all same strength
function applyRules(p1: PIXI.Particle, p2: PIXI.Particle): { fx: number; fy: number } {
  // Apply force to p1 based on p2
  let fx = 0;
  let fy = 0;

  let { nx, ny, distance } = normaliseVector(p1, p2)

  let distanceMulti = calcDistanceStrength(distance);
  let baseForce = 1;
  
  let repelx = -nx * baseForce * distanceMulti; // implementation
  let attractx = nx * baseForce * distanceMulti; 
  let repely = -ny * baseForce * distanceMulti;
  let attracty = ny * baseForce * distanceMulti;

  if (debugCounter2 === 0) {
    debugCounter2++;
    console.log(`p1.tint, p2.tint: ${p1.tint}, ${p2.tint}`)
    console.log((`blue, red, green: ${COLORS.BLUE}, ${COLORS.RED}, ${COLORS.GREEN}`))
  }

  switch (p2.tint) { // Planned: implement UI for live adjustment of magic number, lowest priority
    case COLORS.BLUE:
      switch (p1.tint) {
        case COLORS.BLUE: // blue effect on blue
          fx = repelx * 0.05 
          fy = repely * 0.05
          break;
        case COLORS.RED: // blue effect on red
          fx = attractx * 1// attract
          fy = attracty * 1
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
          fx = attractx * 1// attract
          fy = attracty * 1
          break;
        case COLORS.RED: // red effect on red
          fx = attractx * 0.75// attract
          fy = attracty * 0.75
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
          fx = attractx * 1// attract
          fy = attracty * 1
          break;
        case COLORS.RED: // green effect on red
          fx = attractx * 1// attract
          fy = attracty * 1
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
function updateParticles(dt: number) {
  // 1. Reset forces for all particles (use temporary arrays)
  // 2. Nested loops
  //    Accumulate total forces for each particle
  // 3. Update velocities: vx += totalFx * dt, vy += totalFy * dt
  // 4. Update positions: x += vx * dt, y += vy * dt
  // 5. Handle boundaries (bounce, wrap, or contain)
  // 6. Update particle.x and .y to match new positions
  
  // If a "static" property is changed, add the below line to end to update it in the renderer
  // particleContainer.update();

  // 60th (scaled by dt) root to get "friction" remaining velocity after 60 updates (dt 1 is at 60fps)
  let liveFriction = Math.pow(targetFriction, dt/60)

  for (let i = 0; i < particles.length; i++) {
    let forceTarget = particles[i];
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
    // for now i will bounce for simplicity
    if (forceTarget.x > app.screen.width) {
      forceTarget.x = app.screen.width;
      forceTarget.vx *= -1
    }
    if (forceTarget.x < 0) {
      forceTarget.x = 0
      forceTarget.vx *= -1
    }
    if (forceTarget.y > app.screen.height) {
      forceTarget.y = app.screen.height;
      forceTarget.vy *= -1
    }
    if (forceTarget.y < 0) {
      forceTarget.y = 0
      forceTarget.vy *= -1
    }
    
    forceTarget.vx *= liveFriction;
    forceTarget.vy *= liveFriction;

  }

}

// --- Start the system ---
setup();
