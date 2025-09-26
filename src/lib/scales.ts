import { scaleOrdinal } from 'd3';

const palette = [
  '#0b7285',
  '#f59f00',
  '#ae3ec9',
  '#2f9e44',
  '#d9480f',
  '#1864ab',
  '#5c940d',
  '#862e9c',
];

export const createColorScale = (keys: string[]): ((key: string) => string) => {
  const scale = scaleOrdinal<string, string>().domain(keys).range(palette);
  return (key: string): string => scale(key);
};

export const formatNumber = (value: number, fractionDigits = 1): string =>
  value.toLocaleString('en-NZ', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });

export const formatShare = (value: number): string =>
  `${(value * 100).toFixed(1)}%`;
