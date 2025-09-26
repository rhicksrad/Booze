import { axisBottom, axisLeft, extent, pointer, scaleBand, scaleLinear, select } from 'd3';
import type { DataModel, DataRecord } from '../lib/csv';
import { createChartShell, debounce, formatMonth } from '../lib/layout';
import { formatNumber, formatShare } from '../lib/scales';
import { createTooltip, type TooltipHandle } from '../lib/tooltip';
import type { Controls, ViewInstance } from './types';

interface HeatmapCell {
  year: number;
  month: number;
  value: number | null;
}

interface SeriesOption {
  key: string;
  label: string;
}

const defaultGroup = 'Litres of Beverage';
const defaultSeries = 'Beer';

const keyForLabel = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const buildSeriesLookup = (records: DataRecord[]): Map<string, SeriesOption[]> => {
  const lookup = new Map<string, Map<string, string>>();
  records.forEach((record) => {
    if (!lookup.has(record.groupLabel)) {
      lookup.set(record.groupLabel, new Map());
    }
    const inner = lookup.get(record.groupLabel);
    if (!inner) {
      return;
    }
    if (record.seriesLabel.trim().length > 0) {
      inner.set(record.seriesLabel, keyForLabel(record.seriesLabel));
    }
  });

  const result = new Map<string, SeriesOption[]>();
  lookup.forEach((inner, groupLabel) => {
    const options = Array.from(inner.keys())
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ key: keyForLabel(label), label }));
    result.set(groupLabel, options);
  });
  return result;
};

const prepareCells = (
  records: DataRecord[],
  groupLabel: string,
  seriesLabel: string,
  normalize: boolean,
): HeatmapCell[] => {
  const filtered = records.filter(
    (record) => record.groupLabel === groupLabel && record.seriesLabel === seriesLabel,
  );
  const byYear = new Map<number, Map<number, number>>();

  filtered.forEach((record) => {
    if (record.value === null) {
      return;
    }
    if (!byYear.has(record.year)) {
      byYear.set(record.year, new Map());
    }
    const inner = byYear.get(record.year);
    if (!inner) {
      return;
    }
    inner.set(record.month, (inner.get(record.month) ?? 0) + record.value);
  });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const months = [3, 6, 9, 12];
  const cells: HeatmapCell[] = [];
  years.forEach((year) => {
    const inner = byYear.get(year) ?? new Map();
    const total = Array.from(inner.values()).reduce((sum, value) => sum + value, 0);
    months.forEach((month) => {
      const value = inner.get(month) ?? null;
      if (normalize) {
        const share = total === 0 || value === null ? null : value / total;
        cells.push({ year, month, value: share });
      } else {
        cells.push({ year, month, value });
      }
    });
  });
  return cells;
};

export const createView = (): ViewInstance => {
  let shell: ReturnType<typeof createChartShell> | null = null;
  let tooltip: TooltipHandle | null = null;
  let model: DataModel | null = null;
  let resizeHandler: (() => void) | null = null;
  let selectedGroup = defaultGroup;
  let selectedSeries = defaultSeries;
  let normalize = false;
  let seriesLookup: Map<string, SeriesOption[]> = new Map();
  let cachedCells: HeatmapCell[] = [];
  let seriesSelect: HTMLSelectElement | null = null;

  const exportRows = () =>
    cachedCells.map((cell) => ({
      year: cell.year,
      month: cell.month,
      value: cell.value === null ? null : Number(cell.value.toFixed(normalize ? 4 : 3)),
    }));

  const render = () => {
    if (!shell || !model) {
      return;
    }
    cachedCells = prepareCells(model.records, selectedGroup, selectedSeries, normalize);
    if (!cachedCells.length) {
      return;
    }

    shell.updateSize();
    const dims = shell.getDimensions();
    const years = Array.from(new Set(cachedCells.map((cell) => cell.year))).sort((a, b) => a - b);
    const months = [3, 6, 9, 12];

    const x = scaleBand<number>().domain(months).range([0, dims.innerWidth]).padding(0.05);
    const y = scaleBand<number>().domain(years).range([dims.innerHeight, 0]).padding(0.05);

    const values = cachedCells.filter((cell) => cell.value !== null).map((cell) => cell.value ?? 0);
    let domain: [number, number];
    if (normalize) {
      domain = [0, 1];
    } else {
      const computed = extent(values) as [number | undefined, number | undefined];
      const minValue = computed[0] ?? 0;
      const maxValue = computed[1] ?? minValue + 1;
      domain = [minValue, maxValue === minValue ? minValue + 1 : maxValue];
    }

    const color = scaleLinear<string>().domain(domain).range(normalize ? ['#e0f2ff', '#1c7ed6'] : ['#f1faee', '#1d3557']);

    const plot = select(shell.plot);

    plot
      .selectAll('rect.cell')
      .data(cachedCells, (cell) => `${cell.year}-${cell.month}`)
      .join('rect')
      .attr('class', 'cell')
      .attr('x', (cell) => (x(cell.month) ?? 0))
      .attr('y', (cell) => (y(cell.year) ?? 0))
      .attr('width', x.bandwidth())
      .attr('height', y.bandwidth())
      .attr('fill', (cell) => (cell.value === null ? '#f8f9fa' : color(cell.value)))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 0.5)
      .on('mousemove', (event, cell) => {
        if (!tooltip || !shell) {
          return;
        }
        const [mouseX, mouseY] = pointer(event, shell.svg);
        tooltip.show(
          mouseX + 12,
          mouseY,
          `<div><strong>${cell.year} ${formatMonth(cell.month)}</strong></div><div>${
            cell.value === null
              ? 'No data'
              : normalize
              ? formatShare(cell.value)
              : `${formatNumber(cell.value, 1)} ${findUnits()}`
          }</div>`,
        );
      })
      .on('mouseleave', () => tooltip?.hide());

    select(shell.xAxis)
      .call(axisBottom(x).tickFormat((month) => formatMonth(month)))
      .selectAll('text')
      .style('text-anchor', 'middle');

    select(shell.yAxisLeft)
      .call(axisLeft(y).tickValues(years.filter((year, index) => index % 2 === 0)))
      .selectAll('text')
      .attr('dx', '-0.5em');
    select(shell.yAxisRight).selectAll('*').remove();

    const legend = select(shell.legend);
    legend.selectAll('*').remove();
    const [legendMin, legendMax] = color.domain() as [number, number];
    const legendGroup = legend.append('g');
    const steps = 6;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const value = legendMin + (legendMax - legendMin) * t;
      legendGroup
        .append('rect')
        .attr('x', i * (180 / steps))
        .attr('y', 0)
        .attr('width', 180 / steps)
        .attr('height', 12)
        .attr('fill', color(value));
    }
    legendGroup
      .append('text')
      .attr('x', 0)
      .attr('y', 28)
      .text(normalize ? '0%' : formatNumber(legendMin, 0));
    legendGroup
      .append('text')
      .attr('x', 180)
      .attr('y', 28)
      .attr('text-anchor', 'end')
      .text(normalize ? '100%' : formatNumber(legendMax, 0));
  };

  const findUnits = (): string => {
    if (!model) {
      return '';
    }
    const record = model.records.find(
      (item) => item.groupLabel === selectedGroup && item.seriesLabel === selectedSeries,
    );
    return record?.units ?? '';
  };

  return {
    init(container: HTMLElement, data: DataModel, controls: Controls) {
      model = data;
      shell = createChartShell(container, {
        ariaLabel: 'Seasonal heatmap by year and quarter',
      });
      tooltip = createTooltip(shell.svg);
      seriesLookup = buildSeriesLookup(model.records);
      if (!seriesLookup.has(selectedGroup)) {
        selectedGroup = Array.from(seriesLookup.keys())[0] ?? defaultGroup;
      }
      const seriesOptions = seriesLookup.get(selectedGroup) ?? [];
      if (!seriesOptions.some((option) => option.label === selectedSeries) && seriesOptions.length) {
        selectedSeries = seriesOptions[0].label;
      }

      controls.addSelect({
        id: 'seasonality-group',
        label: 'Group',
        options: Array.from(seriesLookup.keys())
          .sort((a, b) => a.localeCompare(b))
          .map((label) => ({ label, value: label })),
        value: selectedGroup,
        onChange: (value) => {
          selectedGroup = value;
          const options = seriesLookup.get(selectedGroup) ?? [];
          selectedSeries = options[0]?.label ?? selectedSeries;
          if (seriesSelect) {
            seriesSelect.innerHTML = '';
            options.forEach((option) => {
              const opt = document.createElement('option');
              opt.value = option.label;
              opt.textContent = option.label;
              seriesSelect?.append(opt);
            });
            seriesSelect.value = selectedSeries;
          }
          render();
          controls.setDownloads({
            filename: `seasonality-${keyForLabel(selectedGroup)}-${keyForLabel(selectedSeries)}`,
            csv: () => exportRows(),
            svg: () => shell?.svg ?? null,
          });
        },
      });

      seriesSelect = controls.addSelect({
        id: 'seasonality-series',
        label: 'Series',
        options: (seriesLookup.get(selectedGroup) ?? []).map((option) => ({
          label: option.label,
          value: option.label,
        })),
        value: selectedSeries,
        onChange: (value) => {
          selectedSeries = value;
          render();
          controls.setDownloads({
            filename: `seasonality-${keyForLabel(selectedGroup)}-${keyForLabel(selectedSeries)}`,
            csv: () => exportRows(),
            svg: () => shell?.svg ?? null,
          });
        },
      });

      controls.addToggle({
        id: 'seasonality-normalize',
        label: 'Normalize by year',
        value: normalize,
        onChange: (value) => {
          normalize = value;
          render();
          controls.setDownloads({
            filename: `seasonality-${keyForLabel(selectedGroup)}-${keyForLabel(selectedSeries)}-${
              value ? 'share' : 'value'
            }`,
            csv: () => exportRows(),
            svg: () => shell?.svg ?? null,
          });
        },
      });

      controls.setDownloads({
        filename: `seasonality-${keyForLabel(selectedGroup)}-${keyForLabel(selectedSeries)}`,
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
      cachedCells = [];
    },
  };
};
