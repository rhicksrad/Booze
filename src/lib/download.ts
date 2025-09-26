import { csvFormat } from 'd3';

export interface CsvRow {
  [key: string]: string | number | null;
}

const createBlobUrl = (content: string, mime: string): string => {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  return URL.createObjectURL(blob);
};

const triggerDownload = (filename: string, url: string): void => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadCsv = (filename: string, rows: CsvRow[]): void => {
  const headers = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => headers.add(key));
  });
  const ordered = Array.from(headers);
  const csvString = csvFormat(rows, ordered);
  const url = createBlobUrl(csvString, 'text/csv');
  triggerDownload(filename, url);
};

export const downloadSvg = (filename: string, svg: SVGSVGElement): void => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  const markup = serializer.serializeToString(clone);
  const url = createBlobUrl(markup, 'image/svg+xml');
  triggerDownload(filename, url);
};

export interface DownloadHooks {
  csv: () => CsvRow[];
  svg: () => SVGSVGElement | null;
  filename: string;
}

export const createDownloadControls = (
  container: HTMLElement,
  hooks: DownloadHooks,
): { csvButton: HTMLButtonElement; svgButton: HTMLButtonElement } => {
  const csvButton = document.createElement('button');
  csvButton.textContent = 'Download filtered CSV';
  csvButton.className = 'app-button';
  csvButton.type = 'button';
  csvButton.setAttribute('aria-label', 'Download filtered data as CSV');
  csvButton.addEventListener('click', () => {
    const rows = hooks.csv();
    downloadCsv(`${hooks.filename}.csv`, rows);
  });

  const svgButton = document.createElement('button');
  svgButton.textContent = 'Download SVG';
  svgButton.className = 'app-button';
  svgButton.type = 'button';
  svgButton.setAttribute('aria-label', 'Download current chart SVG');
  svgButton.addEventListener('click', () => {
    const svg = hooks.svg();
    if (svg) {
      downloadSvg(`${hooks.filename}.svg`, svg);
    }
  });

  container.append(csvButton, svgButton);
  return { csvButton, svgButton };
};
