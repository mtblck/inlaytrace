import { useId, type ReactNode } from "react";
import {
  PRESETS,
  presetById,
  usesShapes,
  type PresetId,
  type Settings,
} from "../engine/presets";

type Props = {
  settings: Settings;
  onChange: (next: Settings) => void;
  onPreset: (id: PresetId) => void;
};

export function Controls({ settings, onChange, onPreset }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });
  const p = settings.preset;
  const defaults = presetById(p).defaults;
  const changed = (Object.keys(defaults) as (keyof typeof defaults)[]).some(
    (k) => defaults[k] !== settings[k],
  );

  return (
    <>
      <Section title="What is it?">
        <div
          role="radiogroup"
          aria-label="Image type"
          className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule"
        >
          {PRESETS.map((preset) => {
            const active = preset.id === p;
            return (
              <button
                key={preset.id}
                role="radio"
                aria-checked={active}
                onClick={() => onPreset(preset.id)}
                className={`flex items-baseline justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  active ? "bg-paper" : "bg-paper-sunk hover:bg-paper"
                }`}
              >
                <span
                  className={`text-[13.5px] font-medium whitespace-nowrap ${active ? "text-accent" : "text-ink"}`}
                >
                  {preset.label}
                </span>
                <span className="field-hint truncate text-right">
                  {preset.hint}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Adjust"
        action={
          changed && (
            <button
              className="text-[12.5px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => onPreset(p)}
            >
              Reset
            </button>
          )
        }
      >
        <div className="space-y-4">
          {p !== "lineart" && (
            <Slider
              label="Colours"
              value={settings.colors}
              min={2}
              max={64}
              step={1}
              onChange={(v) => set("colors", v)}
              format={(v) => `${v}`}
              hint="Fewer means a smaller file. If two colours merge into one, raise this."
            />
          )}

          {p === "lineart" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="field-label">Ink is</span>
                <div
                  role="radiogroup"
                  aria-label="Ink is"
                  className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule"
                >
                  {([false, true] as const).map((light) => (
                    <button
                      key={String(light)}
                      role="radio"
                      aria-checked={settings.lightInk === light}
                      onClick={() => set("lightInk", light)}
                      className={`py-1.5 text-[13px] ${settings.lightInk === light ? "bg-paper font-medium text-accent" : "bg-paper-sunk text-ink hover:bg-paper"}`}
                    >
                      {light ? "Light on dark" : "Dark on light"}
                    </button>
                  ))}
                </div>
                <p className="field-hint">
                  Which part of the image to keep. The rest becomes transparent.
                </p>
              </div>
              {settings.threshold !== null && (
                <Slider
                  label="Ink threshold"
                  value={settings.threshold}
                  min={1}
                  max={254}
                  step={1}
                  onChange={(v) => set("threshold", v)}
                  format={(v) => `${v}`}
                  hint="Move it to catch fainter strokes or drop stray ones."
                />
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-[var(--c-accent)]"
                  checked={settings.threshold === null}
                  onChange={(e) =>
                    set("threshold", e.target.checked ? null : 128)
                  }
                />
                Adapt to uneven lighting (photos of paper)
              </label>
            </div>
          )}

          <Slider
            label="Ignore specks"
            value={settings.speckle}
            min={0}
            max={32}
            step={1}
            onChange={(v) => set("speckle", v)}
            format={(v) => (v === 0 ? "Off" : `${v} px`)}
            hint="Drops shapes smaller than this. Raise it for noisy scans."
          />

          {p !== "pixel" && (
            <>
              <Slider
                label="Smoothing"
                value={settings.smoothing}
                min={0}
                max={3}
                step={0.25}
                onChange={(v) => set("smoothing", v)}
                format={(v) => (v === 0 ? "Off" : v.toFixed(2))}
                hint="How loosely the outline is followed. Higher means fewer nodes and a smaller file."
              />
              <Slider
                label="Corners"
                value={settings.corners}
                min={0}
                max={180}
                step={5}
                onChange={(v) => set("corners", v)}
                format={(v) => `${v}°`}
                hint="Bends sharper than this stay corners; gentler ones become curves."
              />
            </>
          )}

          {/* Flat-art presets always share edges exactly (no gaps, no overlaps), so there is nothing to choose. */}
          {!usesShapes(p) && (
            <div className="space-y-1.5">
              <span className="field-label">Shapes</span>
              <div
                role="radiogroup"
                aria-label="Shapes"
                className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule"
              >
                {(["stacked", "cutout"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={settings.shapes === v}
                    onClick={() => set("shapes", v)}
                    className={`py-1.5 text-[13px] ${settings.shapes === v ? "bg-paper font-medium text-accent" : "bg-paper-sunk text-ink hover:bg-paper"}`}
                  >
                    {v === "stacked" ? "Stacked" : "Cut out"}
                  </button>
                ))}
              </div>
              <p className="field-hint">
                {settings.shapes === "stacked"
                  ? "Shapes sit on top of each other. Smallest files."
                  : "No shape overlaps another. Use for vinyl cutting and screen print layers."}
              </p>
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-rule px-5 py-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="field-label">
          {props.label}
        </label>
        <output htmlFor={id} className="num">
          {props.format(props.value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <p id={`${id}-hint`} className="field-hint">
        {props.hint}
      </p>
    </div>
  );
}
