import { PALETTE } from '@/dashboard/format';
// Power BI's built-in "CY23SU04" base theme, as written by Power BI Desktop
// (from Microsoft's sample PBIP: github.com/microsoft/Analysis-Services, MIT licence).
import baseTheme from './themes/CY23SU04.json';

export const BASE_THEME_NAME = 'CY23SU04';
export const CUSTOM_THEME_FILE = 'CelestraTheme.json';
export { baseTheme };

const solid = (color: string) => ({ solid: { color } });

/** Celestra look for the exported report: brand palette, white cards with a light border on a slate page. */
export const celestraTheme = {
  name: 'Celestra',
  dataColors: PALETTE,
  foreground: '#0f1f42',
  foregroundNeutralSecondary: '#475569',
  foregroundNeutralTertiary: '#94a3b8',
  background: '#ffffff',
  backgroundLight: '#f8fafc',
  backgroundNeutral: '#e2e8f0',
  tableAccent: PALETTE[0],
  good: '#059669',
  neutral: '#64748b',
  bad: '#dc2626',
  textClasses: {
    title: { fontFace: 'Segoe UI Semibold', fontSize: 11, color: '#0f1f42' },
    label: { fontFace: 'Segoe UI', fontSize: 9, color: '#475569' },
    callout: { fontFace: 'Segoe UI Semibold', fontSize: 22, color: '#0f1f42' },
  },
  visualStyles: {
    '*': {
      '*': {
        background: [{ show: true, color: solid('#ffffff'), transparency: 0 }],
        border: [{ show: true, color: solid('#e2e8f0'), radius: 10 }],
        title: [{ show: true, fontColor: solid('#0f1f42'), fontSize: 11, bold: true }],
        subTitle: [{ fontColor: solid('#64748b'), fontSize: 9 }],
      },
    },
    page: { '*': { background: [{ color: solid('#f1f5f9'), transparency: 0 }] } },
    textbox: { '*': { background: [{ show: false }], border: [{ show: false }] } },
  },
};
