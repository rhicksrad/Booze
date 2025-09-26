import './styles.css';
import { trapFocusOutline } from './lib/a11y';
import { loadData, type DataModel } from './lib/csv';
import { createDownloadControls, type DownloadHooks } from './lib/download';
import { initLayout, type NavItem } from './lib/layout';
import type {
  Controls,
  SelectConfig,
  ToggleOption,
  ViewInstance,
} from './views/types';
import { createView as createLongRunView } from './views/longrun';
import { createView as createPerCapitaView } from './views/percapita';
import { createView as createBeerStrengthView } from './views/beerstrength';
import { createView as createSeasonalityView } from './views/seasonality';
import { createView as createSpiritsCheckView } from './views/spiritscheck';

trapFocusOutline();

interface ViewDefinition extends NavItem {
  factory: () => ViewInstance;
}

type ViewRegistry = Map<string, ViewDefinition>;

const views: ViewDefinition[] = [
  {
    id: 'longrun',
    title: 'Long-run volumes',
    summary:
      'Track total litres of beer, wine, and spirits and how their shares evolve under different measurement groups.',
    factory: createLongRunView,
  },
  {
    id: 'percapita',
    title: 'Per-capita trends',
    summary:
      'Compare per-person availability of beer, wine, and spirits and mark where the lines cross.',
    factory: createPerCapitaView,
  },
  {
    id: 'beerstrength',
    title: 'Beer strength mix',
    summary:
      'See how the strength bands of beer contribute to the total volume over decades or individual years.',
    factory: createBeerStrengthView,
  },
  {
    id: 'seasonality',
    title: 'Seasonality heatmap',
    summary:
      'Explore quarterly patterns for any category with a year-by-month colour grid.',
    factory: createSeasonalityView,
  },
  {
    id: 'spiritscheck',
    title: 'Spirits unit check',
    summary:
      'Compare spirits reported in litres versus proof litres to spot methodology changes.',
    factory: createSpiritsCheckView,
  },
];

const viewMap: ViewRegistry = new Map(views.map((view) => [view.id, view]));

const appElement = document.getElementById('app');
if (!appElement) {
  throw new Error('Root app element not found');
}

const layout = initLayout(appElement, views, (id) => {
  if (activeViewId === id || !dataModel) {
    return;
  }
  mountView(id, dataModel);
});

const controlsContext: Controls = {
  clear(): void {
    layout.controls.innerHTML = '';
    layout.downloads.innerHTML = '';
  },
  addSelect(config: SelectConfig): HTMLSelectElement {
      const wrapper = document.createElement('label');
      wrapper.className = 'control-select';
      wrapper.textContent = config.label;
      wrapper.htmlFor = config.id;

      const select = document.createElement('select');
      select.id = config.id;
      select.className = 'app-select';
      select.setAttribute('aria-label', config.ariaLabel ?? config.label);

      config.options.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        if (option.value === config.value) {
          opt.selected = true;
        }
        select.append(opt);
      });

      select.addEventListener('change', (event) => {
        const target = event.currentTarget as HTMLSelectElement;
        config.onChange(target.value);
      });

      wrapper.append(select);
      layout.controls.append(wrapper);
      return select;
  },
  addToggle(config: ToggleOption): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-button';
      button.id = config.id;
      button.textContent = config.label;
      button.setAttribute('aria-label', config.ariaLabel ?? config.label);
      button.setAttribute('aria-pressed', String(config.value));
      button.addEventListener('click', () => {
        const next = !config.value;
        config.value = next;
        button.setAttribute('aria-pressed', String(next));
        button.classList.toggle('is-active', next);
        config.onChange(next);
      });
      layout.controls.append(button);
      return button;
  },
  setDownloads(hooks: DownloadHooks): void {
    layout.downloads.innerHTML = '';
    createDownloadControls(layout.downloads, hooks);
  },
  downloadsRoot: layout.downloads,
};

let dataModel: DataModel | null = null;
let activeViewId = views[0]?.id ?? '';
let currentInstance: ViewInstance | null = null;

const mountView = (id: string, model: DataModel): void => {
  const definition = viewMap.get(id);
  if (!definition) {
    return;
  }

  controlsContext.clear();
  layout.summary.textContent = definition.summary;
  layout.chart.innerHTML = '';

  if (currentInstance) {
    currentInstance.destroy();
  }

  const instance = definition.factory();
  currentInstance = instance;
  activeViewId = id;
  layout.setActive(id);
  instance.init(layout.chart, model, controlsContext);
};

loadData()
  .then((model) => {
    dataModel = model;
    mountView(activeViewId, model);
  })
  .catch((error) => {
    layout.summary.textContent = `Failed to load data: ${error instanceof Error ? error.message : String(error)}`;
  });
