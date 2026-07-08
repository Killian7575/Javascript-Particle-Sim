import { force } from "../../core/rules";

export interface ComputeSliceForcesBuffers {
    pos: Float64Array<SharedArrayBuffer>;
    vel: Float64Array<SharedArrayBuffer>;
    accum: Float64Array<SharedArrayBuffer>;
    type: Uint8Array<SharedArrayBuffer>;
    typeRMax: Float64Array<SharedArrayBuffer>;
    typeBeta: Float64Array<SharedArrayBuffer>;
    rules: Float64Array<SharedArrayBuffer>;
}
export interface ComputeSliceForcesParams {
    dim: number;
    typeCount: number;
}
export interface IntegrateSliceForcesParams {
    speed: number;
    dt: number;
    frictionMulti: number;
}
export function computeSliceForces(
    buffers: ComputeSliceForcesBuffers,
    slice: [start: number, end: number],
    neighbourScratch: Uint32Array,
    world: World,
    minImg: (dist: number, size: number) => number, 
    parse: SpatialPartitionClass["parse"],
    params: ComputeSliceForcesParams
): void {
    const { pos, accum, type, rules, typeRMax, typeBeta } = buffers;
    const { dim, typeCount } = params;
    const { simWidth, simHeight } = world;
    
    for (let i = slice[0]; i < slice[1]; i++) {
        const pi = i * dim;
        const iType = type[i];
        const rMax = typeRMax[iType];
        const beta = typeBeta[iType];
        for (const n of parse({particleIndex: pi, rMax})) {
            for (let j = 0; j < n; j++) {
                const pj = neighbourScratch[j] * dim;
                if (pj === pi) continue;
                
                const jType = type[neighbourScratch[j]];
                const a: number = rules[iType * typeCount + jType];
                if (a === 0) continue;

                const dx = minImg(pos[pj] - pos[pi], simWidth);
                const dy = minImg(pos[pj + 1] - pos[pi + 1], simHeight);
                if (dx === 0 && dy === 0) continue;
                if (dx * dx + dy * dy > rMax * rMax) continue;

                const dist = Math.sqrt(dx * dx + dy * dy);
                const f = force(dist, a, rMax, beta);

                accum[pi] += f * (dx / dist);
                accum[pi + 1] += f * (dy / dist);
            }
        }
    }
}
export function integrateSliceForces(
    posR: Float64Array<SharedArrayBuffer>,
    posW: Float64Array<SharedArrayBuffer>,
    vel: Float64Array<SharedArrayBuffer>,
    accum: Float64Array<SharedArrayBuffer>,
    slice: [start: number, end: number],
    dim: number,
    world: World,
    params: IntegrateSliceForcesParams,
    boundary: BoundaryMode
    
) {
    const { simWidth, simHeight } = world;
    const { frictionMulti, speed, dt } = params
    for (let i = slice[0]; i < slice[1]; i++) {
        const pi = i * dim;
        vel[pi] *= frictionMulti;
        vel[pi + 1] *= frictionMulti;
        vel[pi] += accum[pi] * speed * dt;
        vel[pi + 1] += accum [pi + 1] * speed * dt;
        posW[pi] = posR[pi] + vel[pi];
        posW[pi + 1] = posR[pi + 1] + vel[pi + 1]
        applyBoundary(pi)
    }
    function applyBoundary(i: number) {
        switch (boundary) {
            case "BOUNCE": {
            if (posW[i] > simWidth) {
                posW[i] = simWidth;
                vel[i] *= -1
            } else if (posW[i] < 0) {
                posW[i] = 0
                vel[i] *= -1
            }
            if (posW[i + 1] > simHeight) {
                posW[i + 1] = simHeight;
                vel[i + 1] *= -1
            } else if (posW[i + 1] < 0) {
                posW[i + 1] = 0
                vel[i + 1] *= -1
            }
            break;
            }
            case "SNAP":{
            if (posW[i] > simWidth) {
                posW[i] = simWidth;
            } else if (posW[i] < 0) {
                posW[i] = 0
            }
            if (posW[i + 1] > simHeight) {
                posW[i + 1] = simHeight;
            } else if (posW[i + 1] < 0) {
                posW[i + 1] = 0
            }
            break;
            }
            case "WRAP": {
            if (posW[i] > simWidth) {
                posW[i] -= simWidth;
            } else if (posW[i] < 0) {
                posW[i] += simWidth
            }
            if (posW[i + 1] > simHeight) {
                posW[i + 1] -= simHeight;
            } else if (posW[i + 1] < 0) {
                posW[i + 1] += simHeight
            }
            break;
            }
        }
    }
}
