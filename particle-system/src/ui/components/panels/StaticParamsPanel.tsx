import { useState } from "react";
import { Slider } from "../controls/Slider.tsx";
import { AppController } from "../../../app/app.ts";
import { RatioPicker } from "../controls/RatioPicker.tsx";

interface Props {
  controller: AppController;
}

export function StaticParamsPanel({ controller }: Props) {
    const [seed, setSeed] = useState(controller.simStaticParams.seed);
    const [particleCount, setParticleCount] = useState(controller.simStaticParams.particleCount);
    const [typeCount, setTypeCount] = useState(controller.simStaticParams.typeCount);
    const [ratio, setRatio] = useState(controller.simStaticParams.aspectRatio);
    const [spacing, setSpacing] = useState(controller.simStaticParams.spacing);


    function handleSeed(value: string | number) {
        setSeed(value);
    }
    function handleParticleCount(value: number) {
        setParticleCount(value);
    }
    function handleTypeCount(value: number) {
        setTypeCount(value);
    }
    function handleRatio(value: number) {
        setRatio(value)
    }
    function handleSpacing(value: number) {
        setSpacing(value)
    }
    function handleApply() {
        controller.simStaticParams.seed = seed;
        controller.simStaticParams.particleCount = particleCount;
        controller.simStaticParams.typeCount = typeCount;
        controller.simStaticParams.aspectRatio = ratio;
        controller.simStaticParams.spacing = spacing;

        controller.startSim();
    }

    return(
        <div>
            <h3>Static Parameters</h3>
            <label>Seed: <input type="text" value={seed} onChange={e => handleSeed(e.target.value)} /></label>
            <Slider label="Particles"    value={particleCount}    min={0} max={10000} step={1} onChange={handleParticleCount} />
            <Slider label="Types"    value={typeCount}    min={1} max={256} step={1} onChange={handleTypeCount} />
            <Slider label="Particle Spacing" value={spacing} min={10} max={100} step={1} onChange={handleSpacing} />
            <label>Map Shape: <RatioPicker value={ratio} onChange={handleRatio} /></label>
            <button onClick={handleApply}>Apply Changes</button>
        </div>
    )
}