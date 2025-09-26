import { csv } from 'd3';

export interface RawRecord {
  [key: string]: string | undefined;
}

export interface DataRecord {
  period: string;
  date: Date;
  year: number;
  month: number;
  value: number | null;
  units: string;
  groupKey: string;
  groupLabel: string;
  seriesKey: string;
  seriesLabel: string;
}

export interface GroupMeta {
  key: string;
  label: string;
  units: string[];
}

export interface SeriesMeta {
  key: string;
  label: string;
  groupKey: string;
  groupLabel: string;
  units: string;
}

export interface DataModel {
  records: DataRecord[];
  byGroup: Map<string, DataRecord[]>;
  bySeries: Map<string, DataRecord[]>;
  groups: GroupMeta[];
  series: SeriesMeta[];
  years: number[];
  months: number[];
}

const MONTH_MAP: Record<string, number> = {
  Mar: 3,
  Jun: 6,
  Sep: 9,
  Dec: 12,
};

let cache: Promise<DataModel> | null = null;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const coerceNumber = (value: string | undefined | null): number | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '..') {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const deriveMonth = (row: RawRecord): number => {
  const monthToken =
    row['Unnamed: 1'] ?? row[''] ?? row['Month'] ?? row['Month_code'] ?? '';
  const token = monthToken ? monthToken.trim().slice(0, 3) : '';
  const month = MONTH_MAP[token as keyof typeof MONTH_MAP];
  return month ?? 12;
};

const deriveYear = (period: string): number => {
  const numeric = Number(period);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric);
  }
  const candidate = Number(period.split('.')[0]);
  return Number.isFinite(candidate) ? candidate : 0;
};

const ensureDate = (year: number, month: number): Date =>
  new Date(year, Math.max(0, month - 1), 1);

const withBase = (path: string): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
};

const buildMeta = (records: DataRecord[]): Pick<DataModel, 'byGroup' | 'bySeries' | 'groups' | 'series' | 'years' | 'months'> => {
  const byGroup = new Map<string, DataRecord[]>();
  const bySeries = new Map<string, DataRecord[]>();
  const groupUnits = new Map<string, Set<string>>();
  const seriesMeta = new Map<string, SeriesMeta>();
  const years = new Set<number>();
  const months = new Set<number>();

  records.forEach((record) => {
    if (!byGroup.has(record.groupKey)) {
      byGroup.set(record.groupKey, []);
    }
    byGroup.get(record.groupKey)?.push(record);

    if (!bySeries.has(record.seriesKey)) {
      bySeries.set(record.seriesKey, []);
    }
    bySeries.get(record.seriesKey)?.push(record);

    if (!groupUnits.has(record.groupKey)) {
      groupUnits.set(record.groupKey, new Set());
    }
    groupUnits.get(record.groupKey)?.add(record.units);

    if (!seriesMeta.has(record.seriesKey)) {
      seriesMeta.set(record.seriesKey, {
        key: record.seriesKey,
        label: record.seriesLabel,
        groupKey: record.groupKey,
        groupLabel: record.groupLabel,
        units: record.units,
      });
    }

    years.add(record.year);
    months.add(record.month);
  });

  const groups: GroupMeta[] = Array.from(groupUnits.entries()).map(
    ([key, unitsSet]) => ({
      key,
      label: records.find((record) => record.groupKey === key)?.groupLabel ?? key,
      units: Array.from(unitsSet).sort(),
    }),
  );

  const series: SeriesMeta[] = Array.from(seriesMeta.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return {
    byGroup,
    bySeries,
    groups: groups.sort((a, b) => a.label.localeCompare(b.label)),
    series,
    years: Array.from(years).sort((a, b) => a - b),
    months: Array.from(months).sort((a, b) => a - b),
  };
};

export const loadData = async (): Promise<DataModel> => {
  if (cache) {
    return cache;
  }

  cache = csv<RawRecord>(withBase('data/alcohol.csv')).then((rows) => {
    const records: DataRecord[] = rows
      .map((row) => {
        const period = row['Period'] ?? '';
        const groupLabel = row['Group'] ?? 'Unknown group';
        const seriesLabel = row['Series_title_1'] ?? 'Unknown series';
        const groupKey = slugify(groupLabel);
        const seriesKey = slugify(seriesLabel || `${groupLabel}-${period}`);
        const value = coerceNumber(row['Data_value']);
        const year = deriveYear(period);
        const month = deriveMonth(row);
        return {
          period,
          date: ensureDate(year, month),
          year,
          month,
          value,
          units: row['UNITS'] ?? '',
          groupKey,
          groupLabel,
          seriesKey,
          seriesLabel,
        } as DataRecord;
      })
      .filter((record) => record.seriesLabel.trim().length > 0)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const meta = buildMeta(records);

    return {
      records,
      ...meta,
    };
  });

  return cache;
};

export type { DataModel as AlcoholDataModel };
