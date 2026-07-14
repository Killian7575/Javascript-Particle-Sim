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

    private qHomeCol = 0;
    private qHomeRow = 0;
    private qColRing = 0;
    private qRowRing = 0;
    private qColSpan = 0;
    private qTotal = 0;
    private qK = 0;
    qBatchOffset = 0;

    positions: Float64Array<SharedArrayBuffer>;
    private readonly gridCellStartOffsets: Uint32Array<SharedArrayBuffer>;
    readonly candidates: Uint32Array<SharedArrayBuffer>;

    private readonly particlesPerCellCount: number[];
    private readonly particleCellIndex: number[];
    private readonly cursorOfCellOffsets: Uint32Array;

    private epoch: number;
    private readonly cellEpoch: Uint32Array;

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
        this.candidates = new Uint32Array(gridSortedParticleIndicies);

        this.particlesPerCellCount = Array(this.totalCells);
        this.particleCellIndex = Array(particleCount)
        this.cursorOfCellOffsets = new Uint32Array(this.totalCells + 1);

        this.epoch = 0;
        this.cellEpoch = new Uint32Array(this.totalCells);
    }
    static calcCellSize(spacing: number): { cellSize: number } {
        const targetParticlesPerCell = 15;
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
        const { gridCellStartOffsets, candidates,
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
            candidates[cursorOfCellOffsets[cell]] = i;
            cursorOfCellOffsets[cell] += 1;
        }
    }
    beginQuery(particleIndex: number, rMax: number) {
        const { 
            cellEpoch, positions, 
            cellWidth, cellHeight,
            totalColumns, totalRows
        } = this

        if (this.epoch++ === 0) { cellEpoch.fill(0); this.epoch = 1; } //epoch increment + overflow handle 

        this.qHomeCol = clamp(Math.floor(positions[particleIndex] / cellWidth), 0, totalColumns - 1);
        this.qHomeRow = clamp(Math.floor(positions[particleIndex + 1] / cellHeight), 0, totalRows - 1);
        
        this.qColRing = Math.ceil(rMax / cellWidth);
        this.qRowRing = Math.ceil(rMax / cellHeight);
        
        this.qColSpan = 2 * this.qColRing + 1;
        this.qTotal = this.qColSpan * (2 * this.qRowRing + 1);

        this.qK = 0;
    }
    nextBatch(): number {
        const {
            qColRing, qRowRing, qColSpan,
            qTotal, qHomeCol, qHomeRow,
            boundaryMode, cellEpoch,
            totalColumns, totalRows,
            gridCellStartOffsets
        } = this;
        while (this.qK < qTotal) {
            let neighbourColumn: number;
            let neighbourRow: number;
            let neighbourCell: number;
            
            const k = this.qK++;

            const colOffset = (k % qColSpan) - qColRing;
            const rowOffset = (k / qColSpan | 0) - qRowRing; // "| 0" coerces to integer 

            
            const candidateNCol = qHomeCol + colOffset;
            const candidateNRow = qHomeRow + rowOffset;
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
                const length = gridCellStartOffsets[neighbourCell + 1] - start;
                if (length === 0) continue;
                this.qBatchOffset = start;
                return length;
            }
        }
        return 0
    }
}