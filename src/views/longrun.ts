import {
  axisBottom,
  axisLeft,
  axisRight,
  area,
  bisector,
  extent,
  line,
  max,
  pointer,
  scaleLinear,
  scaleTime,
  select,
  stack,
  stackOffsetExpand,
  stackOrderNone,
} from 'd3';
import type { DataModel, DataRecord } from '../lib/csv';
import { createChartShell, debounce } from '../lib/layout';
import { createColorScale, formatNumber, formatShare } from '../lib/scales';
import { createTooltip, type TooltipHandle } from '../lib/tooltip';
import type { Controls, ViewInstance } from './types';

interface ChartSeries {
  key: string;
  label: string;
  values: { date: Date; value: number | null }[];
}

interface PointShare {
  date: Date;
  total: number;
  shares: Record<string, number>;
}

const SERIES_LABELS = ['Total beer', 'Total wine', 'Total spirits'];
const GROUP_LABELS = ['Litres of Beverage', 'Litres of Alcohol'] as const;

type GroupLabel = (typeof GROUP_LABELS)[number];

const keyForLabel = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const collectGroupData = (records: DataRecord[], groupLabel: GroupLabel) =>
  records.filter((record) => record.groupLabel === groupLabel);

const buildSeries = (
  records: DataRecord[],
  labels: string[],
): { series: ChartSeries[]; points: PointShare[] } => {
  const points = new Map<string, PointShare>();
  labels.forEach((label) => {
    records
      .filter((record) => record.seriesLabel === label)
      .forEach((record) => {
        const key = `${record.year}-${record.month}`;
        if (!points.has(key)) {
          points.set(key, {
            date: record.date,
            total: 0,
            shares: Object.fromEntries(labels.map((name) => [keyForLabel(name), 0])),
          });
        }
        const entry = points.get(key);
        if (!entry || record.value === null) {
          return;
        }
        entry.total += record.value;
        entry.shares[keyForLabel(record.seriesLabel)] = record.value;
      });
  });

  const orderedPoints = Array.from(points.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  orderedPoints.forEach((point) => {
    const total = point.total || 0;
    if (total === 0) {
      SERIES_LABELS.forEach((label) => {
        point.shares[keyForLabel(label)] = 0;
      });
      return;
    }
    SERIES_LABELS.forEach((label) => {
      const key = keyForLabel(label);
      point.shares[key] = point.shares[key] / total;
    });
  });

  const series = labels.map((label) => ({
    key: keyForLabel(label),
    label,
    values: orderedPoints.map((point) => ({
      date: point.date,
      value: point.total === 0 ? null : point.shares[keyForLabel(label)] * point.total,
    })),
  }));

  return { series, points: orderedPoints };
};

export const createView = (): ViewInstance => {
  let shell: ReturnType<typeof createChartShell> | null = null;
  let tooltip: TooltipHandle | null = null;
  let activeKeys = new Set(SERIES_LABELS.map((label) => keyForLabel(label)));
  let group: GroupLabel = 'Litres of Beverage';
  let resizeHandler: (() => void) | null = null;
  let model: DataModel | null = null;

  const createExportRows = (): Record<string, string | number | null>[] => {
    if (!model) {
      return [];
    }
    const filtered = collectGroupData(model.records, group);
    const { points } = buildSeries(filtered, SERIES_LABELS);
    return points.map((point) => {
      const row: Record<string, string | number | null> = {
        year: point.date.getFullYear(),
        month: point.date.getMonth() + 1,
        total_litres: Number(point.total.toFixed(3)),
      };
      SERIES_LABELS.forEach((label) => {
        const key = keyForLabel(label);
        if (!activeKeys.has(key)) {
          return;
        }
        row[`${key}_share`] = Number((point.shares[key] ?? 0).toFixed(4));
      });
      return row;
    });
  };

  const render = () => {
    if (!shell || !model) {
      return;
    }

    shell.updateSize();
    const filtered = collectGroupData(model.records, group);
    const { series, points } = buildSeries(filtered, SERIES_LABELS);
    const activeSeries = series.filter((item) => activeKeys.has(item.key));

    const stackData = stack<PointShare>()
      .keys(series.map((item) => item.key))
      .order(stackOrderNone)
      .offset(stackOffsetExpand)(points);

    const dims = shell.getDimensions();
    const x = scaleTime()
      .domain(extent(points, (point) => point.date) as [Date, Date])
      .range([0, dims.innerWidth]);

    const maxValue = max(activeSeries.flatMap((s) => s.values.map((v) => v.value ?? 0))) ?? 0;
    const y = scaleLinear()
      .domain([0, maxValue === 0 ? 1 : maxValue])
      .nice()
      .range([dims.innerHeight, 0]);

    const yShare = scaleLinear().domain([0, 1]).range([dims.innerHeight, 0]);

    const svg = select(shell.svg);
    const plot = select(shell.plot);
    const grid = select(shell.grid);

    grid.selectAll('*').remove();
    grid
      .append('g')
      .selectAll('line')
      .data(y.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', dims.innerWidth)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d));

    const shareStack = stackData.filter((layer) => activeKeys.has(layer.key as string));

    const areaGenerator = area<[number, number]>()
      .x((_, index) => x(points[index]?.date ?? new Date()))
      .y0((d) => yShare(d[0]))
      .y1((d) => yShare(d[1]));

    const color = createColorScale(SERIES_LABELS.map(keyForLabel));

    plot
      .selectAll('path.area-share')
      .data(shareStack, (layer: unknown) => (layer as { key: string }).key)
      .join('path')
      .attr('class', 'area-share')
      .attr('fill', (layer) => color((layer as { key: string }).key))
      .attr('opacity', 0.25)
      .attr('d', (layer) => areaGenerator(layer as [number, number][]));

    const lineGenerator = line<{ date: Date; value: number | null }>()
      .defined((d) => d.value !== null)
      .x((d) => x(d.date))
      .y((d) => y(d.value ?? 0));

    plot
      .selectAll('path.series-line')
      .data(activeSeries, (item) => item.key)
      .join('path')
      .attr('class', 'series-line')
      .attr('fill', 'none')
      .attr('stroke-width', 2.5)
      .attr('stroke', (d) => color(d.key))
      .attr('d', (d) => lineGenerator(d.values));

    select(shell.xAxis)
      .call(axisBottom(x).ticks(8).tickSizeOuter(0))
      .selectAll('text')
      .attr('dy', '0.75em');

    select(shell.yAxisLeft).call(axisLeft(y).ticks(6));
    select(shell.yAxisRight).call(axisRight(yShare).ticks(5).tickFormat((d) => `${Math.round(Number(d) * 100)}%`));

    const legend = select(shell.legend);
    legend.selectAll('*').remove();
    const legendItems = legend
      .selectAll('g')
      .data(SERIES_LABELS.map((label) => ({ label, key: keyForLabel(label) })))
      .join('g')
      .attr('transform', (_, index) => `translate(${index * 160},0)`)
      .style('cursor', 'pointer')
      .on('click', (_, datum) => {
        if (activeKeys.has(datum.key)) {
          if (activeKeys.size > 1) {
            activeKeys.delete(datum.key);
          }
        } else {
          activeKeys.add(datum.key);
        }
        render();
      });

    legendItems
      .append('rect')
      .attr('width', 18)
      .attr('height', 18)
      .attr('rx', 4)
      .attr('fill', (d) => (activeKeys.has(d.key) ? color(d.key) : '#ced4da'));

    legendItems
      .append('text')
      .attr('x', 24)
      .attr('y', 14)
      .text((d) => d.label);

    if (!tooltip && shell) {
      tooltip = createTooltip(shell.svg);
    }

    const pointerLine = plot
      .selectAll('line.pointer-line')
      .data([null])
      .join('line')
      .attr('class', 'pointer-line')
      .attr('stroke', '#adb5bd')
      .attr('stroke-dasharray', '4 4')
      .attr('y1', 0)
      .attr('y2', dims.innerHeight)
      .style('opacity', 0);

    select(shell.svg)
      .on('mousemove', (event) => {
        const [mouseX] = pointer(event, shell.svg);
        const xRelative = mouseX - shell.margin.left;
        if (xRelative < 0 || xRelative > dims.innerWidth) {
          tooltip?.hide();
          pointerLine.style('opacity', 0);
          return;
        }
        const date = x.invert(xRelative);
        const bisect = bisector<PointShare, Date>((d) => d.date).left;
        const index = bisect(points, date, 1);
        const pointA = points[index - 1];
        const pointB = points[index];
        const target =
          !pointB || date.getTime() - pointA.date.getTime() < pointB.date.getTime() - date.getTime()
            ? pointA
            : pointB;
        if (!target) {
          tooltip?.hide();
          pointerLine.style('opacity', 0);
          return;
        }
        const xPos = x(target.date);
        pointerLine.attr('x1', xPos).attr('x2', xPos).style('opacity', 1);
        const rows = SERIES_LABELS.filter((label) => activeKeys.has(keyForLabel(label)))
          .map((label) => {
            const key = keyForLabel(label);
            const share = target.shares[key] ?? 0;
            const value = target.total * share;
            return `<div><strong>${label}:</strong> ${formatNumber(value, 1)} L (${formatShare(share)})</div>`;
          })
          .join('');
        tooltip?.show(
          xPos + shell.margin.left + 12,
          Math.max(16, yShare(1) + 12),
          `<div><strong>${target.date.getFullYear()}</strong></div>${rows}<div><em>Total: ${formatNumber(
            target.total,
            1,
          )} L</em></div>`,
        );
      })
      .on('mouseleave', () => {
        tooltip?.hide();
        pointerLine.style('opacity', 0);
      });

    legendItems.append('title').text((d) => `Toggle ${d.label}`);
    pointerLine.append('title').text('Pointer reference line');
  };

  return {
    init(container: HTMLElement, data: DataModel, controls: Controls) {
      model = data;
      shell = createChartShell(container, {
        ariaLabel: 'Long-run litres and shares by beverage type',
      });
      tooltip = createTooltip(shell.svg);
      shell.svg
        .appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
        .appendChild(document.createTextNode('Move the pointer to inspect values'));

      controls.addSelect({
        id: 'group-select',
        label: 'Measurement group',
        options: GROUP_LABELS.map((label) => ({ label, value: label })),
        value: group,
        onChange: (value) => {
          group = value as GroupLabel;
          render();
          controls.setDownloads({
            filename: `long-run-${keyForLabel(group)}`,
            csv: () => createExportRows(),
            svg: () => shell?.svg ?? null,
          });
        },
      });

      controls.setDownloads({
        filename: `long-run-${keyForLabel(group)}`,
        csv: () => createExportRows(),
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
      model = null;
      tooltip = null;
      activeKeys = new Set(SERIES_LABELS.map((label) => keyForLabel(label)));
    },
  };
};
