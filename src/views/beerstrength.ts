import {
  axisBottom,
  axisLeft,
  max,
  pointer,
  scaleBand,
  scaleLinear,
  select,
  stack,
} from 'd3';
import type { DataModel, DataRecord } from '../lib/csv';
import { createChartShell, debounce } from '../lib/layout';
import { createColorScale, formatNumber, formatShare } from '../lib/scales';
import { createTooltip, type TooltipHandle } from '../lib/tooltip';
import type { Controls, ViewInstance } from './types';

interface AggregatedBar {
  key: string;
  label: string;
  total: number;
  values: Record<string, number>;
}

const CATEGORY_LABELS = [
  'Beer containing not more than 1.150% alcohol',
  'Beer containing between 1.151% and 2.500% alc',
  'Beer containing between 2.501% and 4.350% alc',
  'Beer containing between 4.351% and 5.000% alc',
  'Beer containing more than 5.00% alcohol',
];

const GROUP_LABEL = 'Litres of Beverage';

const keyForLabel = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const aggregateRecords = (
  records: DataRecord[],
  byDecade: boolean,
  share: boolean,
  activeKeys: Set<string>,
): AggregatedBar[] => {
  const filtered = records.filter((record) => record.groupLabel === GROUP_LABEL);
  const bars = new Map<string, AggregatedBar>();

  filtered.forEach((record) => {
    if (!CATEGORY_LABELS.includes(record.seriesLabel) || record.value === null) {
      return;
    }
    const categoryKey = keyForLabel(record.seriesLabel);
    if (!activeKeys.has(categoryKey)) {
      return;
    }
    const groupKey = byDecade ? `${Math.floor(record.year / 10) * 10}s` : `${record.year}`;
    if (!bars.has(groupKey)) {
      bars.set(groupKey, {
        key: groupKey,
        label: byDecade ? `${groupKey.slice(0, -1)}-${Number(groupKey.slice(0, -1)) + 9}` : groupKey,
        total: 0,
        values: Object.fromEntries(CATEGORY_LABELS.map((label) => [keyForLabel(label), 0])),
      });
    }
    const bar = bars.get(groupKey);
    if (!bar) {
      return;
    }
    bar.total += record.value;
    bar.values[categoryKey] += record.value;
  });

  const ordered = Array.from(bars.values()).sort((a, b) => a.key.localeCompare(b.key));

  if (share) {
    ordered.forEach((bar) => {
      const total = bar.total || 1;
      Object.keys(bar.values).forEach((key) => {
        bar.values[key] = bar.values[key] / total;
      });
      bar.total = 1;
    });
  }

  return ordered;
};

export const createView = (): ViewInstance => {
  let shell: ReturnType<typeof createChartShell> | null = null;
  let tooltip: TooltipHandle | null = null;
  let model: DataModel | null = null;
  let resizeHandler: (() => void) | null = null;
  let byDecade = false;
  let asShare = false;
  let activeKeys = new Set(CATEGORY_LABELS.map((label) => keyForLabel(label)));

  const exportRows = () => {
    if (!model) {
      return [];
    }
    const bars = aggregateRecords(model.records, byDecade, asShare, activeKeys);
    return bars.map((bar) => {
      const row: Record<string, string | number> = {
        period: bar.label,
        total: Number(bar.total.toFixed(asShare ? 4 : 3)),
      };
      CATEGORY_LABELS.forEach((label) => {
        const key = keyForLabel(label);
        if (!activeKeys.has(key)) {
          return;
        }
        row[key] = Number(bar.values[key].toFixed(asShare ? 4 : 3));
      });
      return row;
    });
  };

  const updateDownloads = () => {
    const suffix = `${byDecade ? 'decade' : 'year'}-${asShare ? 'share' : 'litres'}`;
    controls.setDownloads({
      filename: `beer-strength-${suffix}`,
      csv: () => exportRows(),
      svg: () => shell?.svg ?? null,
    });
  };

  const render = () => {
    if (!shell || !model) {
      return;
    }

    shell.updateSize();

    const bars = aggregateRecords(model.records, byDecade, asShare, activeKeys);
    if (!bars.length) {
      return;
    }

    const keys = CATEGORY_LABELS.map((label) => keyForLabel(label)).filter((key) => activeKeys.has(key));
    const stackGenerator = stack<AggregatedBar>().keys(keys);
    const stacked = stackGenerator(bars.map((bar) => bar.values));

    const dims = shell.getDimensions();
    const x = scaleBand()
      .domain(bars.map((bar) => bar.label))
      .range([0, dims.innerWidth])
      .padding(0.2);

    const maxValue = asShare
      ? 1
      : max(bars.map((bar) => Object.values(bar.values).reduce((sum, value) => sum + value, 0))) ?? 1;
    const y = scaleLinear().domain([0, maxValue]).nice().range([dims.innerHeight, 0]);

    const color = createColorScale(keys);
    const plot = select(shell.plot);

    const groups = plot
      .selectAll('g.bar-group')
      .data(stacked, (layer: unknown) => (layer as { key: string }).key)
      .join('g')
      .attr('class', 'bar-group')
      .attr('fill', (layer) => color((layer as { key: string }).key));

    groups
      .selectAll('rect')
      .data((layer, layerIndex) =>
        (layer as unknown as [number, number][]).map((segment, index) => ({
          segment,
          index,
          category: keys[layerIndex],
          bar: bars[index],
        })),
      )
      .join('rect')
      .attr('x', (d) => (x(d.bar.label) ?? 0))
      .attr('width', x.bandwidth())
      .attr('y', (d) => y(d.segment[1]))
      .attr('height', (d) => y(d.segment[0]) - y(d.segment[1]))
      .on('mousemove', function (event, datum) {
        if (!tooltip || !shell) {
          return;
        }
        const [mouseX, mouseY] = pointer(event, shell.svg);
        const value = datum.segment[1] - datum.segment[0];
        tooltip.show(
          mouseX + 12,
          mouseY,
          `<div><strong>${datum.bar.label}</strong></div><div>${
            CATEGORY_LABELS.find((label) => keyForLabel(label) === datum.category) ?? datum.category
          }: ${asShare ? formatShare(value) : `${formatNumber(value, 1)} L`}</div>`,
        );
      })
      .on('mouseleave', () => tooltip?.hide());

    select(shell.xAxis)
      .call(axisBottom(x))
      .selectAll('text')
      .attr('dx', '-0.6em')
      .attr('dy', '0.15em')
      .attr('transform', 'rotate(-35)')
      .style('text-anchor', 'end');

    select(shell.yAxisLeft).call(axisLeft(y).ticks(asShare ? 5 : 6).tickFormat((d) => (asShare ? `${Math.round(Number(d) * 100)}%` : formatNumber(Number(d), 0))));
    select(shell.yAxisRight).selectAll('*').remove();

    const legend = select(shell.legend);
    legend.selectAll('*').remove();
    const legendItems = legend
      .selectAll('g')
      .data(CATEGORY_LABELS.map((label) => ({ label, key: keyForLabel(label) })))
      .join('g')
      .attr('transform', (_, index) => `translate(${index * 180},0)`)
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
  };

  return {
    init(container: HTMLElement, data: DataModel, controls: Controls) {
      model = data;
      shell = createChartShell(container, {
        ariaLabel: 'Beer strength composition stacked bars',
      });
      tooltip = createTooltip(shell.svg);

      controls.addToggle({
        id: 'beerstrength-decade',
        label: 'Aggregate by decade',
        value: byDecade,
        onChange: (value) => {
          byDecade = value;
          render();
          updateDownloads();
        },
      });

      controls.addToggle({
        id: 'beerstrength-share',
        label: 'Show shares',
        value: asShare,
        onChange: (value) => {
          asShare = value;
          render();
          updateDownloads();
        },
      });

      updateDownloads();

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
      activeKeys = new Set(CATEGORY_LABELS.map((label) => keyForLabel(label)));
    },
  };
};
