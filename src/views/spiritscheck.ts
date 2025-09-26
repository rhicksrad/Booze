import {
  axisBottom,
  axisLeft,
  axisRight,
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

interface SpiritsPoint {
  date: Date;
  period: string;
  litres: number | null;
  proof: number | null;
  ratio: number | null;
}

const GROUP_LABEL = '(DISC) Volume & Volume Per Head';
const SERIES_LABEL = 'Spirits';
const SMOOTH_WINDOW = 4;

const smoothSeries = (values: (number | null)[], windowSize: number): (number | null)[] => {
  if (windowSize <= 1) {
    return values;
  }
  return values.map((value, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = values.slice(start, index + 1).filter((item): item is number => item !== null);
    if (!window.length) {
      return value;
    }
    const average = window.reduce((sum, item) => sum + item, 0) / window.length;
    return average;
  });
};

const preparePoints = (records: DataRecord[]): SpiritsPoint[] => {
  const relevant = records.filter((record) => record.groupLabel === GROUP_LABEL && record.seriesLabel === SERIES_LABEL);
  const byPeriod = new Map<string, SpiritsPoint>();

  relevant.forEach((record) => {
    if (!byPeriod.has(record.period)) {
      byPeriod.set(record.period, {
        date: record.date,
        period: record.period,
        litres: null,
        proof: null,
        ratio: null,
      });
    }
    const point = byPeriod.get(record.period);
    if (!point) {
      return;
    }
    if (record.units === 'Litres') {
      point.litres = record.value;
    } else if (record.units === 'ProofL') {
      point.proof = record.value;
    }
  });

  const points = Array.from(byPeriod.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  points.forEach((point) => {
    if (point.litres !== null && point.proof !== null && point.proof !== 0) {
      point.ratio = point.litres / point.proof;
    } else {
      point.ratio = null;
    }
  });
  return points;
};

export const createView = (): ViewInstance => {
  let shell: ReturnType<typeof createChartShell> | null = null;
  let tooltip: TooltipHandle | null = null;
  let model: DataModel | null = null;
  let resizeHandler: (() => void) | null = null;
  let smoothRatio = false;
  let points: SpiritsPoint[] = [];

  const exportRows = () =>
    points.map((point) => ({
      date: point.date.toISOString().slice(0, 10),
      litres: point.litres === null ? null : Number(point.litres.toFixed(3)),
      proof: point.proof === null ? null : Number(point.proof.toFixed(3)),
      ratio: point.ratio === null ? null : Number(point.ratio.toFixed(3)),
    }));

  const render = () => {
    if (!shell || !model) {
      return;
    }
    points = preparePoints(model.records);
    if (!points.length) {
      return;
    }

    shell.updateSize();

    const dims = shell.getDimensions();
    const x = scaleTime()
      .domain(extent(points, (point) => point.date) as [Date, Date])
      .range([0, dims.innerWidth]);

    const litresValues = points.map((point) => point.litres ?? 0);
    const maxLitres = max(litresValues) ?? 1;
    const yLeft = scaleLinear().domain([0, maxLitres]).nice().range([dims.innerHeight, 0]);

    const ratioValues = points.map((point) => point.ratio);
    const smoothedRatios = smoothRatio ? smoothSeries(ratioValues, SMOOTH_WINDOW) : ratioValues;
    const ratioMax = max(smoothedRatios.filter((value): value is number => value !== null)) ?? 1;
    const yRight = scaleLinear().domain([0, ratioMax === 0 ? 1 : ratioMax]).nice().range([dims.innerHeight, 0]);

    const color = createColorScale(['litres', 'proof', 'ratio']);
    const plot = select(shell.plot);

    const litresLine = line<SpiritsPoint>()
      .defined((point) => point.litres !== null)
      .x((point) => x(point.date))
      .y((point) => yLeft(point.litres ?? 0));
    const proofLine = line<SpiritsPoint>()
      .defined((point) => point.proof !== null)
      .x((point) => x(point.date))
      .y((point) => yLeft(point.proof ?? 0));
    const ratioLine = line<number | null>()
      .defined((value) => value !== null)
      .x((_, index) => x(points[index]?.date ?? new Date()))
      .y((value) => yRight(value ?? 0));

    plot
      .selectAll('path.litres-line')
      .data([points])
      .join('path')
      .attr('class', 'litres-line')
      .attr('fill', 'none')
      .attr('stroke-width', 2.5)
      .attr('stroke', color('litres'))
      .attr('d', (data) => litresLine(data));

    plot
      .selectAll('path.proof-line')
      .data([points])
      .join('path')
      .attr('class', 'proof-line')
      .attr('fill', 'none')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 4')
      .attr('stroke', color('proof'))
      .attr('d', (data) => proofLine(data));

    plot
      .selectAll('path.ratio-line')
      .data([smoothedRatios])
      .join('path')
      .attr('class', 'ratio-line')
      .attr('fill', 'none')
      .attr('stroke-width', 2.5)
      .attr('stroke', color('ratio'))
      .attr('d', (data) => ratioLine(data));

    select(shell.xAxis)
      .call(axisBottom(x).ticks(10).tickSizeOuter(0))
      .selectAll('text')
      .attr('dy', '0.75em');

    select(shell.yAxisLeft).call(axisLeft(yLeft).ticks(6));
    select(shell.yAxisRight).call(axisRight(yRight).ticks(6));

    if (!tooltip) {
      tooltip = createTooltip(shell.svg);
    }

    select(shell.svg)
      .on('mousemove', (event) => {
        const [mouseX] = pointer(event, shell.svg);
        const xRelative = mouseX - shell.margin.left;
        if (xRelative < 0 || xRelative > dims.innerWidth) {
          tooltip?.hide();
          return;
        }
        const date = x.invert(xRelative);
        const bisect = bisector<SpiritsPoint, Date>((point) => point.date).left;
        const index = bisect(points, date, 1);
        const pointA = points[index - 1];
        const pointB = points[index];
        const target =
          !pointB || date.getTime() - pointA.date.getTime() < pointB.date.getTime() - date.getTime()
            ? pointA
            : pointB;
        if (!target) {
          tooltip?.hide();
          return;
        }
        const effectiveIndex = Math.min(points.length - 1, Math.max(0, index - 1));
        const ratioValue = smoothedRatios[effectiveIndex] ?? target.ratio;
        tooltip?.show(
          x(target.date) + shell.margin.left + 12,
          Math.max(16, yLeft(maxLitres) + 20),
          `<div><strong>${target.date.getFullYear()} Q${Math.round((target.date.getMonth() + 1) / 3)}</strong></div>
          <div>Litres: ${target.litres !== null ? formatNumber(target.litres, 1) : 'n/a'}</div>
          <div>Proof litres: ${target.proof !== null ? formatNumber(target.proof, 2) : 'n/a'}</div>
          <div>Ratio (L / ProofL): ${ratioValue !== null ? formatNumber(ratioValue, 2) : 'n/a'}</div>`,
        );
      })
      .on('mouseleave', () => tooltip?.hide());

    const legend = select(shell.legend);
    legend.selectAll('*').remove();
    const entries = [
      { key: 'litres', label: 'Litres' },
      { key: 'proof', label: 'Proof litres' },
      { key: 'ratio', label: 'Ratio (L/ProofL)' },
    ];
    legend
      .selectAll('g')
      .data(entries)
      .join('g')
      .attr('transform', (_, index) => `translate(${index * 180},0)`)
      .each(function (entry) {
        const group = select(this);
        group
          .append('rect')
          .attr('width', 18)
          .attr('height', 18)
          .attr('rx', 4)
          .attr('fill', color(entry.key));
        group
          .append('text')
          .attr('x', 24)
          .attr('y', 14)
          .text(entry.label);
      });
  };

  return {
    init(container: HTMLElement, data: DataModel, controls: Controls) {
      model = data;
      shell = createChartShell(container, {
        ariaLabel: 'Spirits litres versus proof litres comparison',
      });
      tooltip = createTooltip(shell.svg);

      controls.addToggle({
        id: 'spirits-smooth',
        label: 'Smooth ratio (4q)',
        value: smoothRatio,
        onChange: (value) => {
          smoothRatio = value;
          render();
          controls.setDownloads({
            filename: `spirits-check-${value ? 'smooth' : 'raw'}`,
            csv: () => exportRows(),
            svg: () => shell?.svg ?? null,
          });
        },
      });

      controls.setDownloads({
        filename: 'spirits-check-raw',
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
      points = [];
    },
  };
};
