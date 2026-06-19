import { useState } from "react";
import { Slider } from "../controls/Slider.tsx";
import { AppController } from "../../../app/app.ts";

interface Props {
  controller: AppController;
}

export function TunablesPanel({ controller }: Props) {
  const [speed, setSpeed] = useState(controller.simParams.speed);
  const [rMax, setRMax] = useState(controller.simParams.rMax);
  const [beta, setBeta] = useState(controller.simParams.beta);
  const [friction, setFriction] = useState(controller.simParams.friction);



  function handleSpeed(value: number) {
    setSpeed(value);
    controller.simParams.speed = value;
    controller.applyLiveParams("speed")
  }
  function handleRMax(value: number) {
    setRMax(value);
    controller.simParams.rMax = value;
    controller.applyLiveParams("rMax")
  }
  function handleBeta(value: number) {
    setBeta(value);
    controller.simParams.beta = value;
    controller.applyLiveParams("beta")
  }
  function handleFriction(value: number) {
    setFriction(value);
    controller.simParams.friction = value;
    controller.applyLiveParams("friction")
  }

  return (
    <div>
      <h3>Tunables</h3>
      <Slider label="Speed"    value={speed}    min={0} max={1} step={0.1} onChange={handleSpeed} />
      <Slider label="rMax"     value={rMax}     min={0} max={200} step={1} onChange={handleRMax} />
      <Slider label="Beta"     value={beta}     min={0} max={1} step={0.05} onChange={handleBeta} />
      <Slider label="Friction" value={friction} min={0} max={1} step={0.005} onChange={handleFriction} />
    </div>
  );
}