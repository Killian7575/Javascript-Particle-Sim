import { useRef } from "react";
import { clamp } from "../../../core/util";
import "./RatioPicker.css"

interface Props {
    value: number;
    onChange: (value: number) => void;
}

const FRAME = 130;
const MIN_RATIO = 0.25, MAX_RATIO = 4;
const SNAP_RAD = 3 * Math.PI / 180;              // 3° band — tune to taste
const PRESETS = [1, 16/9, 9/16, 4/3, 3/4, 3/2];  // the ratios you offer

export function RatioPicker({ value, onChange }: Props) {
    const frameRef = useRef<HTMLDivElement>(null);
    const { w, h } = ratioToBox(value);
    const label = formatRatio(value);


    function ratioToBox(ratio: number) {
        return ratio >= 1
            ? { w: FRAME,         h: FRAME / ratio }
            : { w: FRAME * ratio, h: FRAME };
    }

    function updateFromPointer(e: React.PointerEvent<HTMLDivElement>) {
        const rect = frameRef.current!.getBoundingClientRect();
        const x = clamp(e.clientX - rect.left, 0, FRAME);
        const y = clamp(e.clientY - rect.top,  0, FRAME);
        const raw = clamp(x / Math.max(y, 1), MIN_RATIO, MAX_RATIO);
        onChange(snapRatio(raw));
    }

    function snapRatio(raw: number): number {
        const phi = Math.atan(1 / raw);
        for (const r of PRESETS) {
            if (Math.abs(phi - Math.atan(1 / r)) < SNAP_RAD) return r;
        }
        return raw;
    }
    function approxRatio(value: number, maxDenom = 20): [number, number] {
        let bestN = 1, bestD = 1, bestErr = Infinity;
        for (let d = 1; d <= maxDenom; d++) {
            const n = Math.round(value * d);
            const err = Math.abs(value - n / d);
            if (err < bestErr) { bestErr = err; bestN = n; bestD = d; }
        }
        return [bestN, bestD];
    }

    function formatRatio(value: number): string {
        const [n, d] = approxRatio(value);
        return `${n}:${d}`;
    }

    function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        e.currentTarget.setPointerCapture(e.pointerId);   // route all moves here until release
        updateFromPointer(e);
    }
    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (e.buttons === 0) return;   // pointermove also fires on plain hover — ignore unless a button is held
        updateFromPointer(e);
    }

    return (
        <div ref={frameRef} style={{ position: 'relative', width: FRAME, height: FRAME }} className="ratio-box"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} >
            <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h,
                          transform: 'translate(-2px, -2px)'
            }} className="ratio-rectangle" />{/* rectangle */}
            <div style={{ position: 'absolute', left: w, top: h, 
                          transform: 'translate(-50%, -50%)'}} className="ratio-handle" />{/* handle */}
            <div className="ratio-readout">{label}</div>
        </div>
    )
}