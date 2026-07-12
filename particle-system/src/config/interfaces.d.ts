// shared interfaces
interface Config {
  seed: number | string;
  particleCount: number;
  typeCount: number;
  simWidth: number;
  simHeight: number;
  spacing: number;
}
interface FullConfig extends Config {
  speed: number;
  rMax: number[];
  beta: number[];
  friction: number;
  rules: number[];
}
type SimParameter = "all" | "speed" | "rMax" | "beta" | "friction" | "rules" | "boundary" | "maxAccel"
interface World {
  simWidth: number;
  simHeight: number;
}
interface SimSharedBuffers {
  posBuffers: Float64Array<SharedArrayBuffer>[];
  posRW: Uint8Array<SharedArrayBuffer>;
  velInterleaved: Float64Array<SharedArrayBuffer>;
  accumInterleaved: Float64Array<SharedArrayBuffer>;
  type: Uint8Array<SharedArrayBuffer>;
  rules: Float64Array<SharedArrayBuffer>;
  typeRMax: Float64Array<SharedArrayBuffer>;
  typeBeta: Float64Array<SharedArrayBuffer>;
  liveParams: Float64Array<SharedArrayBuffer>;
  requestedBuffers: Record<string, SharedArrayBuffer>;
}
type BoundaryMode = "WRAP" | "BOUNCE" | "SNAP"
// All the available spatial methods:
type SpatialModuleName = "GRID";
type WorkerBoundaryModes = { WRAP: 0, BOUNCE: 1, SNAP: 2 };
type WorkerControls = { FRAME: 0, COUNTER: 1, STATUS: 2 };
type WorkerStatus = { RUNNING: 0, COMPLETE: 1, TERMINATED: 2 };
type WorkerLiveParams = { DT: 0, SPEED: 1, FRICTION: 2, BOUNDARY: 3, MAXACCEL: 4 };
type WorkerReadWrite = { READ: 0, WRITE: 1 }
interface WorkerConfig {
  workerInfo: {
    workerId: number;
    workerSlice: [start: number, end: number];
    controlSignal: Int32Array<SharedArrayBuffer>;
    CTRL: WorkerControls;
  }
  simInfo: {
    particleCount: number;
    typeCount: number;
    simWidth: number;
    simHeight: number;
    dimension: number;
    spacing: number;
    spatialModuleName: SpatialModuleName;
    PARAMS: WorkerLiveParams;
    MODES: WorkerBoundaryModes;
    POSIDX: WorkerReadWrite;
  }
  buffers: SimSharedBuffers;
}
interface PartitionModule {
  getBufferSpec(config: BufferSpecConfig): BufferSpec[];
  create(config: SpatialPartitionClassConstructor): SpatialPartitionClass;
  adjustWorldSize(config: AdjustWorldSizeConfig): World;
}
interface BufferSpec {
  name: string;
  byteLength: number;
}
interface World {
  simWidth: number;
  simHeight: number;
}
interface BufferSpecConfig {
  spacing: spacing;
  particleCount: number;
  world: World;
}
interface AdjustWorldSizeConfig {
  cellSizeConfig: CellSizeConfig;
  world: World;
}
interface SpatialPartitionClass {
  boundaryMode: BoundaryMode;
  positions: Float64Array<SharedArrayBuffer>;
  neighbourScratch: Uint32Array;
  bin(): void;
  parse(input: SpatialPartitionClassParseInput):
    IterableIterator<number>;
}
interface SpatialPartitionClassParseInput {
  particleIndex: number;
  rMax: number
}
interface SpatialPartitionClassConstructor {
  simWidth: number;
  simHeight: number;
  particleCount: number;
  dimension: number;
  spacing: number;
  positions: Float64Array<SharedArrayBuffer>;
  requestedBuffers: Record<string, SharedArrayBuffer>;
}
interface SpatialPartitionMethodParseInput {
  particleIndex: number;
  rMax: number
}
interface SpatialPartitionClassSizeConfig {
  simWidth: number;
  simHeight: number;
  particleCount: number;
}

