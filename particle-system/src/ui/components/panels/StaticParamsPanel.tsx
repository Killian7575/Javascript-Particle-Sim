import { useState } from "react";
import { Slider } from "../controls/Slider.tsx";
import { AppController } from "../../../app/app.ts";

interface Props {
  controller: AppController;
}

export function StaticParamsPanel({ controller }: Props) {
    const [seed, setSeed] = useState(controller.simParams.seed);
    const [particleCount, setParticleCount] = useState(controller.simParams.particleCount);
    const [typeCount, setTypeCount] = useState(controller.simParams.typeCount);


    function handleSeed(value: string | number) {
        setSeed(value);
    }
    function handleParticleCount(value: number) {
        setParticleCount(value);
    }
    function handleTypeCount(value: number) {
        setTypeCount(value);
    }
    function handleApply() {
        controller.simParams.seed = seed;
        controller.simParams.particleCount = particleCount;
        controller.simParams.typeCount = typeCount;

        controller.startSim();
    }

    return(
        <div>
            <h3>Static Parameters</h3>
            Seed <input type="text" value={seed} onChange={e => handleSeed(e.target.value)} />
            <Slider label="Particles"    value={particleCount}    min={0} max={10000} step={1} onChange={handleParticleCount} />
            <Slider label="Types"    value={typeCount}    min={1} max={256} step={1} onChange={handleTypeCount} />
            <button onClick={handleApply} >Apply Changes</button>
        </div>
    )
}