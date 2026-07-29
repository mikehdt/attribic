/**
 * Formatters for the host-load readouts, shared by the compact `Stats` row and
 * the training detail modal's host-load boxes so both render a given figure
 * identically. Every input is nullable — nvidia-smi answers `[N/A]` for
 * anything a card or driver doesn't expose, and psutil is absent on some hosts.
 */

export const formatPercent = (value: number | null) =>
  value == null ? '—' : `${Math.round(value)}%`;

const formatGb = (mb: number) => (mb / 1024).toFixed(1);

export const formatMemory = (usedMb: number | null, totalMb: number | null) =>
  usedMb == null || totalMb == null
    ? '—'
    : `${formatGb(usedMb)}/${formatGb(totalMb)} GB`;

export const formatTemperature = (value: number | null) =>
  value == null ? '—' : `${Math.round(value)}°C`;

/**
 * Where a card starts flagging heat. Consumer GPUs happily sustain the high
 * 70s under a long training run, so this sits above that — it marks "worth a
 * look at your airflow", not "shut it down".
 */
const TEMPERATURE_WARNING_C = 80;

export const isTemperatureWarning = (value: number | null | undefined) =>
  value != null && value >= TEMPERATURE_WARNING_C;
