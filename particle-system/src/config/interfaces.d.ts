// shared interfaces

interface Config {
  seed: number | string;
  particleCount: number;
  typeCount: number;
  simWidth: number;
  simHeight: number;
}
interface FullConfig extends Config {
  speed: number;
  rMax: number;
  beta: number;
  friction: number;
  rules: Float64Array;
}
type SimParameter = "all" | "simSize" | "speed" | "rMax" | "beta" | "friction" | "rules"