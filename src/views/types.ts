import type { DataModel } from '../lib/csv';
import type { DownloadHooks } from '../lib/download';

export interface SelectOption {
  label: string;
  value: string;
}

export interface ToggleOption {
  id: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
}

export interface SelectConfig {
  id: string;
  label: string;
  ariaLabel?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

export interface Controls {
  clear: () => void;
  addSelect: (config: SelectConfig) => HTMLSelectElement;
  addToggle: (config: ToggleOption) => HTMLButtonElement;
  setDownloads: (hooks: DownloadHooks) => void;
  downloadsRoot: HTMLElement;
}

export interface ViewInstance {
  init: (container: HTMLElement, data: DataModel, controls: Controls) => void;
  destroy: () => void;
}
