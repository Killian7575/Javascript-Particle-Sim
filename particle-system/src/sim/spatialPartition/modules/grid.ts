import { clamp } from "../../../core/util";

export const gridModule: PartitionModule = {
    getBufferSpec(config: BufferSpecConfig): BufferSpec[] {
        const { particleCount, spacing } = config;
        const { cellSize } = Grid.calcCellSize(spacing);
        const { totalCells } = calcGridDimensions(cellSize, config.world);
        return [{
            name: "gridCellStartOffsets",
            byteLength: (totalCells + 1) * Uint32Array.BYTES_PER_ELEMENT 
        }, {
            name: "gridSortedParticleIndicies",
            byteLength: particleCount * Uint32Array.BYTES_PER_ELEMENT
        }]
    },
    create(config: SpatialPartitionClassConstructor): SpatialPartitionClass {
        return new Grid(config);
    },
    adjustWorldSize(config: AdjustWorldSizeConfig): World {
        let { simWidth, simHeight } = config.world;
        return { simWidth, simHeight }
    }
}
interface GridDimensions {
    totalColumns: number;
    totalRows: number;
    totalCells: number;
}
function calcGridDimensions(cellSize: number, world: World): GridDimensions {
    const { simWidth, simHeight } = world
    const totalColumns = Math.max(1, Math.round(simWidth  / cellSize))
    const totalRows    = Math.max(1, Math.round(simHeight / cellSize))
    return { totalColumns, totalRows, totalCells: totalColumns * totalRows }
}

export class Grid implements SpatialPartitionClass {
    private readonly particleCount: number;
    private readonly dimension: number;

    private readonly cellSize: number;
    private readonly totalColumns: number;
    private readonly totalRows: number;
    private readonly totalCells: number;
    private readonly cellWidth: number;
    private readonly cellHeight: number;

    positions: Float64Array<SharedArrayBuffer>;
    private readonly gridCellStartOffsets: Uint32Array<SharedArrayBuffer>;
    private readonly gridSortedParticleIndicies: Uint32Array<SharedArrayBuffer>;

    private readonly particlesPerCellCount: number[];
    private readonly particleCellIndex: number[];
    private readonly cursorOfCellOffsets: Uint32Array;

    private epoch: number;
    private readonly cellEpoch: Uint32Array;

    readonly neighbourScratch: Uint32Array

    boundaryMode: BoundaryMode = "WRAP";

    constructor(config: SpatialPartitionClassConstructor) {
        const { simWidth, simHeight, particleCount, dimension, requestedBuffers, positions, spacing } = config;
        const { gridCellStartOffsets, gridSortedParticleIndicies } = requestedBuffers
  
        this.particleCount = particleCount;
        this.dimension = dimension;

        const { cellSize } = Grid.calcCellSize(spacing);
        this.cellSize = cellSize;

        const { totalColumns, totalRows, totalCells } = calcGridDimensions(cellSize, {simWidth, simHeight});
        this.totalColumns = totalColumns;
        this.totalRows = totalRows;  
        this.totalCells = totalCells;

        this.cellWidth = simWidth  / totalColumns;
        this.cellHeight = simHeight / totalRows;

        this.positions = positions;
        this.gridCellStartOffsets = new Uint32Array(gridCellStartOffsets);
        this.gridSortedParticleIndicies = new Uint32Array(gridSortedParticleIndicies);

        this.particlesPerCellCount = Array(this.totalCells);
        this.particleCellIndex = Array(particleCount)
        this.cursorOfCellOffsets = new Uint32Array(this.totalCells + 1);
        this.neighbourScratch = new Uint32Array(particleCount);

        this.epoch = 0;
        this.cellEpoch = new Uint32Array(this.totalCells);
    }
    static calcCellSize(spacing: number): { cellSize: number } {
        const targetParticlesPerCell = 20;
        const cellSizeMultiplier =  Math.sqrt(targetParticlesPerCell); // averageParticlesPerCell = cellSizeMultiplier²
        return { cellSize: Math.floor(spacing) * cellSizeMultiplier };
    }

    private cellIndexForPosition(x: number, y: number): number {
        const { cellSize, totalColumns, totalRows } = this;

        const columnIndex = clamp(Math.floor(x / cellSize), 0, totalColumns - 1);
        const rowIndex = clamp(Math.floor(y / cellSize), 0, totalRows - 1);

        const cellIndex = columnIndex + rowIndex * totalColumns;

        return cellIndex
    }

    setBoundary(input: BoundaryMode): void {
        this.boundaryMode = input;
    }
    bin(): void {
        const { gridCellStartOffsets, gridSortedParticleIndicies,
            particlesPerCellCount, particleCount, particleCellIndex,
            dimension: dim, totalCells, cursorOfCellOffsets,
            positions
        } = this;
        // 0 vars
        particlesPerCellCount.fill(0)
        
        // PASS 1: Count
        for (let p = 0, i = 0; p < particleCount; p++, i += dim) {
            const cell = this.cellIndexForPosition(positions[i],
                                                   positions[i + 1])
            particleCellIndex[p] = cell;
            particlesPerCellCount[cell] += 1;
        }

        // PASS 2: Prefix sum (compute the offsets)
        let runningTotal = 0
        for (let cell = 0; cell < totalCells; cell++) {
            gridCellStartOffsets[cell] = runningTotal;
            runningTotal += particlesPerCellCount[cell];
        }
        gridCellStartOffsets[totalCells] = runningTotal;

        // PASS 3: Scatter (place particles into their slices)
        cursorOfCellOffsets.set(gridCellStartOffsets);
        for (let i = 0; i < particleCount; i++) {
            const cell = particleCellIndex[i];
            gridSortedParticleIndicies[cursorOfCellOffsets[cell]] = i;
            cursorOfCellOffsets[cell] += 1;
        }
    }
    *parse(input: SpatialPartitionMethodParseInput): IterableIterator<number> {
        const { particleIndex, rMax } = input;
        const { 
            totalColumns, totalRows, boundaryMode,
            gridCellStartOffsets, gridSortedParticleIndicies,
            neighbourScratch, cellEpoch,
            positions,
            cellWidth, cellHeight
        } = this

        if (this.epoch++ === 0) { cellEpoch.fill(0); this.epoch = 1; } //epoch increment + overflow handle 

        const homeColumn = clamp(Math.floor(positions[particleIndex] / cellWidth), 0, totalColumns - 1);
        const homeRow = clamp(Math.floor(positions[particleIndex + 1] / cellHeight), 0, totalRows - 1);
        
        const colRingCount = Math.ceil(rMax / cellWidth);
        const rowRingCount = Math.ceil(rMax / cellHeight);

        for (let rowOffset = -rowRingCount; rowOffset < rowRingCount + 1; rowOffset++) {
            for (let colOffset = -colRingCount; colOffset < colRingCount + 1; colOffset++) {
                let neighbourColumn: number | undefined = undefined;
                let neighbourRow: number | undefined = undefined;
                let neighbourCell: number | undefined = undefined;
                const candidateNCol = homeColumn + colOffset;
                const candidateNRow = homeRow + rowOffset;
                if (boundaryMode === "WRAP") {
                    neighbourColumn = (candidateNCol + totalColumns) % totalColumns
                    neighbourRow = (candidateNRow + totalRows) % totalRows
                } else if ((candidateNCol | candidateNRow) >= 0 &&
                            candidateNCol < totalColumns &&
                            candidateNRow < totalRows) {
                    neighbourColumn = candidateNCol
                    neighbourRow = candidateNRow
                } else {
                    continue;
                }
                neighbourCell = neighbourRow * totalColumns + neighbourColumn;
                if (cellEpoch[neighbourCell] !== this.epoch) {
                    cellEpoch[neighbourCell] = this.epoch;
                    const start = gridCellStartOffsets[neighbourCell];
                    const end = gridCellStartOffsets[neighbourCell + 1];
                    const length = end - start;
                    for (let i = 0; i < length; i++) {
                        neighbourScratch[i] = gridSortedParticleIndicies[start + i]
                    }
                    yield length;
                    // length & neighbourScratch only valid till next local parse yeild
                }
            }
        }
    }
}