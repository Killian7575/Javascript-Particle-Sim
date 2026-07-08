import { computeSliceForces, integrateSliceForces } from "../forces/forces";
import type { ComputeSliceForcesBuffers, ComputeSliceForcesParams, IntegrateSliceForcesParams } from "../forces/forces";
import { createPartitioner } from "../spatialPartition/PartitionModules";

self.onmessage = (msg) => {
    const worker = new SimWorker(msg.data);
    
    self.postMessage({ type: "ready", workerId: worker.workerId, workerSlice: worker.workerSlice })
    worker.start();
}

class SimWorker {
    readonly workerId: number;
    private readonly controlSignal: Int32Array<SharedArrayBuffer>;
    private readonly CTRL: WorkerControls;
    private readonly MODES: WorkerBoundaryModes;
    private readonly PARAMS: WorkerLiveParams;
    private readonly POSIDX: WorkerReadWrite;

    private readonly computeBuffers: ComputeSliceForcesBuffers;
    private readonly posBuffers: Float64Array<SharedArrayBuffer>[];
    private readonly posRW: Uint8Array<SharedArrayBuffer>;
    private computeParams: ComputeSliceForcesParams;
    private readonly world: World;

    private readonly liveParams: SimSharedBuffers["liveParams"];

    private readonly spatial: SpatialPartitionClass;
    private readonly parse: SpatialPartitionClass["parse"];

    readonly workerSlice: [number, number];

    constructor(config: WorkerConfig) {
        const { workerId, workerSlice, controlSignal, CTRL } = config.workerInfo;
        const { particleCount, typeCount, simWidth, simHeight, dimension, spatialModuleName, PARAMS, MODES, POSIDX } = config.simInfo;
        const { posBuffers, posRW, velInterleaved, accumInterleaved, type, rules, typeRMax, typeBeta, liveParams, requestedBuffers } = config.buffers;

        this.workerId = workerId;
        this.workerSlice = workerSlice;
        this.controlSignal = controlSignal;
        this.CTRL = CTRL;
        this.MODES = MODES;
        this.PARAMS = PARAMS;
        this.POSIDX = POSIDX;

        this.liveParams = liveParams;

        this.posBuffers = posBuffers;
        this.posRW = posRW;

        this.computeBuffers = {
            pos: posBuffers[posRW[POSIDX.READ]],
            vel: velInterleaved,
            accum: accumInterleaved,
            type: type,
            typeRMax: typeRMax,
            typeBeta: typeBeta,
            rules: rules,
        };
        this.computeParams = {
            dim: dimension,
            typeCount: typeCount
        };
        this.world = {
            simWidth: simWidth,
            simHeight: simHeight,
        };
        
        this.spatial = createPartitioner(spatialModuleName, {
            simWidth: simWidth,
            simHeight: simHeight,
            particleCount: particleCount,
            dimension: dimension,
            positions: posBuffers[posRW[POSIDX.READ]],
            requestedBuffers: requestedBuffers
        });
        this.parse = this.spatial.parse.bind(this.spatial)

    }
    private makeMinImageDist() {
        const wrap = (dist: number, size: number) => dist - size * Math.round(dist / size);
        const none = (dist: number, _size: number) => dist;
        return this.liveParams[this.PARAMS.BOUNDARY] === this.MODES.WRAP ? wrap : none;
    }
    start() {
        const { controlSignal, CTRL } = this;
        let frame = Atomics.load(controlSignal, CTRL.FRAME);
        while (true) {
            Atomics.wait(controlSignal, CTRL.FRAME, frame);
            frame = Atomics.load(controlSignal, CTRL.FRAME);
            this.run();
            this.complete();
        }
    }
    complete() {
        const { CTRL, controlSignal } = this;
        Atomics.add(controlSignal, CTRL.COUNTER, 1);
        Atomics.notify(controlSignal, CTRL.COUNTER)
    }
    terminate() {
        self.close();
    }
    run() {
        const { 
            spatial,
            MODES, PARAMS, POSIDX,
            computeBuffers, computeParams, workerSlice: workerRange, world, liveParams,
            posBuffers, posRW
            } = this;
        const { vel, accum } = computeBuffers
        const minImg = this.makeMinImageDist();
        const boundaryMode = liveParams[PARAMS.BOUNDARY]
        if (MODES[spatial.boundaryMode] !== boundaryMode) {
            switch (boundaryMode) {
                case (MODES.WRAP): {
                    spatial.boundaryMode = "WRAP";
                    break;
                }
                case (MODES.BOUNCE): {
                    spatial.boundaryMode = "BOUNCE";
                    break;
                }
                case (MODES.SNAP): {
                    spatial.boundaryMode = "SNAP";
                    break;
                }
            }
        }
        computeBuffers.pos = posBuffers[posRW[POSIDX.READ]];
        spatial.positions = posBuffers[posRW[POSIDX.READ]];
        const integrateParams: IntegrateSliceForcesParams = {
            speed: liveParams[PARAMS.SPEED],
            dt: liveParams[PARAMS.DT],
            frictionMulti: liveParams[PARAMS.FRICTION],
        }
        computeSliceForces(
            computeBuffers,
            workerRange,
            spatial.neighbourScratch,
            world,
            minImg,
            this.parse,
            computeParams)
        integrateSliceForces(
            posBuffers[posRW[POSIDX.READ]],
            posBuffers[posRW[POSIDX.WRITE]],
            vel, 
            accum, 
            workerRange, 
            computeParams.dim, 
            world,
            integrateParams,
            spatial.boundaryMode
        )
    }
}