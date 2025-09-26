export interface NavItem {
  id: string;
  title: string;
  summary: string;
}

export interface LayoutElements {
  root: HTMLElement;
  nav: HTMLElement;
  summary: HTMLElement;
  controls: HTMLElement;
  downloads: HTMLElement;
  chart: HTMLElement;
}

export interface LayoutContext extends LayoutElements {
  setActive: (id: string) => void;
}

export interface ChartShellOptions {
  margin?: { top: number; right: number; bottom: number; left: number };
  ariaLabel?: string;
}

export interface ChartShell {
  svg: SVGSVGElement;
  plot: SVGGElement;
  legend: SVGGElement;
  xAxis: SVGGElement;
  yAxisLeft: SVGGElement;
  yAxisRight: SVGGElement;
  grid: SVGGElement;
  margin: { top: number; right: number; bottom: number; left: number };
  getDimensions: () => {
    width: number;
    height: number;
    innerWidth: number;
    innerHeight: number;
  };
  updateSize: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const defaultMargin = { top: 56, right: 56, bottom: 48, left: 64 };

export const initLayout = (
  container: HTMLElement,
  items: NavItem[],
  onSelect: (id: string) => void,
): LayoutContext => {
  const app = document.createElement('div');
  app.className = 'app';

  const sidebar = document.createElement('aside');
  sidebar.className = 'app-sidebar';
  const navList = document.createElement('nav');
  navList.setAttribute('aria-label', 'Views');

  const navButtons = new Map<string, HTMLButtonElement>();
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-nav-button';
    button.textContent = item.title;
    button.setAttribute('aria-controls', `view-${item.id}`);
    button.addEventListener('click', () => {
      onSelect(item.id);
      setActive(item.id);
    });
    if (index === 0) {
      button.classList.add('is-active');
    }
    navButtons.set(item.id, button);
    navList.append(button);
  });

  sidebar.append(navList);

  const main = document.createElement('main');
  main.className = 'app-main';
  main.id = 'main-content';

  const header = document.createElement('header');
  header.className = 'view-header';
  const summary = document.createElement('p');
  summary.className = 'view-summary';
  header.append(summary);

  const controls = document.createElement('div');
  controls.className = 'view-controls';

  const downloads = document.createElement('div');
  downloads.className = 'view-downloads';

  const chart = document.createElement('div');
  chart.className = 'view-chart';
  chart.id = 'chart-root';

  main.append(header, controls, downloads, chart);
  app.append(sidebar, main);
  container.append(app);

  const setActive = (id: string): void => {
    navButtons.forEach((button, buttonId) => {
      if (buttonId === id) {
        button.classList.add('is-active');
        button.setAttribute('aria-current', 'page');
      } else {
        button.classList.remove('is-active');
        button.removeAttribute('aria-current');
      }
    });
  };

  return {
    root: app,
    nav: navList,
    summary,
    controls,
    downloads,
    chart,
    setActive,
  };
};

export const createChartShell = (
  container: HTMLElement,
  options?: ChartShellOptions,
): ChartShell => {
  const margin = { ...defaultMargin, ...(options?.margin ?? {}) };

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('tabindex', '0');
  if (options?.ariaLabel) {
    svg.setAttribute('aria-label', options.ariaLabel);
  }
  svg.classList.add('chart-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = '100%';

  const plot = document.createElementNS(SVG_NS, 'g');
  const legend = document.createElementNS(SVG_NS, 'g');
  legend.setAttribute('class', 'chart-legend');
  const grid = document.createElementNS(SVG_NS, 'g');
  grid.setAttribute('class', 'chart-grid');
  const xAxis = document.createElementNS(SVG_NS, 'g');
  xAxis.setAttribute('class', 'chart-axis chart-axis--x');
  const yAxisLeft = document.createElementNS(SVG_NS, 'g');
  yAxisLeft.setAttribute('class', 'chart-axis chart-axis--y-left');
  const yAxisRight = document.createElementNS(SVG_NS, 'g');
  yAxisRight.setAttribute('class', 'chart-axis chart-axis--y-right');

  svg.append(legend, grid, plot, xAxis, yAxisLeft, yAxisRight);
  container.innerHTML = '';
  container.append(svg);

  const dimensions = {
    width: 960,
    height: 520,
    innerWidth: 960 - margin.left - margin.right,
    innerHeight: 520 - margin.top - margin.bottom,
  };

  const updateSize = (): void => {
    const bounds = container.getBoundingClientRect();
    const width = bounds.width > 0 ? bounds.width : dimensions.width;
    const height = (width * 9) / 16;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    dimensions.width = width;
    dimensions.height = height;
    dimensions.innerWidth = width - margin.left - margin.right;
    dimensions.innerHeight = height - margin.top - margin.bottom;
    plot.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    grid.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    xAxis.setAttribute('transform', `translate(${margin.left},${height - margin.bottom})`);
    yAxisLeft.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    yAxisRight.setAttribute(
      'transform',
      `translate(${width - margin.right},${margin.top})`,
    );
    legend.setAttribute('transform', `translate(${margin.left},${margin.top - 32})`);
  };

  updateSize();

  return {
    svg,
    plot,
    legend,
    xAxis,
    yAxisLeft,
    yAxisRight,
    grid,
    margin,
    getDimensions: () => ({ ...dimensions }),
    updateSize,
  };
};

export const debounce = <T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
): ((...args: Parameters<T>) => void) => {
  let timer: number | null = null;
  return (...args: Parameters<T>): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
};

const MONTH_LABELS: Record<number, string> = {
  3: 'Mar',
  6: 'Jun',
  9: 'Sep',
  12: 'Dec',
};

export const formatMonth = (month: number): string => MONTH_LABELS[month] ?? `${month}`;
