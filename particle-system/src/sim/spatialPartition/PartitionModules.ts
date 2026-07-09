import { gridModule } from "./modules/grid";
// import { Octree } from "./methods/octree";

interface PartitionModule {
  getBufferSpec(sizeCfg: SpatialPartitionClassSizeConfig): BufferSpec[];
  create(ctorCfg: SpatialPartitionClassConstructor): SpatialPartitionClass;
}
const registry: Record<SpatialModuleName, PartitionModule> = { GRID: gridModule };

export const getModule = (name: SpatialModuleName) => 
  registry[name];
export const getBufferSpec = (name: SpatialModuleName, cfg: SpatialPartitionClassSizeConfig) =>
  registry[name].getBufferSpec(cfg);
export const createPartitioner = (name: SpatialModuleName, cfg: SpatialPartitionClassConstructor) =>
  registry[name].create(cfg);

