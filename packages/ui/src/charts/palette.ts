/**
 * The series colours (هوية 4 › Charts): chart-1 … chart-6 in this fixed order, never cycled and
 * never generated; status colours are never series. Whole class names, so Tailwind finds them.
 */
export interface SeriesTone {
  fill: string;
  stroke: string;
  bg: string;
  text: string;
}

/** A series' slot in the fixed order: 1 is the brand emerald. */
export type ChartTone = 1 | 2 | 3 | 4 | 5 | 6;

export const SERIES_TONES: readonly SeriesTone[] = [
  { fill: 'fill-chart-1', stroke: 'stroke-chart-1', bg: 'bg-chart-1', text: 'text-chart-1' },
  { fill: 'fill-chart-2', stroke: 'stroke-chart-2', bg: 'bg-chart-2', text: 'text-chart-2' },
  { fill: 'fill-chart-3', stroke: 'stroke-chart-3', bg: 'bg-chart-3', text: 'text-chart-3' },
  { fill: 'fill-chart-4', stroke: 'stroke-chart-4', bg: 'bg-chart-4', text: 'text-chart-4' },
  { fill: 'fill-chart-5', stroke: 'stroke-chart-5', bg: 'bg-chart-5', text: 'text-chart-5' },
  { fill: 'fill-chart-6', stroke: 'stroke-chart-6', bg: 'bg-chart-6', text: 'text-chart-6' },
];

/** At most six series: fold the rest into «أخرى» or split the chart (choosing-a-form › ladder). */
export const MAX_SERIES = SERIES_TONES.length;

/** «أخرى», the folded tail of a whole: the quiet neutral, never a seventh hue. */
export const OTHER_TONE: SeriesTone = {
  fill: 'fill-ink-subtle',
  stroke: 'stroke-ink-subtle',
  bg: 'bg-ink-subtle',
  text: 'text-ink-subtle',
};

/** The colour of the series at `index`, or of the slot it asks for (so it keeps it when others hide). */
export function toneOf(tone: ChartTone | undefined, index: number): SeriesTone {
  return SERIES_TONES[(tone ?? index + 1) - 1] ?? OTHER_TONE;
}
