import { useState } from "react";
import { Slider } from "../controls/Slider.tsx";
import { AppController } from "../../../app/app.ts";
import { Selector } from "../controls/Selector.tsx";

interface Props {
  controller: AppController;
}

export function TunablesPanel({ controller }: Props) {
  const [speed, setSpeed] = useState(controller.simLiveParams.speed);
  const [rMax, setRMax] = useState(controller.simLiveParams.typeRMax[0]);
  const [beta, setBeta] = useState(controller.simLiveParams.typeBeta[0]);
  const [friction, setFriction] = useState(controller.simLiveParams.friction);
  const [boundary, setBoundary] = useState(controller.simLiveParams.boundaryMode);
  const [maxAccel, setMaxAccel] = useState(controller.simLiveParams.maxAccel);


  function handleSpeed(value: number) {
    setSpeed(value);
    controller.simLiveParams.speed = value;
    controller.applyLiveParams("speed")
  }
  function handleRMax(value: number) {
    setRMax(value);
    controller.simLiveParams.typeRMax.fill(value);
    controller.applyLiveParams("rMax")
  }
  function handleBeta(value: number) {
    setBeta(value);
    controller.simLiveParams.typeBeta.fill(value);
    controller.applyLiveParams("beta")
  }
  function handleFriction(value: number) {
    setFriction(value);
    controller.simLiveParams.friction = value;
    controller.applyLiveParams("friction")
  }
  function handleBoundary(value: BoundaryMode) {
    setBoundary(value);
    controller.simLiveParams.boundaryMode = value;
    controller.applyLiveParams("boundary")
  }
  function handleMaxVel(value: number) {
    setMaxAccel(value);
    controller.simLiveParams.maxAccel = value;
    controller.applyLiveParams("maxAccel");
  }

  return (
    <div>
      <h3>Tunables</h3>
      <Slider label="Speed"         value={speed}    min={0} max={1} step={0.1} onChange={handleSpeed} />
      <Slider label="rMax"          value={rMax}     min={0} max={200} step={1} onChange={handleRMax} />
      <Slider label="Beta"          value={beta}     min={0} max={1} step={0.05} onChange={handleBeta} />
      <Slider label="Friction"      value={friction} min={0} max={1} step={0.005} onChange={handleFriction} />
      <Slider label="Max Accel"  value={maxAccel}   min={0} max={100} step={1} onChange={handleMaxVel} />
      <Selector label="Border Mode" value={boundary}
        choices={["WRAP", "BOUNCE", "SNAP"]} names={["Wrap", "Bounce", "Snap"]}
        onChange={handleBoundary} />
    </div>
  );
}