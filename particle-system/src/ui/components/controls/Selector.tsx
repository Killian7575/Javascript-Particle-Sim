interface Props {
  label: string;
  value: any;
  choices: any[]
  names: string[];
  onChange: (value: any) => void;
}

export function Selector({ label, value, choices, names, onChange }: Props) {
  return (
    <div className="control-row">
      <label>{label}
        <select onChange={e => onChange(e.target.value)} value={value}>
          {choices.map((c, i) => <option key={c} value={c}>{names[i]}</option>)}
        </select>
      </label>
    </div>
  );
}