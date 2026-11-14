// Charts (هوية 4 › Charts): small SVG and HTML charts with no library, drawn in the series colours
// chart-1 … chart-6, readable in both themes, explorable by pointer, touch and keyboard.
export { AreaChart, LineChart, type TrendChartProps } from './TrendChart';
export { BarChart, type BarChartProps } from './BarChart';
export { ShareBar, type ShareBarProps, type SharePart } from './ShareBar';
export { Sparkline, type SparklineProps } from './Sparkline';
export type { ChartSeries } from './parts';
export type { ChartTone } from './palette';
export { compactNumber, formatShare } from './format';
