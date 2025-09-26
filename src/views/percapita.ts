import {
  axisBottom,
  axisLeft,
  bisector,
  extent,
  line,
  max,
  pointer,
  scaleLinear,
  scaleTime,
  select,
} from 'd3';
import type { DataModel, DataRecord } from '../lib/csv';
import { createChartShell, debounce } from '../lib/layout';
import { createColorScale, formatNumber } from '../lib/scales';
import { createTooltip, type TooltipHandle } from '../lib/tooltip';
import type { Controls, ViewInstance } from './types';

interface SeriesPoint {
  date: Date;
  value: number | null;
}

interface SeriesData {
  key: string;
  label: string;
  values: SeriesPoint[];
}

const SERIES_LABELS = ['Beer Per Head', 'Wine Per Head', 'Spirits Per Head'];
const GROUP_LABEL = '(DISC) Volume & Volume Per Head';
const SMOOTH_WINDOW = 4;

const keyForLabel = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const collectSeries = (records: DataRecord[]): SeriesData[] => {
  const filtered = records.filter((record) => record.groupLabel === GROUP_LABEL);
  return SERIES_LABELS.map((label) => {
    const values = filtered
      .filter((record) => record.seriesLabel === label)
      .map((record) => ({ date: record.date, value: record.value }));
    values.sort((a, b) => a.date.getTime() - b.date.getTime());
    return { key: keyForLabel(label), label, values };
  });
};

const smoothValues = (values: SeriesPoint[], windowSize: number): SeriesPoint[] => {
  if (windowSize <= 1) {
    return values;
  }
  const result: SeriesPoint[] = values.map((point, index) => {
    const windowStart = Math.max(0, index - windowSize + 1);
    const window = values.slice(windowStart, index + 1).filter((item) => item.value !== null);
    if (window.length === 0) {
      return { ...point };
    }
    const average = window.reduce((sum, item) => sum + (item.value ?? 0), 0) / window.length;
    return { date: point.date, value: average };
  });
  return result;
};

interface CrossoverPoint {
  date: Date;
  labelA: string;
  labelB: string;
  value: number;
}

const findCrossovers = (series: SeriesData[]): CrossoverPoint[] => {
  const crossings: CrossoverPoint[] = [];
  for (let i = 0; i < series.length; i += 1) {
    for (let j = i + 1; j < series.length; j += 1) {
      const seriesA = series[i];
      const seriesB = series[j];
      for (let index = 1; index < seriesA.values.length; index += 1) {
        const prevA = seriesA.values[index - 1];
        const currA = seriesA.values[index];
        const prevB = seriesB.values[index - 1];
        const currB = seriesB.values[index];
        if (
          prevA.value === null ||
          currA.value === null ||
          prevB.value === null ||
          currB.value === null
        ) {
          continue;
        }
        const prevDiff = prevA.value - prevB.value;
        const currDiff = currA.value - currB.value;
        if (prevDiff === 0) {
          crossings.push({ date: prevA.date, labelA: seriesA.label, labelB: seriesB.label, value: prevA.value });
        } else if (prevDiff * currDiff < 0) {
          const totalDiff = Math.abs(prevDiff) + Math.abs(currDiff);
          const ratio = Math.abs(prevDiff) / totalDiff;
          const interpolatedTime = prevA.date.getTime() + (currA.date.getTime() - prevA.date.getTime()) * ratio;
          const value = prevA.value + (currA.value - prevA.value) * ratio;
          crossings.push({
            date: new Date(interpolatedTime),
            labelA: seriesA.label,
            labelB: seriesB.label,
            value,
          });
        }
      }
    }
  }
  return crossings;
};

export const createView = (): ViewInstance => {
  let shell: ReturnType<typeof createChartShell> | null = null;
  let tooltip: TooltipHandle | null = null;
  let model: DataModel | null = null;
  let smoothed = false;
  let resizeHandler: (() => void) | null = null;
  let cachedSeries: SeriesData[] = [];
  let crossovers: CrossoverPoint[] = [];

  const buildSeries = () => {
    if (!model) {
      return [];
    }
    const rawSeries = collectSeries(model.records);
    cachedSeries = rawSeries.map((series) => ({
      ...series,
      values: smoothed ? smoothValues(series.values, SMOOTH_WINDOW) : series.values,
    }));
    crossovers = findCrossovers(cachedSeries);
    return cachedSeries;
  };

  const exportRows = () => {
    if (!cachedSeries.length) {
      return [];
    }
    const rows: Record<string, string | number | null>[] = [];
    const length = cachedSeries[0].values.length;
    for (let index = 0; index < length; index += 1) {
      const date = cachedSeries[0].values[index]?.date ?? new Date();
      const row: Record<string, string | number | null> = {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
      };
      cachedSeries.forEach((series) => {
        const point = series.values[index];
        row[series.key] = point?.value !== null && point?.value !== undefined ? Number(point.value.toFixed(3)) : null;
      });
      rows.push(row);
    }
    return rows;
  };

  const render = () => {
    if (!shell) {
      return;
    }
    const series = buildSeries();
    if (!series.length) {
      return;
    }

    shell.updateSize();
    const dims = shell.getDimensions();
    const x = scaleTime()
      .domain(extent(series[0].values, (point) => point.date) as [Date, Date])
      .range([0, dims.innerWidth]);

    const allValues = series.flatMap((s) => s.values.map((point) => point.value ?? 0));
    const maxValue = max(allValues) ?? 1;
    const y = scaleLinear().domain([0, maxValue === 0 ? 1 : maxValue]).nice().range([dims.innerHeight, 0]);

    const color = createColorScale(series.map((item) => item.key));

    const plot = select(shell.plot);
    const svg = select(shell.svg);

    const lineGenerator = line<SeriesPoint>()
      .defined((d) => d.value !== null)
      .x((d) => x(d.date))
      .y((d) => y(d.value ?? 0));

    plot
      .selectAll('path.series-line')
      .data(series, (item: SeriesData) => item.key)
      .join('path')
      .attr('class', 'series-line')
      .attr('fill', 'none')
      .attr('stroke-width', 2.5)
      .attr('stroke', (d) => color(d.key))
      .attr('d', (d) => lineGenerator(d.values));

    const crossoverNodes = plot
      .selectAll('circle.crossover')
      .data(crossovers, (d) => `${d.labelA}-${d.labelB}-${d.date.toISOString()}`)
      .join('circle')
      .attr('class', 'crossover')
      .attr('r', 4)
      .attr('cx', (d) => x(d.date))
      .attr('cy', (d) => y(d.value))
      .attr('fill', '#f59f00')
      .attr('stroke', '#343a40')
      .attr('stroke-width', 1);

    crossoverNodes.each(function (datum) {
      select(this)
        .selectAll('title')
        .data([datum as CrossoverPoint])
        .join('title')
        .text((d) => `Crossover ${d.labelA} / ${d.labelB}`);
    });

    select(shell.xAxis)
      .call(axisBottom(x).ticks(8).tickSizeOuter(0))
      .selectAll('text')
      .attr('dy', '0.75em');

    select(shell.yAxisLeft).call(axisLeft(y).ticks(6));
    select(shell.yAxisRight).selectAll('*').remove();

    if (!tooltip) {
      tooltip = createTooltip(shell.svg);
    }

    svg
      .on('mousemove', (event) => {
        const [mouseX] = pointer(event, shell.svg);
        const xRelative = mouseX - shell.margin.left;
        if (xRelative < 0 || xRelative > dims.innerWidth) {
          tooltip?.hide();
          return;
        }
        const date = x.invert(xRelative);
        const bisect = bisector<SeriesPoint, Date>((d) => d.date).left;
        const index = bisect(series[0].values, date, 1);
        const pointA = series[0].values[index - 1];
        const pointB = series[0].values[index];
        const target =
          !pointB || date.getTime() - pointA.date.getTime() < pointB.date.getTime() - date.getTime()
            ? pointA
            : pointB;
        if (!target) {
          tooltip?.hide();
          return;
        }
        const effectiveIndex = Math.min(series[0].values.length - 1, Math.max(0, index - 1));
        const rows = series
          .map((item) => {
            const point = item.values[effectiveIndex];
            if (!point || point.value === null) {
              return `<div><strong>${item.label}:</strong> n/a</div>`;
            }
            return `<div><strong>${item.label}:</strong> ${formatNumber(point.value, 2)} L</div>`;
          })
          .join('');
        tooltip?.show(
          x(target.date) + shell.margin.left + 12,
          Math.max(16, y(maxValue) + 20),
          `<div><strong>${target.date.getFullYear()}</strong></div>${rows}`,
        );
      })
      .on('mouseleave', () => tooltip?.hide());
  };

  return {
    init(container: HTMLElement, data: DataModel, controls: Controls) {
      model = data;
      shell = createChartShell(container, {
        ariaLabel: 'Per-capita availability of beer, wine, and spirits',
      });
      tooltip = createTooltip(shell.svg);

      controls.addToggle({
        id: 'percapita-smoothing',
        label: 'Smooth (4q avg)',
        value: smoothed,
        onChange: (value) => {
          smoothed = value;
          render();
          controls.setDownloads({
            filename: value ? 'per-capita-smoothed' : 'per-capita-raw',
            csv: () => exportRows(),
            svg: () => shell?.svg ?? null,
          });
        },
      });

      controls.setDownloads({
        filename: 'per-capita-raw',
        csv: () => exportRows(),
        svg: () => shell?.svg ?? null,
      });

      const handleResize = debounce(render, 200);
      resizeHandler = () => handleResize();
      window.addEventListener('resize', resizeHandler);

      render();
    },
    destroy() {
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
      }
      shell = null;
      tooltip = null;
      model = null;
      cachedSeries = [];
      crossovers = [];
    },
  };
};
